import { and, eq, inArray, sql } from "drizzle-orm";
import { projectTable, taskRelationTable, taskTable } from "../database/schema";
import {
  type ProjectScope,
  projectScopeCondition,
} from "../utils/project-scope-filters";
import type { TaskReadDatabase } from "./bounded-read";
import { taskIsCompleted } from "./task-is-completed";

/**
 * Load direct-child progress for the entire page, independent of board filters.
 *
 * `projectScope` is the viewer's project scope: `"all"` counts children in
 * every project of the workspace (full access, or the public board, which is
 * limited by `publicOnly` instead); otherwise only children in those projects
 * are counted, so a parent's counter never reveals how many children live in a
 * project the viewer cannot open.
 */
export async function getSubtaskCounts(
  db: TaskReadDatabase,
  taskIds: string[],
  workspaceId: string,
  publicOnly: boolean,
  projectScope: ProjectScope,
) {
  if (taskIds.length === 0) {
    return new Map<string, { completed: number; total: number }>();
  }

  const rows = await db
    .select({
      taskId: taskRelationTable.sourceTaskId,
      total: sql<number>`count(distinct ${taskTable.id})`.mapWith(Number),
      completed:
        sql<number>`count(distinct ${taskTable.id}) filter (where ${taskIsCompleted})`.mapWith(
          Number,
        ),
    })
    .from(taskRelationTable)
    .innerJoin(taskTable, eq(taskRelationTable.targetTaskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        inArray(taskRelationTable.sourceTaskId, taskIds),
        eq(taskRelationTable.relationType, "subtask"),
        eq(projectTable.workspaceId, workspaceId),
        publicOnly ? eq(projectTable.isPublic, true) : undefined,
        projectScopeCondition(
          projectTable.id,
          projectScope === "all" ? null : projectScope,
        ),
      ),
    )
    .groupBy(taskRelationTable.sourceTaskId);

  return new Map(
    rows.map(({ taskId, completed, total }) => [taskId, { completed, total }]),
  );
}
