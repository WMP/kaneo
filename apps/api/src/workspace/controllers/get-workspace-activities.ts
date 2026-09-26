import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import db from "../../database";
import {
  activityTable,
  projectTable,
  taskTable,
  userTable,
} from "../../database/schema";

export type GetWorkspaceActivitiesOptions = {
  userId?: string;
  type?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
};

async function getWorkspaceActivities(
  workspaceId: string,
  options: GetWorkspaceActivitiesOptions = {},
) {
  const conditions = [eq(projectTable.workspaceId, workspaceId)];

  if (options.userId) {
    conditions.push(eq(activityTable.userId, options.userId));
  }

  if (options.type) {
    conditions.push(eq(activityTable.type, options.type));
  }

  if (options.from) {
    conditions.push(gte(activityTable.createdAt, new Date(options.from)));
  }

  if (options.to) {
    conditions.push(lte(activityTable.createdAt, new Date(options.to)));
  }

  const whereClause = and(...conditions);

  const page = options.page && options.page > 0 ? options.page : 1;
  const pageSize =
    options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 50;
  const offset = (page - 1) * pageSize;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(activityTable)
    .innerJoin(taskTable, eq(activityTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(whereClause);

  const total = Number(countRow?.count ?? 0);

  const rows = await db
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

  for (const row of rows) {
    if (row.content && row.type !== "comment") {
      row.content = row.content.replace(/\n+/g, "\n");
    }
  }

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
