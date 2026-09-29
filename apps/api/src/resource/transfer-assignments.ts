import { and, asc, eq, inArray } from "drizzle-orm";
import db from "../database";
import {
  projectTable,
  taskAssignmentTable,
  taskTable,
  userTable,
} from "../database/schema";
import { publishEvent } from "../events";
import { recomputeTaskPrimaryAssignees } from "../task/assignments";
import { projectScopeCondition } from "../utils/project-scope-filters";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// What `moveResourceAssignmentsToUser` changed on one task, for the events
// published after the transaction commits.
export type MovedAssignment = {
  taskId: string;
  projectId: string;
  title: string;
  // The task's primary assignee (`task.userId`) before and after.
  previousPrimaryId: string | null;
  newPrimaryId: string | null;
  // False when the account was already assigned to the task and only its
  // allocation was merged.
  userAdded: boolean;
};

type Candidate = { units: number; work: number | null };

// The allocation of a task that the resource and the account both had a share
// in: the higher `units` win (the sum is deliberately not taken), and `work` is
// kept when either side has it (the winner's first). A tie goes to the row that
// is listed first, and the account's own row is listed first.
export function mergeAssignmentAllocation(candidates: Candidate[]): Candidate {
  const [first, ...rest] = candidates;
  if (!first) return { units: 100, work: null };
  let winner = first;
  for (const candidate of rest) {
    if (candidate.units > winner.units) winner = candidate;
  }
  const work =
    winner.work ??
    candidates.find((candidate) => candidate.work !== null)?.work;
  return { units: winner.units, work: work ?? null };
}

// Moves the task assignments of `resourceIds` to the account `userId`, inside
// the caller's transaction.
//
// - Only assignments on tasks of projects in `projectScope` move (the projects
//   the account can open; `null` is every project of the workspace). An
//   assignment in another project stays on the resource, and the workload view
//   still counts it in the account's row.
// - An assignment the account does not have yet is converted in place (same
//   row, so its creation order is kept); when the account is assigned to that
//   task already, the two are merged into one row with `mergeAssignmentAllocation`.
// - Several resources linked to one account merge the same way.
// - `task.userId` (the primary mirror) is recomputed for every touched task.
export async function moveResourceAssignmentsToUser(
  tx: Transaction,
  {
    workspaceId,
    resourceIds,
    userId,
    projectScope,
  }: {
    workspaceId: string;
    resourceIds: string[];
    userId: string;
    projectScope: string[] | null;
  },
): Promise<MovedAssignment[]> {
  if (resourceIds.length === 0) return [];

  const scope = projectScopeCondition(projectTable.id, projectScope);
  const rows = await tx
    .select({
      id: taskAssignmentTable.id,
      taskId: taskAssignmentTable.taskId,
      units: taskAssignmentTable.units,
      work: taskAssignmentTable.work,
      projectId: taskTable.projectId,
      title: taskTable.title,
      primaryId: taskTable.userId,
    })
    .from(taskAssignmentTable)
    .innerJoin(taskTable, eq(taskAssignmentTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        inArray(taskAssignmentTable.resourceId, resourceIds),
        eq(projectTable.workspaceId, workspaceId),
        ...(scope ? [scope] : []),
      ),
    )
    .orderBy(asc(taskAssignmentTable.createdAt), asc(taskAssignmentTable.id))
    .for("update", { of: taskAssignmentTable });
  if (rows.length === 0) return [];

  const taskIds = [...new Set(rows.map((row) => row.taskId))];
  const existingRows = await tx
    .select({
      id: taskAssignmentTable.id,
      taskId: taskAssignmentTable.taskId,
      units: taskAssignmentTable.units,
      work: taskAssignmentTable.work,
    })
    .from(taskAssignmentTable)
    .where(
      and(
        eq(taskAssignmentTable.userId, userId),
        inArray(taskAssignmentTable.taskId, taskIds),
      ),
    )
    .for("update");
  const existingByTask = new Map(existingRows.map((row) => [row.taskId, row]));

  const moved: MovedAssignment[] = [];
  for (const taskId of taskIds) {
    const own = rows.filter((row) => row.taskId === taskId);
    const [head] = own;
    if (!head) continue;
    const existing = existingByTask.get(taskId);
    const merged = mergeAssignmentAllocation([
      ...(existing ? [existing] : []),
      ...own,
    ]);

    if (existing) {
      if (existing.units !== merged.units || existing.work !== merged.work) {
        await tx
          .update(taskAssignmentTable)
          .set({ units: merged.units, work: merged.work })
          .where(eq(taskAssignmentTable.id, existing.id));
      }
      await tx.delete(taskAssignmentTable).where(
        inArray(
          taskAssignmentTable.id,
          own.map((row) => row.id),
        ),
      );
    } else {
      // The oldest resource row becomes the account's row; the others (another
      // resource linked to the same account) are folded into it.
      await tx
        .update(taskAssignmentTable)
        .set({
          userId,
          resourceId: null,
          units: merged.units,
          work: merged.work,
        })
        .where(eq(taskAssignmentTable.id, head.id));
      const rest = own.slice(1).map((row) => row.id);
      if (rest.length > 0) {
        await tx
          .delete(taskAssignmentTable)
          .where(inArray(taskAssignmentTable.id, rest));
      }
    }

    moved.push({
      taskId,
      projectId: head.projectId,
      title: head.title,
      previousPrimaryId: head.primaryId,
      newPrimaryId: head.primaryId,
      userAdded: !existing,
    });
  }

  await recomputeTaskPrimaryAssignees(tx, taskIds);
  const primaries = await tx
    .select({ id: taskTable.id, userId: taskTable.userId })
    .from(taskTable)
    .where(inArray(taskTable.id, taskIds));
  const primaryByTask = new Map(primaries.map((row) => [row.id, row.userId]));
  for (const move of moved) {
    move.newPrimaryId = primaryByTask.get(move.taskId) ?? null;
  }
  return moved;
}

