import { and, asc, eq, inArray, isNotNull, notInArray, or } from "drizzle-orm";
import type db from "../database";
import {
  resourceTable,
  taskAssignmentTable,
  taskTable,
  userTable,
} from "../database/schema";

// A task assignee target: either a real Kaneo user, or an account-less
// resource (person/equipment/material) from `ganttpro_resource`. Exactly one
// of the two keys is present, mirroring the `ganttpro_assignment_target`
// check constraint on the row this becomes.
// Why an assignee change was published, when it is not an ordinary assignment:
// "resource_link" is a resource's assignments moving to the account it was
// linked to (the account's own tasks re-attributed, not new work).
export type AssigneeChangeSource = "resource_link";

export type AssigneeTarget = { userId: string } | { resourceId: string };

function isUserTarget(target: AssigneeTarget): target is { userId: string } {
  return "userId" in target;
}

export type TaskAssignee = {
  // Exactly one of userId/resourceId is set, mirroring AssigneeTarget.
  userId: string | null;
  resourceId: string | null;
  // "user" for a real account; otherwise the resource's own kind.
  kind: "user" | "person" | "equipment" | "material";
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

function targetKey(target: AssigneeTarget): string {
  return isUserTarget(target) ? `u:${target.userId}` : `r:${target.resourceId}`;
}

function dedupeTargets(targets: AssigneeTarget[]): AssigneeTarget[] {
  const seen = new Set<string>();
  const deduped: AssigneeTarget[] = [];

  for (const raw of targets) {
    let target: AssigneeTarget | null = null;
    if (isUserTarget(raw)) {
      const userId = raw.userId?.trim();
      if (userId) target = { userId };
    } else {
      const resourceId = raw.resourceId?.trim();
      if (resourceId) target = { resourceId };
    }
    if (!target) continue;

    const key = targetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(target);
  }

  return deduped;
}

/**
 * Replaces a task's full assignee list and keeps `task.userId` (DB column
 * "assignee_id") — the denormalized "primary assignee" mirror every
 * pre-existing single-assignee call-site still reads — equal to the first
 * USER target in the list, or null when the list has no user target at all
 * (a resource-only assignment leaves the mirror null; this is the only
 * writer of `ganttpro_task_assignment`, so every assignee mutation must go
 * through it so the table and the mirror never drift apart).
 *
 * Every target is trusted as already validated (workspace membership for a
 * user, workspace ownership for a resource) — every call site validates
 * before calling this, the same way the single-assignee routes always have
 * (see `utils/assert-assignable-user.ts` and
 * `resource/workspace-resources.ts`).
 *
 * Runs in its own transaction (a nested one, via SAVEPOINT, when `executor`
 * is already inside one) so the delete/insert/mirror-update land atomically.
 */
export async function setTaskAssignees(
  executor: Executor,
  taskId: string,
  targets: AssigneeTarget[],
): Promise<AssigneeTarget[]> {
  const deduped = dedupeTargets(targets);

  const userIds = deduped.filter(isUserTarget).map((t) => t.userId);
  const resourceIds = deduped
    .filter((t): t is { resourceId: string } => !isUserTarget(t))
    .map((t) => t.resourceId);

  const primaryTarget = deduped.find(isUserTarget);
  const primaryUserId = primaryTarget?.userId ?? null;

  await executor.transaction(async (tx) => {
    // A row targets either a user or a resource, never both (see the
    // ganttpro_assignment_target check constraint), so "stale" splits into
    // two independent conditions: a user-row whose userId fell out of the
    // new list, or a resource-row whose resourceId did. `x NOT IN (...)`
    // is NULL (never true) for a NULL column, so each condition only ever
    // matches rows of its own kind.
    const staleUserRows =
      userIds.length > 0
        ? and(
            isNotNull(taskAssignmentTable.userId),
            notInArray(taskAssignmentTable.userId, userIds),
          )
        : isNotNull(taskAssignmentTable.userId);
    const staleResourceRows =
      resourceIds.length > 0
        ? and(
            isNotNull(taskAssignmentTable.resourceId),
            notInArray(taskAssignmentTable.resourceId, resourceIds),
          )
        : isNotNull(taskAssignmentTable.resourceId);

    await tx
      .delete(taskAssignmentTable)
      .where(
        and(
          eq(taskAssignmentTable.taskId, taskId),
          or(staleUserRows, staleResourceRows),
        ),
      );

    if (userIds.length > 0) {
      await tx
        .insert(taskAssignmentTable)
        .values(userIds.map((userId) => ({ taskId, userId })))
        .onConflictDoNothing({
          target: [taskAssignmentTable.taskId, taskAssignmentTable.userId],
        });
    }

    if (resourceIds.length > 0) {
      await tx
        .insert(taskAssignmentTable)
        .values(resourceIds.map((resourceId) => ({ taskId, resourceId })))
        .onConflictDoNothing({
          target: [taskAssignmentTable.taskId, taskAssignmentTable.resourceId],
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
 * Resets `task.userId` to the assignment table's first USER row for each
 * given task (by createdAt, then id, for a stable "first"; a resource-only
 * row is skipped since it never becomes the primary mirror), or null when a
 * task has no user row. Use this instead of `setTaskAssignees` when
 * assignment rows were removed by something other than a normal assignee
 * mutation — e.g. a cross-workspace project move deleting a non-member's
 * assignment — so the mirror stays correct without touching rows that are
 * still valid.
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
  const resolvedTaskIds = new Set<string>();
  for (const row of remaining) {
    if (resolvedTaskIds.has(row.taskId) || row.userId === null) continue;
    primaryByTaskId.set(row.taskId, row.userId);
    resolvedTaskIds.add(row.taskId);
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
 * Batched read of every task's assignee list, joined to the user and
 * resource tables for display fields — mirrors the labels-map pattern in
 * get-tasks.ts so a task list page issues one query for this instead of one
 * per task.
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
      resourceId: taskAssignmentTable.resourceId,
      userName: userTable.name,
      userImage: userTable.image,
      resourceName: resourceTable.name,
      resourceKind: resourceTable.kind,
      units: taskAssignmentTable.units,
      work: taskAssignmentTable.work,
      createdAt: taskAssignmentTable.createdAt,
    })
    .from(taskAssignmentTable)
    .leftJoin(userTable, eq(taskAssignmentTable.userId, userTable.id))
    .leftJoin(
      resourceTable,
      eq(taskAssignmentTable.resourceId, resourceTable.id),
    )
    .where(inArray(taskAssignmentTable.taskId, taskIds))
    .orderBy(asc(taskAssignmentTable.createdAt), asc(taskAssignmentTable.id));

  for (const row of rows) {
    if (!assigneesByTaskId.has(row.taskId)) {
      assigneesByTaskId.set(row.taskId, []);
    }

    const isUser = row.userId !== null;
    assigneesByTaskId.get(row.taskId)?.push({
      userId: isUser ? row.userId : null,
      resourceId: isUser ? null : row.resourceId,
      kind: isUser
        ? "user"
        : ((row.resourceKind ?? "person") as
            | "person"
            | "equipment"
            | "material"),
      name: (isUser ? row.userName : row.resourceName) ?? "",
      image: isUser ? row.userImage : null,
      units: row.units,
      work: row.work,
    });
  }

  return assigneesByTaskId;
}
