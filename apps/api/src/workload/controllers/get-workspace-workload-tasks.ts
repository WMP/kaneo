import { and, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectTable,
  resourceTable,
  taskAssignmentTable,
  taskTable,
} from "../../database/schema";
import { loadVisibleAccountIds } from "../../resource/fold-linked-resources";
import { accessibleProjectIds } from "../../utils/project-access";
import { startOfUtcDay } from "../bucket-workload";
import { notDoneDatedTaskConditions } from "../matched-task-conditions";
import { WORKLOAD_UNASSIGNED_ASSIGNEE } from "../schema";

// A drill-through is scoped to one assignee, so it never needs anywhere near
// the aggregate view's cap; this just keeps a pathological single-assignee
// backlog from turning into an unbounded scan.
export const MAX_WORKLOAD_TASKS = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

export type GetWorkspaceWorkloadTasksOptions = {
  workspaceId: string;
  from: Date;
  to: Date;
  assigneeId: string;
  projectId?: string;
  /** The caller; a caller without full access only drills into their projects. */
  userId: string;
};

async function getWorkspaceWorkloadTasks({
  workspaceId,
  from,
  to,
  assigneeId,
  projectId,
  userId,
}: GetWorkspaceWorkloadTasksOptions) {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new HTTPException(400, {
      message: "`from` and `to` must be valid dates",
    });
  }

  // Unlike the aggregate view's weekly buckets, this drill-through matches
  // the exact requested range: [from's day, to's day] inclusive.
  const rangeStart = startOfUtcDay(from);
  const rangeEnd = new Date(startOfUtcDay(to).getTime() + DAY_MS);
  if (rangeEnd <= rangeStart) {
    throw new HTTPException(400, {
      message: "`to` must not be before `from`",
    });
  }

  // Membership in `ganttpro_task_assignment`, not equality with the primary
  // mirror, so a task drills through under every one of its assignees, not
  // only its primary. The unassigned case still reads the mirror: it stays
  // null exactly when the assignment table has no rows for the task (see
  // `setTaskAssignees`), so `isNull` here is equivalent and cheaper.
  // `assigneeId` is either a user id or a person-resource id — the aggregate
  // workload view keys a person-resource's row by its own resource id (see
  // get-workspace-workload.ts), so this drill-through accepts either.
  const visibleProjectIds = await accessibleProjectIds(userId, workspaceId);
  // The resources linked to this account count in its row only for a caller
  // who may see the account (`foldTargetId`), so the drill-through never
  // confirms who a resource is linked to.
  const accountVisible =
    assigneeId !== WORKLOAD_UNASSIGNED_ASSIGNEE &&
    (
      await loadVisibleAccountIds(workspaceId, userId, visibleProjectIds, [
        assigneeId,
      ])
    ).has(assigneeId);
  const assigneeCondition =
    assigneeId === WORKLOAD_UNASSIGNED_ASSIGNEE
      ? isNull(taskTable.userId)
      : exists(
          db
            .select({ one: sql`1` })
            .from(taskAssignmentTable)
            .where(
              and(
                eq(taskAssignmentTable.taskId, taskTable.id),
                or(
                  eq(taskAssignmentTable.userId, assigneeId),
                  eq(taskAssignmentTable.resourceId, assigneeId),
                  accountVisible
                    ? inArray(
                        taskAssignmentTable.resourceId,
                        db
                          .select({ id: resourceTable.id })
                          .from(resourceTable)
                          .where(
                            and(
                              eq(resourceTable.userId, assigneeId),
                              eq(resourceTable.kind, "person"),
                              eq(resourceTable.workspaceId, workspaceId),
                            ),
                          ),
                      )
                    : undefined,
                ),
              ),
            ),
        );

  // Same overlap logic as the aggregate view, see its own comment.
  const rangeOverlap = sql`
    least(${taskTable.startDate}, ${taskTable.dueDate}) < ${rangeEnd}
    and greatest(${taskTable.startDate}, ${taskTable.dueDate}) >= ${rangeStart}
  `;

  const rows = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      status: taskTable.status,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      taskNumber: taskTable.number,
      projectId: taskTable.projectId,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        ...notDoneDatedTaskConditions(
          workspaceId,
          visibleProjectIds,
          projectId,
        ),
        assigneeCondition,
        rangeOverlap,
      ),
    )
    .orderBy(taskTable.dueDate, taskTable.startDate, taskTable.id)
    .limit(MAX_WORKLOAD_TASKS + 1);

  const truncated = rows.length > MAX_WORKLOAD_TASKS;

  return {
    tasks: truncated ? rows.slice(0, MAX_WORKLOAD_TASKS) : rows,
    truncated,
  };
}

export default getWorkspaceWorkloadTasks;
