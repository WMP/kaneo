import { and, eq, isNotNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  customFieldDefinitionTable,
  customFieldValueTable,
  projectHiddenFieldTable,
} from "../../database/schema";
import { codedError } from "../../utils/coded-error";
import { annotateCustomField } from "../effective-fields";
import {
  type CustomFieldUpdatePatch,
  planCustomFieldUpdate,
} from "../plan-custom-field-update";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The removed options that at least one task still holds for this field. */
async function findOptionsInUse(
  tx: Tx,
  fieldId: string,
  type: string,
  removedOptions: string[],
): Promise<string[]> {
  if (removedOptions.length === 0) return [];

  const rows = await tx
    .selectDistinct({ value: customFieldValueTable.value })
    .from(customFieldValueTable)
    .where(
      and(
        eq(customFieldValueTable.fieldId, fieldId),
        isNotNull(customFieldValueTable.value),
      ),
    );

  const used = new Set<string>();
  for (const { value } of rows) {
    if (!value) continue;
    if (type === "multiselect") {
      try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === "string") used.add(item.trim());
          }
        }
      } catch {
        // Not a JSON array: cannot reference an option.
      }
    } else {
      used.add(value.trim());
    }
  }

  return removedOptions.filter((option) => used.has(option));
}

// Edits a field definition: name, required, default value, options and
// option colors, for a project-level or a workspace-level field. The type is
// immutable. The edit is merged over the stored row and validated as a whole
// with the create rules, then written in one transaction (all or nothing).
// Existing task values are never rewritten or backfilled; instead an option
// that tasks still use cannot be removed.
async function updateCustomField(id: string, patch: CustomFieldUpdatePatch) {
  const updated = await db.transaction(async (tx) => {
    // Lock the definition so concurrent edits of one field serialize.
    const [existing] = await tx
      .select()
      .from(customFieldDefinitionTable)
      .where(eq(customFieldDefinitionTable.id, id))
      .limit(1)
      .for("update");

    if (!existing) {
      throw new HTTPException(404, { message: "Custom field not found" });
    }

    const plan = planCustomFieldUpdate(existing, patch);

    const optionsInUse = await findOptionsInUse(
      tx,
      id,
      existing.type,
      plan.removedOptions,
    );
    if (optionsInUse.length > 0) {
      throw codedError(
        409,
        "CUSTOM_FIELD_OPTION_IN_USE",
        `Cannot remove option(s) still used by existing tasks: ${optionsInUse.join(", ")}. Change or clear those task values first.`,
      );
    }

    // A required workspace field can never be hidden (see
    // set-custom-field-visibility.ts), so it cannot become required while a
    // project still hides it. Only the project count is reported: the names
    // of projects the caller cannot open are not theirs to see.
    if (plan.required && !existing.required && existing.workspaceId) {
      const hidden = await tx
        .select({ projectId: projectHiddenFieldTable.projectId })
        .from(projectHiddenFieldTable)
        .where(eq(projectHiddenFieldTable.fieldId, id));

      if (hidden.length > 0) {
        throw codedError(
          409,
          "CUSTOM_FIELD_HIDDEN_IN_PROJECTS",
          `Cannot make this field required while it is hidden in ${hidden.length} project(s). Unhide it in those projects first.`,
        );
      }
    }

    const [row] = await tx
      .update(customFieldDefinitionTable)
      .set({
        name: plan.name,
        required: plan.required,
        defaultValue: plan.defaultValue,
        ...(plan.options !== null ? { options: plan.options } : {}),
        optionColors: plan.optionColors,
      })
      .where(eq(customFieldDefinitionTable.id, id))
      .returning();

    if (!row) {
      throw new HTTPException(500, {
        message: "Failed to update custom field",
      });
    }

    return row;
  });

  return annotateCustomField(updated);
}

export default updateCustomField;
