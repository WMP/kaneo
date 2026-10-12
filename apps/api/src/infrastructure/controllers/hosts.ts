import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  infraHostTable,
  infraModelTable,
  infraVmTable,
  projectTable,
} from "../../database/schema";
import { INFRA_ERROR_CODES, infraError } from "../errors";
import { lockModel } from "./models";

// One query, no N+1: the host, its model and the VM totals (an aggregate over
// a left join, so a host without VMs has zeros).
const hostColumns = {
  id: infraHostTable.id,
  projectId: infraHostTable.projectId,
  modelId: infraHostTable.modelId,
  region: infraHostTable.region,
  label: infraHostTable.label,
  status: infraHostTable.status,
  availableFrom: infraHostTable.availableFrom,
  hostname: infraHostTable.hostname,
  createdAt: infraHostTable.createdAt,
  updatedAt: infraHostTable.updatedAt,
  model: {
    id: infraModelTable.id,
    name: infraModelTable.name,
    provider: infraModelTable.provider,
    family: infraModelTable.family,
    ramGb: infraModelTable.ramGb,
    vcpu: infraModelTable.vcpu,
    storageGb: infraModelTable.storageGb,
    leadTimeDays: infraModelTable.leadTimeDays,
    hypervisorReservePercent: infraModelTable.hypervisorReservePercent,
  },
  totals: {
    vmCount: sql<number>`count(${infraVmTable.id})::int`,
    vcpu: sql<number>`coalesce(sum(${infraVmTable.vcpu}), 0)::int`,
    ramGb: sql<number>`coalesce(sum(${infraVmTable.ramGb}), 0)::int`,
    localStorageGb: sql<number>`coalesce(sum(${infraVmTable.localStorageGb}), 0)::int`,
    cephStorageGb: sql<number>`coalesce(sum(${infraVmTable.cephStorageGb}), 0)::int`,
  },
};

export type HostStatus = "planned" | "ordered" | "installed";

function hostsWithTotals(where: SQL | undefined) {
  return db
    .select({ ...hostColumns, projectName: projectTable.name })
    .from(infraHostTable)
    .innerJoin(infraModelTable, eq(infraModelTable.id, infraHostTable.modelId))
    .innerJoin(projectTable, eq(projectTable.id, infraHostTable.projectId))
    .leftJoin(infraVmTable, eq(infraVmTable.hostId, infraHostTable.id))
    .where(where)
    .groupBy(infraHostTable.id, infraModelTable.id, projectTable.id)
    .orderBy(asc(infraHostTable.createdAt), asc(infraHostTable.id));
}

export async function listProjectHosts(projectId: string) {
  const rows = await hostsWithTotals(eq(infraHostTable.projectId, projectId));
  return rows.map(({ projectName: _name, ...row }) => row);
}

export async function getProjectHost(projectId: string, hostId: string) {
  const [row] = await hostsWithTotals(
    and(eq(infraHostTable.projectId, projectId), eq(infraHostTable.id, hostId)),
  );
  if (!row) {
    throw new HTTPException(404, { message: "Infrastructure host not found" });
  }
  const { projectName: _name, ...host } = row;
  return host;
}

// Hosts of every project of the workspace for the datacenter team: project
// name, model, status, dates and totals. No task titles or task links.
export async function listWorkspaceHosts(workspaceId: string) {
  const rows = await hostsWithTotals(eq(projectTable.workspaceId, workspaceId));
  return rows;
}

export async function getWorkspaceHost(workspaceId: string, hostId: string) {
  const [row] = await hostsWithTotals(
    and(
      eq(projectTable.workspaceId, workspaceId),
      eq(infraHostTable.id, hostId),
    ),
  );
  if (!row) {
    throw new HTTPException(404, { message: "Infrastructure host not found" });
  }
  return row;
}

function regionNotAllowed(region: string) {
  return infraError(
    400,
    INFRA_ERROR_CODES.regionNotAllowed,
    `Region ${region} is not offered by the model`,
  );
}

// Default label: `<model name> <ram> GB <region> #<n>` where n is the highest
// number already used in a label of the same model and region in the project,
// plus one (1 when there is none). It is deterministic and never reuses the
// number of a deleted host that is not the highest. The model row is locked by
// the caller, so two concurrent creations get different numbers.
async function nextLabel(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  model: { id: string; name: string; ramGb: number },
  projectId: string,
  region: string,
) {
  const rows = await tx
    .select({ label: infraHostTable.label })
    .from(infraHostTable)
    .where(
      and(
        eq(infraHostTable.projectId, projectId),
        eq(infraHostTable.modelId, model.id),
        eq(infraHostTable.region, region),
      ),
    );
  let max = 0;
  for (const { label } of rows) {
    const match = /#(\d+)$/.exec(label);
    if (match?.[1]) max = Math.max(max, Number(match[1]));
  }
  return `${model.name} ${model.ramGb} GB ${region} #${max + 1}`;
}

