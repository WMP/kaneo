import { asc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { infraHostTable, infraVmTable, taskTable } from "../../database/schema";
import { INFRA_ERROR_CODES, infraError } from "../errors";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Transaction | typeof db;

export type VmInput = {
  id?: string;
  name: string;
  vcpu: number;
  ramGb: number;
  storageGb: number;
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
      storageGb: infraVmTable.storageGb,
      position: infraVmTable.position,
      createdAt: infraVmTable.createdAt,
      updatedAt: infraVmTable.updatedAt,
      host: {
        id: infraHostTable.id,
        label: infraHostTable.label,
        region: infraHostTable.region,
        status: infraHostTable.status,
        availableFrom: infraHostTable.availableFrom,
      },
    })
    .from(infraVmTable)
    .leftJoin(infraHostTable, eq(infraHostTable.id, infraVmTable.hostId))
    .where(eq(infraVmTable.taskId, taskId))
    .orderBy(asc(infraVmTable.position), asc(infraVmTable.createdAt));
  return rows.map((row) => ({
    ...row,
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
      .select({ projectId: taskTable.projectId })
      .from(taskTable)
      .where(eq(taskTable.id, taskId))
      .for("update");
    if (!task) throw new HTTPException(404, { message: "Task not found" });

    const hostIds = [
      ...new Set(items.flatMap((item) => (item.hostId ? [item.hostId] : []))),
    ];
    if (hostIds.length > 0) {
      // `for share` keeps a host from being deleted while this list commits.
      const hosts = await tx
        .select({ id: infraHostTable.id, projectId: infraHostTable.projectId })
        .from(infraHostTable)
        .where(inArray(infraHostTable.id, hostIds))
        .for("share");
      const valid = new Set(
        hosts.filter((h) => h.projectId === task.projectId).map((h) => h.id),
      );
      if (hostIds.some((id) => !valid.has(id))) {
        throw infraError(
          400,
          INFRA_ERROR_CODES.hostNotInProject,
          "A host does not exist in the project of this task",
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
        storageGb: item.storageGb,
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
