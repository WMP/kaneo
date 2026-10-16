import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  infraStorageCapacityTable,
  infraStorageClusterTable,
  infraVmTable,
} from "../../database/schema";
import { INFRA_ERROR_CODES, infraError } from "../errors";
import { resolveAvailableFrom } from "./hosts";
import { assertRegionsInCatalog } from "./regions";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ClusterKind = "self_managed" | "managed_service";
type Status = "planned" | "ordered" | "installed";

export type ClusterInput = {
  name: string;
  region: string;
  kind: ClusterKind;
  ecDataChunks?: number | null;
  ecCodingChunks?: number | null;
  fillThresholdPercent: number;
  leadTimeDays: number;
};

function pgError(error: unknown): { code?: string; constraint?: string } {
  const e = error as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  return {
    code: e?.cause?.code ?? e?.code,
    constraint: e?.cause?.constraint ?? e?.constraint,
  };
}

// Maps the database errors that the API's own validation can miss (a
// concurrent rename, a check violation) to the same coded answers.
function mapClusterWriteError(error: unknown): never {
  if (error instanceof HTTPException) throw error;
  const { code, constraint } = pgError(error);
  if (code === "23505") {
    throw infraError(
      409,
      INFRA_ERROR_CODES.clusterNameTaken,
      "A storage cluster with this name already exists in the workspace",
    );
  }
  if (code === "23514" && constraint?.startsWith("ganttpro_infra_storage_")) {
    throw infraError(
      400,
      INFRA_ERROR_CODES.clusterInvalid,
      "The storage cluster values are not consistent",
    );
  }
  throw error;
}

// What a project may know about the workspace's clusters: no capacity, no use.
export async function listClusterSummaries(workspaceId: string) {
  return db
    .select({
      id: infraStorageClusterTable.id,
      name: infraStorageClusterTable.name,
      region: infraStorageClusterTable.region,
      kind: infraStorageClusterTable.kind,
    })
    .from(infraStorageClusterTable)
    .where(eq(infraStorageClusterTable.workspaceId, workspaceId))
    .orderBy(
      asc(infraStorageClusterTable.position),
      asc(infraStorageClusterTable.createdAt),
    );
}

// Clusters with their capacity entries and totals in three queries: the
// clusters, their entries (with the installed and not yet installed sums) and
// the VM usage, both aggregated per cluster.
async function loadClusters(workspaceId: string, clusterId?: string) {
  const clusters = await db
    .select()
    .from(infraStorageClusterTable)
    .where(
      and(
        eq(infraStorageClusterTable.workspaceId, workspaceId),
        clusterId ? eq(infraStorageClusterTable.id, clusterId) : undefined,
      ),
    )
    .orderBy(
      asc(infraStorageClusterTable.position),
      asc(infraStorageClusterTable.createdAt),
    );
  if (clusters.length === 0) return [];
  const ids = clusters.map((c) => c.id);

  const entries = await db
    .select()
    .from(infraStorageCapacityTable)
    .where(inArray(infraStorageCapacityTable.clusterId, ids))
    .orderBy(
      asc(infraStorageCapacityTable.createdAt),
      asc(infraStorageCapacityTable.id),
    );
  const usage = await db
    .select({
      clusterId: infraVmTable.storageClusterId,
      usedCephGb: sql<number>`coalesce(sum(${infraVmTable.cephStorageGb}), 0)::int`,
      vmCount: sql<number>`count(*)::int`,
    })
    .from(infraVmTable)
    .where(inArray(infraVmTable.storageClusterId, ids))
    .groupBy(infraVmTable.storageClusterId);
  const usageById = new Map(usage.map((u) => [u.clusterId, u]));

  return clusters.map((cluster) => {
    const own = entries.filter((e) => e.clusterId === cluster.id);
    const sum = (status: (s: Status) => boolean) =>
      own.filter((e) => status(e.status)).reduce((a, e) => a + e.capacityGb, 0);
    const used = usageById.get(cluster.id);
    return {
      ...cluster,
      capacity: own,
      totals: {
        rawCapacityGb: sum((s) => s === "installed"),
        plannedOrOrderedCapacityGb: sum((s) => s !== "installed"),
        usedCephGb: used?.usedCephGb ?? 0,
        vmCount: used?.vmCount ?? 0,
      },
    };
  });
}

export const listClusters = (workspaceId: string) => loadClusters(workspaceId);

export async function getCluster(workspaceId: string, clusterId: string) {
  const [cluster] = await loadClusters(workspaceId, clusterId);
  if (!cluster) {
    throw new HTTPException(404, { message: "Storage cluster not found" });
  }
  return cluster;
}

