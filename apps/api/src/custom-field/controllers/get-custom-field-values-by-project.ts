import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import {
  customFieldDefinitionTable,
  customFieldValueTable,
  taskTable,
} from "../../database/schema";
import { getEffectiveFieldIdSet } from "../effective-fields";

async function getCustomFieldValuesByProject(projectId: string) {
  const effectiveFieldIds = await getEffectiveFieldIdSet(projectId);

  if (effectiveFieldIds.size === 0) {
    return [];
  }

  return db
    .select({
      id: customFieldValueTable.id,
      taskId: customFieldValueTable.taskId,
      fieldId: customFieldValueTable.fieldId,
      value: customFieldValueTable.value,
      fieldName: customFieldDefinitionTable.name,
      fieldPosition: customFieldDefinitionTable.position,
      fieldType: customFieldDefinitionTable.type,
      fieldOptions: customFieldDefinitionTable.options,
      fieldOptionColors: customFieldDefinitionTable.optionColors,
    })
    .from(customFieldValueTable)
    .innerJoin(taskTable, eq(customFieldValueTable.taskId, taskTable.id))
    .innerJoin(
      customFieldDefinitionTable,
      eq(customFieldValueTable.fieldId, customFieldDefinitionTable.id),
    )
    .where(
      and(
        eq(taskTable.projectId, projectId),
        // A task may still carry a value row for a field this project has
        // since hidden — never surface those.
        inArray(customFieldValueTable.fieldId, [...effectiveFieldIds]),
      ),
    );
}

export default getCustomFieldValuesByProject;
