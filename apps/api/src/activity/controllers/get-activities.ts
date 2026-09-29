import { and, desc, eq } from "drizzle-orm";
import db from "../../database";
import { activityTable } from "../../database/schema";
import { relationActivityExclusionForIds } from "../../utils/project-scope-filters";

// `visibleProjectIds` is the viewer's project scope (`null`: full access).
// Relation activity that names a task of a project they cannot open is left out.
async function getActivitiesFromTaskId(
  taskId: string,
  visibleProjectIds: string[] | null,
) {
  const activities = await db.query.activityTable.findMany({
    where: and(
      eq(activityTable.taskId, taskId),
      relationActivityExclusionForIds(visibleProjectIds),
    ),
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
