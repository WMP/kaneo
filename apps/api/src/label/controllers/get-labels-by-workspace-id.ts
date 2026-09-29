import { and, eq, getTableColumns, isNull, or } from "drizzle-orm";
import db from "../../database";
import { labelTable, taskTable } from "../../database/schema";
import { accessibleProjectIds } from "../../utils/project-access";
import { projectScopeCondition } from "../../utils/project-scope-filters";

// Workspace label definitions (no task) are workspace-wide. A row attached to a
// task belongs to that task's project, so a caller without full access does not
// receive rows attached to tasks of projects they are not a member of.
async function getLabelsByWorkspaceId(workspaceId: string, userId: string) {
  const projectIds = await accessibleProjectIds(userId, workspaceId);
  const taskProjectScope = projectScopeCondition(
    taskTable.projectId,
    projectIds,
  );

  return db
    .select(getTableColumns(labelTable))
    .from(labelTable)
    .leftJoin(taskTable, eq(labelTable.taskId, taskTable.id))
    .where(
      and(
        eq(labelTable.workspaceId, workspaceId),
        taskProjectScope
          ? or(isNull(labelTable.taskId), taskProjectScope)
          : undefined,
      ),
    );
}

export default getLabelsByWorkspaceId;