// The events a normal assignee change publishes, for what
// `moveResourceAssignmentsToUser` did, so the activity feed, the WebSocket
// clients of the project and the integrations see it. A task whose assignee list
// did not change for a user (the account was assigned already and only the
// allocation merged) publishes nothing, like a resource-only change in the
// assignee routes. Notifications are skipped: the person did not get a new task,
// their own tasks were re-attributed to them (`source`).
//
// Call it AFTER the transaction committed; a failing publish is logged and never
// undoes the link.
export async function publishMovedAssignments({
  moves,
  userId,
  actorUserId,
}: {
  moves: MovedAssignment[];
  userId: string;
  actorUserId: string;
}): Promise<void> {
  const changed = moves.filter(
    (move) => move.userAdded || move.previousPrimaryId !== move.newPrimaryId,
  );
  if (changed.length === 0) return;

  try {
    const [user] = await db
      .select({ name: userTable.name })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    const names = new Map<string, string | undefined>([[userId, user?.name]]);
    const missingPrimaries = [
      ...new Set(
        changed.flatMap((move) =>
          move.newPrimaryId && !names.has(move.newPrimaryId)
            ? [move.newPrimaryId]
            : [],
        ),
      ),
    ];
    if (missingPrimaries.length > 0) {
      const rows = await db
        .select({ id: userTable.id, name: userTable.name })
        .from(userTable)
        .where(inArray(userTable.id, missingPrimaries));
      for (const row of rows) names.set(row.id, row.name);
    }

    for (const move of changed) {
      if (!move.newPrimaryId) continue;
      await publishEvent("task.assignee_changed", {
        taskId: move.taskId,
        projectId: move.projectId,
        userId: actorUserId,
        oldAssignee: move.previousPrimaryId,
        newAssignee: names.get(move.newPrimaryId),
        newAssigneeId: move.newPrimaryId,
        addedAssigneeIds: move.userAdded ? [userId] : [],
        removedAssigneeIds: [],
        title: move.title,
        type: "assignee_changed",
        source: "resource_link",
      });
    }
  } catch (error) {
    console.error(
      "Publishing the assignee events of a resource link failed:",
      error,
    );
  }
}
