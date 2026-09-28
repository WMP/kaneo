import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { resourceTable, workspaceTable } from "../../database/schema";
import type { ResourceKind } from "../schema";

async function createResource(
  workspaceId: string,
  kind: ResourceKind,
  name: string,
  email?: string,
) {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new HTTPException(400, { message: "Name cannot be empty" });
  }

  const [workspace] = await db
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);

  if (!workspace) {
    throw new HTTPException(404, { message: "Workspace not found" });
  }

  const [created] = await db
    .insert(resourceTable)
    .values({
      workspaceId,
      kind,
      name: trimmedName,
      email: email?.trim() || null,
    })
    .returning();

  if (!created) {
    throw new HTTPException(500, { message: "Failed to create resource" });
  }

  return created;
}

export default createResource;