// Locks the cluster row so label numbering, kind switches and the in-use check
// run one after another. A cluster of another workspace is a 404.
async function lockCluster(
  tx: Transaction,
  workspaceId: string,
  clusterId: string,
) {
  const [cluster] = await tx
    .select()
    .from(infraStorageClusterTable)
    .where(
      and(
        eq(infraStorageClusterTable.id, clusterId),
        eq(infraStorageClusterTable.workspaceId, workspaceId),
      ),
    )
    .for("update");
  if (!cluster) {
    throw new HTTPException(404, { message: "Storage cluster not found" });
  }
  return cluster;
}

function invalid(message: string) {
  return infraError(400, INFRA_ERROR_CODES.clusterInvalid, message);
}

export async function createCluster(workspaceId: string, input: ClusterInput) {
  const selfManaged = input.kind === "self_managed";
  const id = await db
    .transaction(async (tx) => {
      await assertRegionsInCatalog(tx, workspaceId, [input.region]);
      const [last] = await tx
        .select({
          position: sql<number>`coalesce(max(${infraStorageClusterTable.position}), -1)::int`,
        })
        .from(infraStorageClusterTable)
        .where(eq(infraStorageClusterTable.workspaceId, workspaceId));
      const [created] = await tx
        .insert(infraStorageClusterTable)
        .values({
          ...input,
          ecDataChunks: selfManaged ? (input.ecDataChunks ?? null) : null,
          ecCodingChunks: selfManaged ? (input.ecCodingChunks ?? null) : null,
          workspaceId,
          position: (last?.position ?? -1) + 1,
        })
        .returning({ id: infraStorageClusterTable.id });
      if (!created) {
        throw new HTTPException(500, { message: "Failed to create cluster" });
      }
      return created.id;
    })
    .catch(mapClusterWriteError);
  return getCluster(workspaceId, id);
}

export async function updateCluster(
  workspaceId: string,
  clusterId: string,
  input: Partial<ClusterInput>,
) {
  await db
    .transaction(async (tx) => {
      const current = await lockCluster(tx, workspaceId, clusterId);
      if (input.region !== undefined) {
        await assertRegionsInCatalog(tx, workspaceId, [input.region]);
      }
      // A VM's cluster must stay in the region of its host, so the region of
      // a cluster that VMs use is fixed (VM writes lock the cluster row too).
      if (input.region !== undefined && input.region !== current.region) {
        const [used] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(infraVmTable)
          .where(eq(infraVmTable.storageClusterId, clusterId));
        if ((used?.count ?? 0) > 0) {
          throw infraError(
            409,
            INFRA_ERROR_CODES.regionInUse,
            "VMs use this storage cluster; its region cannot change",
          );
        }
      }
      const kind = input.kind ?? current.kind;
      let ecDataChunks: number | null;
      let ecCodingChunks: number | null;
      if (kind === "managed_service") {
        // Switching to a managed service clears k and m; sending them is wrong.
        if (input.ecDataChunks != null || input.ecCodingChunks != null) {
          throw invalid("A managed_service cluster has no erasure coding");
        }
        ecDataChunks = null;
        ecCodingChunks = null;
      } else {
        ecDataChunks =
          input.ecDataChunks !== undefined
            ? input.ecDataChunks
            : current.ecDataChunks;
        ecCodingChunks =
          input.ecCodingChunks !== undefined
            ? input.ecCodingChunks
            : current.ecCodingChunks;
        if (ecDataChunks == null || ecCodingChunks == null) {
          throw invalid(
            "A self_managed cluster needs ecDataChunks and ecCodingChunks",
          );
        }
      }
      await tx
        .update(infraStorageClusterTable)
        .set({
          name: input.name,
          region: input.region,
          kind,
          ecDataChunks,
          ecCodingChunks,
          fillThresholdPercent: input.fillThresholdPercent,
          leadTimeDays: input.leadTimeDays,
        })
        .where(eq(infraStorageClusterTable.id, clusterId));
    })
    .catch(mapClusterWriteError);
  return getCluster(workspaceId, clusterId);
}

export async function deleteCluster(workspaceId: string, clusterId: string) {
  await db.transaction(async (tx) => {
    await lockCluster(tx, workspaceId, clusterId);
    const [used] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(infraVmTable)
      .where(eq(infraVmTable.storageClusterId, clusterId));
    if ((used?.count ?? 0) > 0) {
      throw infraError(
        409,
        INFRA_ERROR_CODES.clusterInUse,
        "VMs use this storage cluster",
      );
    }
    await tx
      .delete(infraStorageClusterTable)
      .where(eq(infraStorageClusterTable.id, clusterId));
  });
  return { id: clusterId };
}

