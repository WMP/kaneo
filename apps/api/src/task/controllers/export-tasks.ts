import { eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  labelTable,
  projectTable,
  taskTable,
  userTable,
} from "../../database/schema";
import getTaskRelationsByProject from "../../task-relation/controllers/get-task-relations-by-project";

async function exportTasks(projectId: string) {
  const project = await db.query.projectTable.findFirst({
    where: eq(projectTable.id, projectId),
  });

  if (!project) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  const tasks = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      description: taskTable.description,
      status: taskTable.status,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      position: taskTable.position,
      createdAt: taskTable.createdAt,
      userId: taskTable.userId,
      assigneeName: userTable.name,
      assigneeId: userTable.id,
      progress: taskTable.progress,
      isMilestone: taskTable.isMilestone,
      baselineStartDate: taskTable.baselineStartDate,
      baselineDueDate: taskTable.baselineDueDate,
      constraintType: taskTable.constraintType,
      constraintDate: taskTable.constraintDate,
    })
    .from(taskTable)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(eq(taskTable.projectId, projectId))
    .orderBy(taskTable.position);

  const taskIds = tasks.map((task) => task.id);

  const labelsData =
    taskIds.length > 0
      ? await db
          .select({
            id: labelTable.id,
            name: labelTable.name,
            color: labelTable.color,
            taskId: labelTable.taskId,
          })
          .from(labelTable)
          .where(inArray(labelTable.taskId, taskIds))
      : [];

  const taskLabelsMap = new Map<
    string,
    Array<{ name: string; color: string }>
  >();
  for (const label of labelsData) {
    if (label.taskId) {
      if (!taskLabelsMap.has(label.taskId)) {
        taskLabelsMap.set(label.taskId, []);
      }
      taskLabelsMap.get(label.taskId)?.push({
        name: label.name,
        color: label.color,
      });
    }
  }

  // Reuse the shared, workspace-scoped relation reader that powers the Gantt
  // chart. It fetches every relation touching this project's tasks, drops any
  // whose far end is not visible in this workspace (legacy cross-workspace
  // rows), and filters server-side with a subquery so a large project does not
  // overflow Postgres's bind-parameter limit. A same-workspace cross-project
  // `related` link is still included on the in-project side, with the other
  // task's id only (it won't resolve to an entry in this export's tasks array).
  const relationsData =
    taskIds.length > 0
      ? await getTaskRelationsByProject(projectId, project.workspaceId)
      : [];

  const taskRelationsMap = new Map<
    string,
    Array<{
      relationType: string;
      dependencyType: string;
      lagDays: number;
      sourceTaskId: string;
      targetTaskId: string;
    }>
  >();
  const taskIdSet = new Set(taskIds);
  for (const relation of relationsData) {
    const entry = {
      relationType: relation.relationType,
      dependencyType: relation.dependencyType,
      lagDays: relation.lagDays,
      sourceTaskId: relation.sourceTaskId,
      targetTaskId: relation.targetTaskId,
    };
    if (taskIdSet.has(relation.sourceTaskId)) {
      if (!taskRelationsMap.has(relation.sourceTaskId)) {
        taskRelationsMap.set(relation.sourceTaskId, []);
      }
      taskRelationsMap.get(relation.sourceTaskId)?.push(entry);
    }
    if (
      relation.targetTaskId !== relation.sourceTaskId &&
      taskIdSet.has(relation.targetTaskId)
    ) {
      if (!taskRelationsMap.has(relation.targetTaskId)) {
        taskRelationsMap.set(relation.targetTaskId, []);
      }
      taskRelationsMap.get(relation.targetTaskId)?.push(entry);
    }
  }

  return {
    project: {
      name: project.name,
      slug: project.slug,
      description: project.description,
      exportedAt: new Date().toISOString(),
    },
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description || "",
      status: task.status,
      priority: task.priority || "low",
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null,
      startDate: task.startDate ? new Date(task.startDate).toISOString() : null,
      userId: task.userId || null,
      progress: task.progress,
      isMilestone: task.isMilestone,
      baselineStartDate: task.baselineStartDate
        ? new Date(task.baselineStartDate).toISOString()
        : null,
      baselineDueDate: task.baselineDueDate
        ? new Date(task.baselineDueDate).toISOString()
        : null,
      constraintType: task.constraintType,
      constraintDate: task.constraintDate
        ? new Date(task.constraintDate).toISOString()
        : null,
      labels: taskLabelsMap.get(task.id) || [],
      relations: taskRelationsMap.get(task.id) || [],
    })),
  };
}

export default exportTasks;
