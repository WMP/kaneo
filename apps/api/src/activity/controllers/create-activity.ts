import db from "../../database";
import { activityTable } from "../../database/schema";

async function createActivity(
  taskId: string,
  type: string,
  // Null for an event no Kaneo user caused (a change observed in Jira).
  userId: string | null,
  content: string | null,
  eventData?: Record<string, unknown> | null,
) {
  const [activity] = await db
    .insert(activityTable)
    .values({
      taskId,
      type,
      userId,
      content,
      eventData: eventData ?? null,
    })
    .returning();
  // taskId is a required parameter here (this is always task-scoped
  // activity), so the row's taskId is never null — narrow it back from the
  // column's now-nullable type (see activityTable.workspaceId in schema.ts).
  return activity ? { ...activity, taskId } : activity;
}

export default createActivity;
