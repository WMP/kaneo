import { and, asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { customFieldDefinitionTable } from "../../database/schema";
import { annotateCustomField } from "../effective-fields";

async function reorderWorkspaceCustomFields(
  workspaceId: string,
  customFields: Array<{ id: string; position: number }>,
) {
  await db.transaction(async (tx) => {
    for (const field of customFields) {
      const [updated] = await tx
        .update(customFieldDefinitionTable)
        .set({ position: field.position })
        .where(
          and(
            eq(customFieldDefinitionTable.id, field.id),
            eq(customFieldDefinitionTable.workspaceId, workspaceId),
          ),
        )
        .returning({ id: customFieldDefinitionTable.id });

      if (!updated) {
        throw new HTTPException(400, {
          message: `Custom field ${field.id} does not belong to this workspace`,
        });
      }
    }
  });

  const fields = await db
    .select()
    .from(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.workspaceId, workspaceId))
    .orderBy(asc(customFieldDefinitionTable.position));

  return fields.map((field) => annotateCustomField(field));
}

export default reorderWorkspaceCustomFields;
