import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { customFieldDefinitionTable } from "../../database/schema";
import { annotateCustomField } from "../effective-fields";
import { validateOptionColors } from "../validate-option-colors";

// Minimal definition update: renaming a field and editing its dropdown
// option colors. Changing `options` or `type` after creation would require
// re-validating every existing task value against the new shape, which is
// out of scope here (see create-custom-field.ts for that logic).
async function updateCustomField(
  id: string,
  name?: string,
  optionColors?: Record<string, string> | null,
) {
  const [existing] = await db
    .select()
    .from(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.id, id))
    .limit(1);

  if (!existing) {
    throw new HTTPException(404, { message: "Custom field not found" });
  }

  if (name !== undefined && !name.trim()) {
    throw new HTTPException(400, { message: "Name cannot be empty" });
  }

  if (optionColors !== undefined && optionColors !== null) {
    if (existing.type !== "dropdown") {
      throw new HTTPException(400, {
        message: "Option colors are only supported for dropdown fields",
      });
    }
    validateOptionColors(existing.options, optionColors);
  }

  const [updated] = await db
    .update(customFieldDefinitionTable)
    .set({
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(optionColors !== undefined ? { optionColors } : {}),
    })
    .where(eq(customFieldDefinitionTable.id, id))
    .returning();

  if (!updated) {
    throw new HTTPException(500, {
      message: "Failed to update custom field",
    });
  }

  return annotateCustomField(updated);
}

export default updateCustomField;
