import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  customFieldDefinitionTable,
  projectTable,
} from "../../database/schema";
import { annotateCustomField } from "../effective-fields";

async function deleteCustomField(id: string) {
  const [field] = await db
    .select({
      projectId: customFieldDefinitionTable.projectId,
      workspaceId: customFieldDefinitionTable.workspaceId,
    })
    .from(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.id, id))
    .limit(1);

  if (!field) {
    throw new HTTPException(404, {
      message: "Custom field not found",
    });
  }

  // Workspace-level fields already carry their workspaceId directly;
  // project-level fields resolve it through their project, which must
  // exist (guards against an orphaned reference).
  if (!field.workspaceId && field.projectId) {
    const [project] = await db
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(eq(projectTable.id, field.projectId))
      .limit(1);

    if (!project) {
      throw new HTTPException(400, {
        message: "The project is not associated with a workspace",
      });
    }
  }

  const [deleted] = await db
    .delete(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.id, id))
    .returning();

  if (!deleted) {
    throw new HTTPException(404, {
      message: "Custom field not found",
    });
  }

  return annotateCustomField(deleted);
}

export default deleteCustomField;
