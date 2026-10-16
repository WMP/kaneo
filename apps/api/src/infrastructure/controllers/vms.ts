import { and, asc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  infraHostTable,
  infraStorageClusterTable,
  infraVmTable,
  projectTable,
  taskTable,
} from "../../database/schema";
import { INFRA_ERROR_CODES, infraError } from "../errors";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Transaction | typeof db;

export type VmInput = {
  id?: string;
  name: string;
  vcpu: number;
  ramGb: number;
  localStorageGb: number;
  cephStorageGb: number;
  storageClusterId: string | null;
  hostId: string | null;
};

async function selectVms(executor: Executor, taskId: string) {
  const rows = await executor
    .select({
      id: infraVmTable.id,
      taskId: infraVmTable.taskId,
      hostId: infraVmTable.hostId,
      name: infraVmTable.name,
      vcpu: infraVmTable.vcpu,
      ramGb: infraVmTable.ramGb,
      localStorageGb: infraVmTable.localStorageGb,
      cephStorageGb: infraVmTable.cephStorageGb,
      storageClusterId: infraVmTable.storageClusterId,
      position: infraVmTable.position,
      createdAt: infraVmTable.createdAt,
      updatedAt: infraVmTable.updatedAt,
      storageCluster: {
        id: infraStorageClusterTable.id,
        name: infraStorageClusterTable.name,
        region: infraStorageClusterTable.region,
        kind: infraStorageClusterTable.kind,
      },
      host: {
        id: infraHostTable.id,
        label: infraHostTable.label,
        region: infraHostTable.region,
        zone: infraHostTable.zone,
        status: infraHostTable.status,
        availableFrom: infraHostTable.availableFrom,
      },
    })
    .from(infraVmTable)
    .leftJoin(infraHostTable, eq(infraHostTable.id, infraVmTable.hostId))
    .leftJoin(
      infraStorageClusterTable,
      eq(infraStorageClusterTable.id, infraVmTable.storageClusterId),
    )
    .where(eq(infraVmTable.taskId, taskId))
    .orderBy(asc(infraVmTable.position), asc(infraVmTable.createdAt));
  return rows.map((row) => ({
    ...row,
    storageCluster: row.storageCluster?.id != null ? row.storageCluster : null,
    host:
      row.host?.id != null
        ? {
            ...row.host,
            status: row.host.status,
          }
        : null,
  }));
}

export async function listTaskVms(taskId: string) {
  return selectVms(db, taskId);
}

// Replaces the task's VM list in one transaction. Items with an id that
// belongs to the task are updated, items without an id are created, existing
// VMs missing from the list are deleted. Any rejected item persists nothing.
export async function replaceTaskVms(taskId: string, items: VmInput[]) {
  return db.transaction(async (tx) => {
    // The task row lock serializes concurrent replacements of one list.
    const [task] = await tx
      .select({
        projectId: taskTable.projectId,
        workspaceId: projectTable.workspaceId,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(eq(taskTable.id, taskId))
      .for("update", { of: taskTable });
    if (!task) throw new HTTPException(404, { message: "Task not found" });

    const hostIds = [
      ...new Set(items.flatMap((item) => (item.hostId ? [item.hostId] : []))),
    ];
    const hostRegions = new Map<string, string>();
    if (hostIds.length > 0) {
      // `for share` keeps a host from being deleted while this list commits.
      const hosts = await tx
        .select({
          id: infraHostTable.id,
          projectId: infraHostTable.projectId,
          region: infraHostTable.region,
        })
        .from(infraHostTable)
        .where(inArray(infraHostTable.id, hostIds))
        .for("share");
      const valid = new Set(
        hosts.filter((h) => h.projectId === task.projectId).map((h) => h.id),
      );
      for (const h of hosts) hostRegions.set(h.id, h.region);
      if (hostIds.some((id) => !valid.has(id))) {
        throw infraError(
          400,
          INFRA_ERROR_CODES.hostNotInProject,
          "A host does not exist in the project of this task",
        );
      }
    }

    const clusterIds = [
      ...new Set(
        items.flatMap((item) =>
          item.storageClusterId ? [item.storageClusterId] : [],
        ),
      ),
    ];
    const clusterRegions = new Map<string, string>();
    if (clusterIds.length > 0) {
      // `for share` keeps a cluster from being deleted while this list commits.
      const clusters = await tx
        .select({
          id: infraStorageClusterTable.id,
          region: infraStorageClusterTable.region,
        })
        .from(infraStorageClusterTable)
        .where(
          and(
            inArray(infraStorageClusterTable.id, clusterIds),
            eq(infraStorageClusterTable.workspaceId, task.workspaceId),
          ),
        )
        .for("share");
      for (const c of clusters) clusterRegions.set(c.id, c.region);
      if (clusterIds.some((id) => !clusterRegions.has(id))) {
        throw infraError(
          400,
          INFRA_ERROR_CODES.clusterNotInWorkspace,
          "A storage cluster does not exist in the workspace of this task",
        );
      }
    }
    for (const item of items) {
      if (!item.hostId || !item.storageClusterId) continue;
      if (
        hostRegions.get(item.hostId) !==
        clusterRegions.get(item.storageClusterId)
      ) {
        throw infraError(
          400,
          INFRA_ERROR_CODES.clusterRegionMismatch,
          "The storage cluster is in another region than the host",
        );
      }
    }

    const existing = await tx
      .select({ id: infraVmTable.id })
      .from(infraVmTable)
      .where(eq(infraVmTable.taskId, taskId));
    const existingIds = new Set(existing.map((vm) => vm.id));
    const seen = new Set<string>();
    for (const item of items) {
      if (!item.id) continue;
      if (!existingIds.has(item.id)) {
        throw infraError(
          400,
          INFRA_ERROR_CODES.vmNotInTask,
          "A VM id does not belong to this task",
        );
      }
      if (seen.has(item.id)) {
        throw infraError(
          400,
          INFRA_ERROR_CODES.vmNotInTask,
          "A VM id appears more than once",
        );
      }
      seen.add(item.id);
    }

    const removed = [...existingIds].filter((id) => !seen.has(id));
    if (removed.length > 0) {
      await tx.delete(infraVmTable).where(inArray(infraVmTable.id, removed));
    }
    for (const [position, item] of items.entries()) {
      const values = {
        name: item.name,
        vcpu: item.vcpu,
        ramGb: item.ramGb,
        localStorageGb: item.localStorageGb,
        cephStorageGb: item.cephStorageGb,
        storageClusterId: item.storageClusterId,
        hostId: item.hostId,
        position,
      };
      if (item.id) {
        await tx
          .update(infraVmTable)
          .set(values)
          .where(eq(infraVmTable.id, item.id));
      } else {
        await tx.insert(infraVmTable).values({ ...values, taskId });
      }
    }
    return selectVms(tx, taskId);
  });
}
