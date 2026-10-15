import { eq, max } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  customFieldDefinitionTable,
  projectTable,
} from "../../database/schema";
import { annotateCustomField } from "../effective-fields";
import { insertMissingValues } from "../fill-default-values";
import { validateCustomFieldCreateInput } from "../validate-definition-input";

async function createCustomField(
  projectId: string,
  name: string,
  type: string,
  required: boolean,
  defaultValue?: string,
  options?: string[],
  optionColors?: Record<string, string>,
) {
  const [project] = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
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
    .where(eq(customFieldDefinitionTable.projectId, projectId));

  const field = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(customFieldDefinitionTable)
      .values({
        projectId,
        name,
        type,
        required,
        defaultValue: normalized.storedDefaultValue,
        options: normalized.options,
        optionColors: normalized.optionColors,
        position: (maxPositionResult?.maxPosition ?? 0) + 1,
      })
      .returning();

    if (!created) {
      throw new HTTPException(500, {
        message: "Failed to create custom field",
      });
    }

    const storedDefaultValue = normalized.storedDefaultValue;
    if (storedDefaultValue != null && storedDefaultValue.trim() !== "") {
      await insertMissingValues(tx, {
        projectId,
        fieldId: created.id,
        value: storedDefaultValue,
      });
    }

    return created;
  });

  return annotateCustomField(field);
}

export default createCustomField;
