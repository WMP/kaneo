import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workspaceTable } from "../../database/schema";

async function getWorkspaceColumns(workspaceId: string) {
  const [workspace] = await db
    .select({ enforced: workspaceTable.enforceColumns })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);

  if (!workspace) {
    throw new HTTPException(404, { message: "Workspace not found" });
  }

  const rows = await db.query.workspaceColumnTable.findMany({
    where: (table, { eq }) => eq(table.workspaceId, workspaceId),
    orderBy: (table, { asc }) => [asc(table.position), asc(table.id)],
  });

  return { enforced: workspace.enforced, columns: rows };
}

export default getWorkspaceColumns;