// Default label: `<cluster name> #<n>`, n = highest number used in a label of
// the cluster plus one (the same rule as host labels). The cluster row is
// locked by the caller.
export async function createCapacity(
  workspaceId: string,
  clusterId: string,
  input: { label?: string; modelName?: string | null; capacityGb: number },
) {
  const entryId = await db.transaction(async (tx) => {
    const cluster = await lockCluster(tx, workspaceId, clusterId);
    let label = input.label;
    if (!label) {
      const rows = await tx
        .select({ label: infraStorageCapacityTable.label })
        .from(infraStorageCapacityTable)
        .where(eq(infraStorageCapacityTable.clusterId, clusterId));
      let max = 0;
      for (const row of rows) {
        const match = /#(\d+)$/.exec(row.label);
        if (match?.[1]) max = Math.max(max, Number(match[1]));
      }
      label = `${cluster.name} #${max + 1}`;
    }
    const [entry] = await tx
      .insert(infraStorageCapacityTable)
      .values({
        clusterId,
        label,
        modelName: input.modelName ?? null,
        capacityGb: input.capacityGb,
        status: "planned",
      })
      .returning({ id: infraStorageCapacityTable.id });
    if (!entry) {
      throw new HTTPException(500, { message: "Failed to create entry" });
    }
    return entry.id;
  });
  return getCapacity(workspaceId, clusterId, entryId);
}

async function getCapacity(
  workspaceId: string,
  clusterId: string,
  entryId: string,
) {
  const [entry] = await db
    .select({ entry: infraStorageCapacityTable })
    .from(infraStorageCapacityTable)
    .innerJoin(
      infraStorageClusterTable,
      eq(infraStorageClusterTable.id, infraStorageCapacityTable.clusterId),
    )
    .where(
      and(
        eq(infraStorageCapacityTable.id, entryId),
        eq(infraStorageCapacityTable.clusterId, clusterId),
        eq(infraStorageClusterTable.workspaceId, workspaceId),
      ),
    );
  if (!entry) {
    throw new HTTPException(404, { message: "Capacity entry not found" });
  }
  return entry.entry;
}

async function lockEntry(
  tx: Transaction,
  workspaceId: string,
  clusterId: string,
  entryId: string,
) {
  await lockCluster(tx, workspaceId, clusterId);
  const [entry] = await tx
    .select()
    .from(infraStorageCapacityTable)
    .where(
      and(
        eq(infraStorageCapacityTable.id, entryId),
        eq(infraStorageCapacityTable.clusterId, clusterId),
      ),
    )
    .for("update");
  if (!entry) {
    throw new HTTPException(404, { message: "Capacity entry not found" });
  }
  return entry;
}

export async function updateCapacity(
  workspaceId: string,
  clusterId: string,
  entryId: string,
  input: {
    label?: string;
    modelName?: string | null;
    capacityGb?: number;
    status?: Status;
    availableFrom?: string | null;
    hostname?: string | null;
  },
) {
  await db.transaction(async (tx) => {
    const entry = await lockEntry(tx, workspaceId, clusterId, entryId);
    const status = input.status ?? entry.status;
    const dateChange =
      input.status !== undefined || input.availableFrom !== undefined;
    await tx
      .update(infraStorageCapacityTable)
      .set({
        label: input.label,
        modelName: input.modelName,
        capacityGb: input.capacityGb,
        hostname: input.hostname,
        ...(dateChange
          ? {
              status,
              availableFrom: resolveAvailableFrom(status, input.availableFrom),
            }
          : {}),
      })
      .where(eq(infraStorageCapacityTable.id, entryId));
  });
  return getCapacity(workspaceId, clusterId, entryId);
}

export async function deleteCapacity(
  workspaceId: string,
  clusterId: string,
  entryId: string,
) {
  await db.transaction(async (tx) => {
    const entry = await lockEntry(tx, workspaceId, clusterId, entryId);
    if (entry.status !== "planned") {
      throw infraError(
        409,
        INFRA_ERROR_CODES.capacityLocked,
        "Only a planned capacity entry can be deleted",
      );
    }
    await tx
      .delete(infraStorageCapacityTable)
      .where(eq(infraStorageCapacityTable.id, entryId));
  });
  return { id: entryId };
}
