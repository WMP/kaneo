import { eq, max } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  customFieldDefinitionTable,
  customFieldValueTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../../database/schema";
import { annotateCustomField } from "../effective-fields";
import { validateCustomFieldCreateInput } from "../validate-definition-input";

async function createWorkspaceCustomField(
  workspaceId: string,
  name: string,
  type: string,
  required: boolean,
  defaultValue?: string,
  options?: string[],
  optionColors?: Record<string, string>,
  position?: number,
) {
  const [workspace] = await db
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);

  if (!workspace) {
    throw new HTTPException(404, { message: "Workspace not found" });
  }

  const normalized = validateCustomFieldCreateInput({
    name,
    type,
    required,
    defaultValue,
    options,
    optionColors,
  });

  const [maxPositionResult] = await db
    .select({ maxPosition: max(customFieldDefinitionTable.position) })
    .from(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.workspaceId, workspaceId));

  const resolvedPosition =
    position ?? (maxPositionResult?.maxPosition ?? 0) + 1;

  const field = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(customFieldDefinitionTable)
      .values({
        workspaceId,
        name,
        type,
        required,
        defaultValue: normalized.storedDefaultValue,
        options: normalized.options,
        optionColors: normalized.optionColors,
        position: resolvedPosition,
      })
      .returning();

    if (!created) {
      throw new HTTPException(500, {
        message: "Failed to create custom field",
      });
    }

    const storedDefaultValue = normalized.storedDefaultValue;
    if (storedDefaultValue != null && storedDefaultValue.trim() !== "") {
      // Backfill every task in every project of this workspace, mirroring
      // the project-scoped create's single-project backfill.
      const tasks = await tx
        .select({ id: taskTable.id })
        .from(taskTable)
        .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
        .where(eq(projectTable.workspaceId, workspaceId));

      const CHUNK_SIZE = 500;
      for (let i = 0; i < tasks.length; i += CHUNK_SIZE) {
        await tx
          .insert(customFieldValueTable)
          .values(
            tasks.slice(i, i + CHUNK_SIZE).map((task) => ({
              taskId: task.id,
              fieldId: created.id,
              value: storedDefaultValue,
            })),
          )
          .onConflictDoNothing();
      }
    }

    return created;
  });

  return annotateCustomField(field);
}

export default createWorkspaceCustomField;
