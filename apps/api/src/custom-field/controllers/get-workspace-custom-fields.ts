import { asc, eq } from "drizzle-orm";
import db from "../../database";
import { customFieldDefinitionTable } from "../../database/schema";
import { annotateCustomField } from "../effective-fields";

async function getWorkspaceCustomFields(workspaceId: string) {
  const fields = await db
    .select()
    .from(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.workspaceId, workspaceId))
    .orderBy(asc(customFieldDefinitionTable.position));

  return fields.map((field) => annotateCustomField(field));
}

export default getWorkspaceCustomFields;
