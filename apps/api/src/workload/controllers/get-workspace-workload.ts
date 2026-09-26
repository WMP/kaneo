import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  not,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable, taskTable, userTable } from "../../database/schema";
import { taskIsCompleted } from "../../task/task-is-completed";
import { bucketizeWorkload, buildWeekBuckets } from "../bucket-workload";

// Keeps one huge, all-time-dated workspace from turning this into an
// unbounded scan; the response reports `truncated` when this is hit.
export const MAX_MATCHED_TASKS = 5000;

export type GetWorkspaceWorkloadOptions = {
  workspaceId: string;
  from: Date;
  to: Date;
};

async function getWorkspaceWorkload({
  workspaceId,
  from,
  to,
}: GetWorkspaceWorkloadOptions) {
  let buckets: ReturnType<typeof buildWeekBuckets>;
  try {
    buckets = buildWeekBuckets(from, to);
  } catch (error) {
    throw new HTTPException(400, {
      message: error instanceof Error ? error.message : "Invalid date range",
    });
  }

  const firstBucket = buckets[0];
  const lastBucket = buckets[buckets.length - 1];
  if (!firstBucket || !lastBucket) {
    // buildWeekBuckets always returns at least one bucket for a valid range.
    throw new HTTPException(500, { message: "Failed to build week buckets" });
  }
  const overallStart = firstBucket.start;
  const overallEnd = lastBucket.end;

  // A task overlaps the requested range when its span (startDate..dueDate,
  // or a single point when only one of them is set) touches
  // [overallStart, overallEnd).
  // `least`/`greatest` ignore NULLs, so a task with only one date collapses to
  // a point, and one whose due date is stored before its start date is still
  // normalized to [earlier, later] — matching how `bucketizeWorkload` swaps
  // reversed spans. Using coalesce here instead would drop such tasks even
  // though they overlap the range.
  const rangeOverlap = sql`
    least(${taskTable.startDate}, ${taskTable.dueDate}) < ${overallEnd}
    and greatest(${taskTable.startDate}, ${taskTable.dueDate}) >= ${overallStart}
  `;

  const matchedTasks = await db
    .select({
      assigneeId: taskTable.userId,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        // Archived projects are hidden from the active project list, so their
        // tasks must not inflate workload counts either.
        isNull(projectTable.archivedAt),
        or(isNotNull(taskTable.startDate), isNotNull(taskTable.dueDate)),
        not(taskIsCompleted),
        // `taskIsCompleted` only recognizes final columns; the virtual
        // "archived" status has no column, so exclude it explicitly the way
        // the schedulers do.
        ne(taskTable.status, "archived"),
        rangeOverlap,
      ),
    )
    // Deterministic order so that, when the safety cap truncates the result,
    // the same tasks are kept across identical requests instead of an
    // arbitrary DB-dependent subset.
    .orderBy(taskTable.dueDate, taskTable.startDate, taskTable.id)
    .limit(MAX_MATCHED_TASKS + 1);

  const truncated = matchedTasks.length > MAX_MATCHED_TASKS;
  const tasksForBucketing = truncated
    ? matchedTasks.slice(0, MAX_MATCHED_TASKS)
    : matchedTasks;

  const workloadRows = bucketizeWorkload(tasksForBucketing, buckets);

  const assigneeIds = workloadRows
    .map((row) => row.assigneeId)
    .filter((id): id is string => id !== null);

  const users = assigneeIds.length
    ? await db
        .select({
          id: userTable.id,
          name: userTable.name,
          image: userTable.image,
        })
        .from(userTable)
        .where(inArray(userTable.id, assigneeIds))
    : [];
  const userById = new Map(users.map((user) => [user.id, user]));

  const assignees = workloadRows
    .map((row) => {
      const user = row.assigneeId ? userById.get(row.assigneeId) : undefined;
      return {
        userId: row.assigneeId,
        name: user?.name ?? null,
        image: user?.image ?? null,
        counts: row.counts,
      };
    })
    .sort((a, b) => {
      // The unassigned row (null userId) always sorts last.
      if (a.userId === null) return b.userId === null ? 0 : 1;
      if (b.userId === null) return -1;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });

  return {
    buckets: buckets.map((bucket) => ({
      start: bucket.start,
      end: bucket.end,
    })),
    assignees,
    truncated,
  };
}

export default getWorkspaceWorkload;
