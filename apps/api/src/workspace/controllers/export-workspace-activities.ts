import { desc, eq } from "drizzle-orm";
import db from "../../database";
import {
  activityTable,
  projectTable,
  taskTable,
  userTable,
} from "../../database/schema";
import {
  buildWorkspaceActivityWhereClause,
  normalizeActivityContent,
  type WorkspaceActivityFilters,
} from "./get-workspace-activities";

// An export runs unpaginated, so cap it to keep a very large, loosely
// filtered workspace from generating an unbounded response. One row over the
// cap is fetched to detect truncation without a second count query.
export const MAX_EXPORT_ROWS = 10_000;

async function exportWorkspaceActivities(
  workspaceId: string,
  filters: WorkspaceActivityFilters = {},
) {
  const whereClause = buildWorkspaceActivityWhereClause(workspaceId, filters);

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
    .limit(MAX_EXPORT_ROWS + 1);

  const truncated = rows.length > MAX_EXPORT_ROWS;
  const data = truncated ? rows.slice(0, MAX_EXPORT_ROWS) : rows;

  normalizeActivityContent(data);

  return { data, truncated };
}

export default exportWorkspaceActivities;
