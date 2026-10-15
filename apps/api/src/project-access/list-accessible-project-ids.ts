import { eq } from "drizzle-orm";
import { schema } from "../database";
import { accessibleProjectIds } from "../utils/project-access";
import type { DbOrTx } from "./db-or-tx";

// Upstream signature; the decision is the fork's (see README.md). The fork
// returns `null` for full access, which means every project of the workspace.
export async function listAccessibleProjectIds(
  database: DbOrTx,
  workspaceId: string,
  userId: string,
): Promise<Set<string>> {
  const ids = await accessibleProjectIds(userId, workspaceId);
  if (ids !== null) return new Set(ids);
  const rows = await database
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.workspaceId, workspaceId));
  return new Set(rows.map((row) => row.id));
}
