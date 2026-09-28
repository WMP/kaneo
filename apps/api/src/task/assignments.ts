import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import type db from "../database";
import { taskAssignmentTable, taskTable, userTable } from "../database/schema";

export type TaskAssignee = {
  userId: string;
  name: string;
  image: string | null;
  units: number;
  work: number | null;
};

// Either the top-level `db` or a transaction handed down by a caller that is
// already inside one (e.g. create-task.ts's `db.transaction`). Both expose
// the same query-builder surface this module needs, and drizzle-orm's
// node-postgres driver supports nested transactions (via SAVEPOINT), so
// calling `.transaction()` on either is always safe.
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function dedupePreserveOrder(userIds: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const rawUserId of userIds) {
    const userId = rawUserId.trim();
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    deduped.push(userId);
  }

  return deduped;
}

/**
 * Replaces a task's full assignee list and keeps `task.userId` (DB column
 * "assignee_id") — the denormalized "primary assignee" mirror every
 * pre-existing single-assignee call-site still reads — equal to the list's
 * first entry, or null when the list is empty. This is the only writer of
 * `ganttpro_task_assignment`: every assignee mutation must go through it so
 * the table and the mirror never drift apart.
 *
 * Runs in its own transaction (a nested one, via SAVEPOINT, when `executor`
 * is already inside one) so the delete/insert/mirror-update land atomically.
 */
export async function setTaskAssignees(
  executor: Executor,
  taskId: string,
  userIds: string[],
): Promise<string[]> {
  const deduped = dedupePreserveOrder(userIds);
  const primaryUserId = deduped[0] ?? null;

  await executor.transaction(async (tx) => {
    if (deduped.length === 0) {
      await tx
        .delete(taskAssignmentTable)
        .where(eq(taskAssignmentTable.taskId, taskId));
    } else {
      await tx
        .delete(taskAssignmentTable)
        .where(
          and(
            eq(taskAssignmentTable.taskId, taskId),
            notInArray(taskAssignmentTable.userId, deduped),
          ),
        );

      await tx
        .insert(taskAssignmentTable)
        .values(deduped.map((userId) => ({ taskId, userId })))
        .onConflictDoNothing({
          target: [taskAssignmentTable.taskId, taskAssignmentTable.userId],
        });
    }

    await tx
      .update(taskTable)
      .set({ userId: primaryUserId })
      .where(eq(taskTable.id, taskId));
  });

  return deduped;
}

/**
 * Resets `task.userId` to the assignment table's first row for each given
 * task (by createdAt, then id, for a stable "first"), or null when a task has
 * none. Use this instead of `setTaskAssignees` when assignment rows were
 * removed by something other than a normal assignee mutation — e.g. a
 * cross-workspace project move deleting a non-member's assignment — so the
 * mirror stays correct without touching rows that are still valid.
 */
export async function recomputeTaskPrimaryAssignees(
  executor: Executor,
  taskIds: string[],
): Promise<void> {
  if (taskIds.length === 0) return;

  const remaining = await executor
    .select({
      taskId: taskAssignmentTable.taskId,
      userId: taskAssignmentTable.userId,
      createdAt: taskAssignmentTable.createdAt,
    })
    .from(taskAssignmentTable)
    .where(inArray(taskAssignmentTable.taskId, taskIds))
    .orderBy(asc(taskAssignmentTable.createdAt), asc(taskAssignmentTable.id));

  const primaryByTaskId = new Map<string, string | null>(
    taskIds.map((taskId) => [taskId, null]),
  );
  for (const row of remaining) {
    if (primaryByTaskId.get(row.taskId) === null) {
      primaryByTaskId.set(row.taskId, row.userId);
    }
  }

  await executor.transaction(async (tx) => {
    for (const [taskId, primaryUserId] of primaryByTaskId) {
      await tx
        .update(taskTable)
        .set({ userId: primaryUserId })
        .where(eq(taskTable.id, taskId));
    }
  });
}

/**
 * Batched read of every task's assignee list, joined to the user table for
 * display fields — mirrors the labels-map pattern in get-tasks.ts so a task
 * list page issues one query for this instead of one per task.
 */
export async function readTaskAssignees(
  executor: Executor,
  taskIds: string[],
): Promise<Map<string, TaskAssignee[]>> {
  const assigneesByTaskId = new Map<string, TaskAssignee[]>();

  if (taskIds.length === 0) {
    return assigneesByTaskId;
  }

  const rows = await executor
    .select({
      taskId: taskAssignmentTable.taskId,
      userId: taskAssignmentTable.userId,
      name: userTable.name,
      image: userTable.image,
      units: taskAssignmentTable.units,
      work: taskAssignmentTable.work,
      createdAt: taskAssignmentTable.createdAt,
    })
    .from(taskAssignmentTable)
    .innerJoin(userTable, eq(taskAssignmentTable.userId, userTable.id))
    .where(inArray(taskAssignmentTable.taskId, taskIds))
    .orderBy(asc(taskAssignmentTable.createdAt), asc(taskAssignmentTable.id));

  for (const row of rows) {
    if (!assigneesByTaskId.has(row.taskId)) {
      assigneesByTaskId.set(row.taskId, []);
    }
    assigneesByTaskId.get(row.taskId)?.push({
      userId: row.userId,
      name: row.name,
      image: row.image,
      units: row.units,
      work: row.work,
    });
  }

  return assigneesByTaskId;
}