export async function createHost(
  projectId: string,
  input: { modelId: string; region: string; label?: string },
) {
  const id = await db.transaction(async (tx) => {
    const model = await lockModel(tx, projectId, input.modelId);
    if (!model.regions.includes(input.region)) {
      throw regionNotAllowed(input.region);
    }
    const label =
      input.label ?? (await nextLabel(tx, model, projectId, input.region));
    const [host] = await tx
      .insert(infraHostTable)
      .values({
        projectId,
        modelId: model.id,
        region: input.region,
        label,
        status: "planned",
      })
      .returning({ id: infraHostTable.id });
    if (!host) {
      throw new HTTPException(500, { message: "Failed to create host" });
    }
    return host.id;
  });
  return getProjectHost(projectId, id);
}

export async function updateHost(
  projectId: string,
  hostId: string,
  input: { label?: string; region?: string },
) {
  await db.transaction(async (tx) => {
    const [host] = await tx
      .select()
      .from(infraHostTable)
      .where(
        and(
          eq(infraHostTable.id, hostId),
          eq(infraHostTable.projectId, projectId),
        ),
      )
      .for("update");
    if (!host) {
      throw new HTTPException(404, {
        message: "Infrastructure host not found",
      });
    }
    const changes: { label?: string; region?: string } = {};
    if (input.label !== undefined) changes.label = input.label;
    if (input.region !== undefined && input.region !== host.region) {
      if (host.status !== "planned") {
        throw infraError(
          409,
          INFRA_ERROR_CODES.hostLocked,
          "The region of an ordered or installed host cannot change",
        );
      }
      const model = await lockModel(tx, projectId, host.modelId);
      if (!model.regions.includes(input.region)) {
        throw regionNotAllowed(input.region);
      }
      changes.region = input.region;
    }
    if (Object.keys(changes).length > 0) {
      await tx
        .update(infraHostTable)
        .set(changes)
        .where(eq(infraHostTable.id, hostId));
    }
  });
  return getProjectHost(projectId, hostId);
}

// Only a planned host can be deleted; its VMs stay in their tasks, unplaced
// (the foreign key sets host_id to null).
export async function deleteHost(projectId: string, hostId: string) {
  await db.transaction(async (tx) => {
    const [host] = await tx
      .select({ status: infraHostTable.status })
      .from(infraHostTable)
      .where(
        and(
          eq(infraHostTable.id, hostId),
          eq(infraHostTable.projectId, projectId),
        ),
      )
      .for("update");
    if (!host) {
      throw new HTTPException(404, {
        message: "Infrastructure host not found",
      });
    }
    if (host.status !== "planned") {
      throw infraError(
        409,
        INFRA_ERROR_CODES.hostLocked,
        "Only a planned host can be deleted",
      );
    }
    await tx.delete(infraHostTable).where(eq(infraHostTable.id, hostId));
  });
  return { id: hostId };
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

// The stored date for a status change, shared by hosts and storage capacity:
// `planned` clears it, `installed` without a date stores today, `ordered`
// needs the expected delivery date.
export function resolveAvailableFrom(
  status: HostStatus,
  availableFrom: string | null | undefined,
) {
  if (status === "ordered" && !availableFrom) {
    throw infraError(
      400,
      INFRA_ERROR_CODES.availableFromRequired,
      "An ordered entry needs the expected delivery date (availableFrom)",
    );
  }
  if (status === "planned") return null;
  if (status === "installed") return availableFrom ?? todayUtc();
  return availableFrom ?? null;
}

// Datacenter status change. `ordered` needs the expected delivery date;
// `installed` without a date stores today; `planned` clears the date. The
// hostname is only changed when the body names it.
export async function setHostStatus(
  workspaceId: string,
  hostId: string,
  input: {
    status: HostStatus;
    availableFrom?: string | null;
    hostname?: string | null;
  },
) {
  const availableFrom = resolveAvailableFrom(input.status, input.availableFrom);
  await db.transaction(async (tx) => {
    // Scope by the workspace of the host's project; a host of another
    // workspace is a 404.
    const [host] = await tx
      .select({ id: infraHostTable.id })
      .from(infraHostTable)
      .innerJoin(projectTable, eq(projectTable.id, infraHostTable.projectId))
      .where(
        and(
          eq(infraHostTable.id, hostId),
          eq(projectTable.workspaceId, workspaceId),
        ),
      )
      .for("update", { of: infraHostTable });
    if (!host) {
      throw new HTTPException(404, {
        message: "Infrastructure host not found",
      });
    }
    await tx
      .update(infraHostTable)
      .set({
        status: input.status,
        availableFrom,
        ...(input.hostname !== undefined ? { hostname: input.hostname } : {}),
      })
      .where(eq(infraHostTable.id, hostId));
  });
  return getWorkspaceHost(workspaceId, hostId);
}
