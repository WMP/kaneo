import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  activityTable,
  projectTable,
  taskTable,
  userTable,
} from "../../database/schema";

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
  from?: string;
  to?: string;
};

export type GetWorkspaceActivitiesOptions = WorkspaceActivityFilters & {
  page?: number;
  limit?: number;
};

// Shared by the paginated listing and the export endpoint, so the two
// surfaces can never drift on what counts as "matching activity".
export function buildWorkspaceActivityWhereClause(
  workspaceId: string,
  options: WorkspaceActivityFilters = {},
) {
  const conditions = [eq(projectTable.workspaceId, workspaceId)];

  if (options.userId) {
    conditions.push(eq(activityTable.userId, options.userId));
  }

  if (options.type) {
    conditions.push(eq(activityTable.type, options.type));
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
  options: GetWorkspaceActivitiesOptions = {},
) {
  const whereClause = buildWorkspaceActivityWhereClause(workspaceId, options);

  const page = options.page && options.page > 0 ? options.page : 1;
  const pageSize =
    options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 50;
  const offset = (page - 1) * pageSize;

  const countQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(activityTable)
    .innerJoin(taskTable, eq(activityTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
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
    .innerJoin(taskTable, eq(activityTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
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
