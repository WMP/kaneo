import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workspaceTable } from "../../database/schema";

async function updateWorkspaceActivityRetention(
  workspaceId: string,
  activityRetentionDays: number | null,
) {
  // 0 and null both mean "disabled"; store a single canonical value so
  // every reader only has to check for null.
  const normalized =
    activityRetentionDays && activityRetentionDays > 0
      ? activityRetentionDays
      : null;

  const [workspace] = await db
    .update(workspaceTable)
    .set({ activityRetentionDays: normalized })
    .where(eq(workspaceTable.id, workspaceId))
    .returning({ activityRetentionDays: workspaceTable.activityRetentionDays });

  if (!workspace) {
    throw new HTTPException(404, { message: "Workspace not found" });
  }

  return { activityRetentionDays: workspace.activityRetentionDays ?? null };
}

export default updateWorkspaceActivityRetention;
