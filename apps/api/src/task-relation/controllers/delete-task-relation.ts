import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectTable,
  taskRelationTable,
  taskTable,
} from "../../database/schema";
import {
  publishRelationEvent,
  relationTaskIdsInProject,
} from "../event-task-ids";

async function deleteTaskRelation(
  id: string,
  userId: string,
  workspaceId: string,
) {
  const workspaceTasks = db
    .select({ id: taskTable.id })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(eq(projectTable.workspaceId, workspaceId));

  // Check both endpoints in the delete statement itself. Legacy cross-tenant
  // rows must not bypass the same boundary enforced on creation and reads.
  const [relation] = await db
    .delete(taskRelationTable)
    .where(
      and(
        eq(taskRelationTable.id, id),
        inArray(taskRelationTable.sourceTaskId, workspaceTasks),
        inArray(taskRelationTable.targetTaskId, workspaceTasks),
      ),
    )
    .returning();

  if (!relation) {
    throw new HTTPException(404, {
      message: "Task relation not found",
    });
  }

  const [sourceTask] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, relation.sourceTaskId),
        eq(projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  const [targetTask] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, relation.targetTaskId),
        eq(projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  const projects = {
    sourceProjectId: sourceTask?.projectId,
    targetProjectId: targetTask?.projectId,
  };

  if (sourceTask) {
    // waitForHandlers: the activity module logs this deletion off the
    // event, and that write should be visible by the time this request
    // returns rather than racing the response.
    await publishRelationEvent(
      "task-relation.deleted",
      {
        ...relation,
        taskId: relation.sourceTaskId,
        projectId: sourceTask.projectId,
        projectTaskIds: relationTaskIdsInProject(
          relation,
          projects,
          sourceTask.projectId,
        ),
        userId,
      },
      { waitForHandlers: true },
    );
  }

  // A relation can link tasks across two projects in the same workspace.
  // Notify the target project's subscribers too (when it differs from the
  // source project), so their Gantt/dependency views refresh without a
  // manual reload.
  if (targetTask && targetTask.projectId !== sourceTask?.projectId) {
    // Same relation, same (source) taskId — published again only so the
    // target project's own WS subscribers refresh. Marked so the activity
    // module (which logs by taskId) doesn't record this deletion twice.
    await publishRelationEvent(
      "task-relation.deleted",
      {
        ...relation,
        taskId: relation.sourceTaskId,
        projectId: targetTask.projectId,
        projectTaskIds: relationTaskIdsInProject(
          relation,
          projects,
          targetTask.projectId,
        ),
        userId,
        secondaryNotification: true,
      },
      { waitForHandlers: true },
    );
  }

  return relation;
}

export default deleteTaskRelation;
