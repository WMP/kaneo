import { desc, eq } from "drizzle-orm";
import db from "../../database";
import { activityTable } from "../../database/schema";

async function getActivitiesFromTaskId(taskId: string) {
  const activities = await db.query.activityTable.findMany({
    where: eq(activityTable.taskId, taskId),
    orderBy: [desc(activityTable.createdAt)],
  });

  activities.forEach((x) => {
    if (x.content && x.type !== "comment") {
      x.content = x.content.replace(/\n+/g, "\n");
    }
    // Every row here is filtered to this exact taskId, so it's always
    // task-scoped — narrow it back from the column's now-nullable type (see
    // activityTable.workspaceId in schema.ts).
    x.taskId = taskId;
  });

  return activities as (Omit<(typeof activities)[number], "taskId"> & {
    taskId: string;
  })[];
}

export default getActivitiesFromTaskId;
