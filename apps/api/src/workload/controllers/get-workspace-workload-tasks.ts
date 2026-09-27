import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable, taskTable } from "../../database/schema";
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
};

async function getWorkspaceWorkloadTasks({
  workspaceId,
  from,
  to,
  assigneeId,
  projectId,
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

  const assigneeCondition =
    assigneeId === WORKLOAD_UNASSIGNED_ASSIGNEE
      ? isNull(taskTable.userId)
      : eq(taskTable.userId, assigneeId);

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
        ...notDoneDatedTaskConditions(workspaceId, projectId),
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
