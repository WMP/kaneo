import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workspaceTable } from "../../database/schema";

async function getWorkspaceActivityRetention(workspaceId: string) {
  const workspace = await db.query.workspaceTable.findFirst({
    where: eq(workspaceTable.id, workspaceId),
    columns: { activityRetentionDays: true },
  });

  if (!workspace) {
    throw new HTTPException(404, { message: "Workspace not found" });
  }

  return { activityRetentionDays: workspace.activityRetentionDays ?? null };
}

export default getWorkspaceActivityRetention;
