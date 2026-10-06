import { and, eq, inArray, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db from "../database";
import { taskRelationTable, taskTable } from "../database/schema";

/** Find boards whose counters depend on a child, including other projects. */
export async function getSubtaskParentProjects(taskIds: string[]) {
  if (taskIds.length === 0) return [];
  return db
    .selectDistinct({ projectId: taskTable.projectId })
    .from(taskRelationTable)
    .innerJoin(taskTable, eq(taskRelationTable.sourceTaskId, taskTable.id))
    .where(
      and(
        inArray(taskRelationTable.targetTaskId, taskIds),
        eq(taskRelationTable.relationType, "subtask"),
      ),
    );
}

/** Deleted relations are gone by broadcast time; their source task still exists. */
export async function getRelationSourceProject(sourceTaskId: string) {
  return db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, sourceTaskId));
}

/** Find affected parent boards before a project cascade or column change. */
export async function getProjectSubtaskParentProjects(
  projectId: string,
  status?: string,
) {
  const child = alias(taskTable, "child");
  return db
    .selectDistinct({ projectId: taskTable.projectId })
    .from(taskRelationTable)
    .innerJoin(taskTable, eq(taskRelationTable.sourceTaskId, taskTable.id))
    .innerJoin(child, eq(taskRelationTable.targetTaskId, child.id))
    .where(
      and(
        eq(child.projectId, projectId),
        status === undefined ? undefined : eq(child.status, status),
        eq(taskRelationTable.relationType, "subtask"),
      ),
    );
}

/**
 * Projects (other than `projectId`) that hold the other endpoint of a task's
 * dependency or related relation. Their Gantt charts draw this task from the
 * relation summary, so they need a refresh when its schedule, status or title
 * changes. Returns project ids only, never task data.
 */
export async function getRelatedEndpointProjects(
  taskId: string,
  projectId: string,
) {
  const other = alias(taskTable, "other_endpoint");
  return db
    .selectDistinct({ projectId: other.projectId })
    .from(taskRelationTable)
    .innerJoin(
      other,
      or(
        and(
          eq(taskRelationTable.sourceTaskId, taskId),
          eq(other.id, taskRelationTable.targetTaskId),
        ),
        and(
          eq(taskRelationTable.targetTaskId, taskId),
          eq(other.id, taskRelationTable.sourceTaskId),
        ),
      ),
    )
    .where(
      and(
        ne(taskRelationTable.relationType, "subtask"),
        ne(other.projectId, projectId),
      ),
    );
}
