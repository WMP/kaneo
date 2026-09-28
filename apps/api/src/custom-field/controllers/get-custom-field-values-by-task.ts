import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  customFieldDefinitionTable,
  customFieldValueTable,
  taskTable,
} from "../../database/schema";
import { getEffectiveFieldIdSet } from "../effective-fields";

async function getCustomFieldValuesByTask(taskId: string) {
  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);

  if (!task) {
    throw new HTTPException(404, { message: "Task not found" });
  }

  const effectiveFieldIds = await getEffectiveFieldIdSet(task.projectId);

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
    .innerJoin(
      customFieldDefinitionTable,
      eq(customFieldValueTable.fieldId, customFieldDefinitionTable.id),
    )
    .where(
      and(
        eq(customFieldValueTable.taskId, taskId),
        // A task may still carry a value row for a field its project has
        // since hidden — never surface those.
        inArray(customFieldValueTable.fieldId, [...effectiveFieldIds]),
      ),
    );
}

export default getCustomFieldValuesByTask;
