import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  activityTable,
  projectTable,
  taskTable,
  userTable,
} from "../../database/schema";
import { accessibleProjectIds } from "../../utils/project-access";
import {
  projectScopeCondition,
  relationActivityExclusionForIds,
} from "../../utils/project-scope-filters";

// `from`/`to` arrive as free-form strings, so an unparseable value would
// otherwise reach Drizzle and throw when it serializes an Invalid Date to
// ISO, surfacing as a 500. Reject it as a 400 instead.
function parseFilterDate(value: string, field: "from" | "to") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HTTPException(400, {
      message: `Invalid "${field}" timestamp`,
    });
  }
  return date;
}

export type WorkspaceActivityFilters = {
  userId?: string;
  type?: string;
  projectId?: string;
  from?: string;
  to?: string;
};

export type GetWorkspaceActivitiesOptions = WorkspaceActivityFilters & {
  page?: number;
  limit?: number;
};

// Shared by the paginated listing and the export endpoint, so the two
// surfaces can never drift on what counts as "matching activity".
//
// `visibleProjectIds` is the caller's project scope (`accessibleProjectIds`):
// `null` for full access. Otherwise task-scoped activity is limited to those
// projects; workspace-level activity (no task, so tied to no project) stays
// visible, because it describes the workspace and not any project's work.
export function buildWorkspaceActivityWhereClause(
  workspaceId: string,
  visibleProjectIds: string[] | null,
  options: WorkspaceActivityFilters = {},
) {
  // Task-scoped activity matches via its project's workspace (the join
  // below); workspace-level activity (e.g. calendar changes, no task) sets
  // activityTable.workspaceId directly instead, since there's no project row
  // to join through.
  const taskScoped = and(
    eq(projectTable.workspaceId, workspaceId),
    projectScopeCondition(projectTable.id, visibleProjectIds),
  );
  const conditions = [
    or(taskScoped, eq(activityTable.workspaceId, workspaceId)),
    // A relation event that names a task of an inaccessible project is dropped.
    relationActivityExclusionForIds(visibleProjectIds),
  ];

  if (options.userId) {
    conditions.push(eq(activityTable.userId, options.userId));
  }

  if (options.type) {
    conditions.push(eq(activityTable.type, options.type));
  }

  if (options.projectId) {
    conditions.push(eq(projectTable.id, options.projectId));
  }

  if (options.from) {
    conditions.push(
      gte(activityTable.createdAt, parseFilterDate(options.from, "from")),
    );
  }

  if (options.to) {
    conditions.push(
      lte(activityTable.createdAt, parseFilterDate(options.to, "to")),
    );
  }

  return and(...conditions);
}

// Collapse runs of blank lines in non-comment activity content so system
// events render compactly; comments keep their author's exact formatting.
// Shared so the listing and the export normalize identically.
export function normalizeActivityContent<
  T extends { content: string | null; type: string },
>(rows: T[]) {
  for (const row of rows) {
    if (row.content && row.type !== "comment") {
      row.content = row.content.replace(/\n+/g, "\n");
    }
  }
  return rows;
}

async function getWorkspaceActivities(
  workspaceId: string,
  userId: string,
  options: GetWorkspaceActivitiesOptions = {},
) {
  const visibleProjectIds = await accessibleProjectIds(userId, workspaceId);
  const whereClause = buildWorkspaceActivityWhereClause(
    workspaceId,
    visibleProjectIds,
    options,
  );

  const page = options.page && options.page > 0 ? options.page : 1;
  const pageSize =
    options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 50;
  const offset = (page - 1) * pageSize;

  const countQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(activityTable)
    .leftJoin(taskTable, eq(activityTable.taskId, taskTable.id))
    .leftJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(whereClause);

  const rowsQuery = db
    .select({
      id: activityTable.id,
      taskId: activityTable.taskId,
      taskNumber: taskTable.number,
      taskTitle: taskTable.title,
      projectId: projectTable.id,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      type: activityTable.type,
      createdAt: activityTable.createdAt,
      userId: activityTable.userId,
      userName: userTable.name,
      userImage: userTable.image,
      content: activityTable.content,
      eventData: activityTable.eventData,
      externalUserName: activityTable.externalUserName,
      externalUserAvatar: activityTable.externalUserAvatar,
      externalSource: activityTable.externalSource,
      externalUrl: activityTable.externalUrl,
    })
    .from(activityTable)
    .leftJoin(taskTable, eq(activityTable.taskId, taskTable.id))
    .leftJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(userTable, eq(activityTable.userId, userTable.id))
    .where(whereClause)
    .orderBy(desc(activityTable.createdAt), desc(activityTable.id))
    .limit(pageSize)
    .offset(offset);

  // The count and the page are independent queries, so run them concurrently.
  const [[countRow], rows] = await Promise.all([countQuery, rowsQuery]);

  const total = Number(countRow?.count ?? 0);

  normalizeActivityContent(rows);

  return {
    data: rows,
    pagination: {
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

export default getWorkspaceActivities;
