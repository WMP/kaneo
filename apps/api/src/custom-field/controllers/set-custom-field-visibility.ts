import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  customFieldDefinitionTable,
  projectHiddenFieldTable,
} from "../../database/schema";
import {
  annotateCustomField,
  getProjectWorkspaceId,
} from "../effective-fields";

async function setCustomFieldVisibility(
  projectId: string,
  fieldId: string,
  hidden: boolean,
) {
  const workspaceId = await getProjectWorkspaceId(projectId);

  const [field] = await db
    .select()
    .from(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.id, fieldId))
    .limit(1);

  if (!field) {
    throw new HTTPException(404, { message: "Custom field not found" });
  }

  if (field.workspaceId !== workspaceId) {
    throw new HTTPException(400, {
      message:
        "Only a workspace-level field of this project's workspace can be hidden or shown",
    });
  }

  if (hidden && field.required) {
    throw new HTTPException(403, {
      message: "A required workspace field cannot be hidden",
    });
  }

  if (hidden) {
    await db
      .insert(projectHiddenFieldTable)
      .values({ projectId, fieldId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(projectHiddenFieldTable)
      .where(
        and(
          eq(projectHiddenFieldTable.projectId, projectId),
          eq(projectHiddenFieldTable.fieldId, fieldId),
        ),
      );
  }

  return annotateCustomField(field, hidden);
}

export default setCustomFieldVisibility;
