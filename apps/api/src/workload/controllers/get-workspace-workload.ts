import { and, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectTable,
  resourceTable,
  taskAssignmentTable,
  taskTable,
  userTable,
} from "../../database/schema";
import getWorkspaceMembers from "../../workspace/controllers/get-workspace-members";
import {
  bucketizeWorkload,
  buildWeekBuckets,
  type WorkloadTaskAssignee,
} from "../bucket-workload";
import { notDoneDatedTaskConditions } from "../matched-task-conditions";

// Keeps one huge, all-time-dated workspace from turning this into an
// unbounded scan; the response reports `truncated` when this is hit.
export const MAX_MATCHED_TASKS = 5000;

export type GetWorkspaceWorkloadOptions = {
  workspaceId: string;
  from: Date;
  to: Date;
  projectId?: string;
};

async function getWorkspaceWorkload({
  workspaceId,
  from,
  to,
  projectId,
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
      id: taskTable.id,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(...notDoneDatedTaskConditions(workspaceId, projectId), rangeOverlap),
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

  // The split is based on `ganttpro_task_assignment` — one row per
  // task×assignee, carrying each row's `units` — rather than the
  // denormalized `taskTable.userId` primary mirror, so a multi-assignee task
  // splits its per-bucket contribution instead of counting once against its
  // primary. A 'person' resource counts here exactly like a user, keyed by
  // its own resource id; 'equipment'/'material' rows are excluded entirely —
  // they aren't people-capacity, and costs are a later phase.
  const matchedTaskIds = tasksForBucketing.map((task) => task.id);
  const assignmentRows = matchedTaskIds.length
    ? await db
        .select({
          taskId: taskAssignmentTable.taskId,
          userId: taskAssignmentTable.userId,
          resourceId: taskAssignmentTable.resourceId,
          resourceKind: resourceTable.kind,
          units: taskAssignmentTable.units,
        })
        .from(taskAssignmentTable)
        .leftJoin(
          resourceTable,
          eq(taskAssignmentTable.resourceId, resourceTable.id),
        )
        .where(inArray(taskAssignmentTable.taskId, matchedTaskIds))
    : [];
  const assigneesByTaskId = new Map<string, WorkloadTaskAssignee[]>();
  for (const row of assignmentRows) {
    const key =
      row.userId ?? (row.resourceKind === "person" ? row.resourceId : null);
    if (key === null) continue; // equipment/material: excluded from capacity.

    if (!assigneesByTaskId.has(row.taskId)) {
      assigneesByTaskId.set(row.taskId, []);
    }
    assigneesByTaskId.get(row.taskId)?.push({ userId: key, units: row.units });
  }

  const workloadRows = bucketizeWorkload(
    tasksForBucketing.map((task) => ({
      assignees: assigneesByTaskId.get(task.id) ?? [],
      startDate: task.startDate,
      dueDate: task.dueDate,
    })),
    buckets,
  );

  // Every current workspace member and person-resource gets a row, even with
  // zero matching tasks, so absence of load is visible instead of silently
  // disappearing from the table. The unassigned row (`null`) is left as-is:
  // it only appears when at least one unassigned task matched.
  const members = await getWorkspaceMembers(workspaceId);
  const personResources = await db
    .select({
      id: resourceTable.id,
      name: resourceTable.name,
    })
    .from(resourceTable)
    .where(
      and(
        eq(resourceTable.workspaceId, workspaceId),
        eq(resourceTable.kind, "person"),
      ),
    );

  const rowByAssigneeId = new Map(
    workloadRows.map((row) => [row.assigneeId, row]),
  );
  const zeroCounts = () => new Array(buckets.length).fill(0);
  for (const member of members) {
    if (!rowByAssigneeId.has(member.id)) {
      rowByAssigneeId.set(member.id, {
        assigneeId: member.id,
        counts: zeroCounts(),
      });
    }
  }
  for (const resource of personResources) {
    if (!rowByAssigneeId.has(resource.id)) {
      rowByAssigneeId.set(resource.id, {
        assigneeId: resource.id,
        counts: zeroCounts(),
      });
    }
  }
  const allRows = Array.from(rowByAssigneeId.values());

  const memberById = new Map(members.map((member) => [member.id, member]));
  const personResourceById = new Map(
    personResources.map((resource) => [resource.id, resource]),
  );
  // A task can stay assigned to a user who has since left the workspace, or
  // to a person-resource deleted after being assigned; neither list above
  // would have them, so look those few up separately instead of dropping
  // their row.
  const missingIds = allRows
    .map((row) => row.assigneeId)
    .filter(
      (id): id is string =>
        id !== null && !memberById.has(id) && !personResourceById.has(id),
    );
  const [missingUsers, missingResources] = missingIds.length
    ? await Promise.all([
        db
          .select({
            id: userTable.id,
            name: userTable.name,
            image: userTable.image,
          })
          .from(userTable)
          .where(inArray(userTable.id, missingIds)),
        db
          .select({ id: resourceTable.id, name: resourceTable.name })
          .from(resourceTable)
          .where(
            and(
              inArray(resourceTable.id, missingIds),
              eq(resourceTable.kind, "person"),
            ),
          ),
      ])
    : [[], []];
  const userById = new Map([
    ...members.map(
      (member): [string, { name: string; image: string | null }] => [
        member.id,
        member,
      ],
    ),
    ...missingUsers.map(
      (user): [string, { name: string; image: string | null }] => [
        user.id,
        user,
      ],
    ),
  ]);
  const resourceById = new Map([
    ...personResources.map((resource): [string, { name: string }] => [
      resource.id,
      resource,
    ]),
    ...missingResources.map((resource): [string, { name: string }] => [
      resource.id,
      resource,
    ]),
  ]);

  const assignees = allRows
    .map((row) => {
      const user = row.assigneeId ? userById.get(row.assigneeId) : undefined;
      const resource = row.assigneeId
        ? resourceById.get(row.assigneeId)
        : undefined;
      return {
        userId: row.assigneeId,
        name: user?.name ?? resource?.name ?? null,
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
