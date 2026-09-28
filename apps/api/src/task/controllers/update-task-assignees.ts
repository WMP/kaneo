import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable, userTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  filterAssignableUsers,
  getProjectWorkspaceId,
} from "../../utils/assert-assignable-user";
import { readTaskAssignees, setTaskAssignees } from "../assignments";

async function updateTaskAssignees({
  id,
  userIds,
  currentUserId,
}: {
  id: string;
  userIds: string[];
  currentUserId: string;
}) {
  const existingTask = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, id),
  });

  if (!existingTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  const trimmedUserIds = [
    ...new Set(userIds.map((userId) => userId.trim()).filter(Boolean)),
  ];

  if (trimmedUserIds.length > 0) {
    const workspaceId = await getProjectWorkspaceId(existingTask.projectId);
    const assignable = await filterAssignableUsers(trimmedUserIds, workspaceId);
    const notAssignable = trimmedUserIds.filter((id) => !assignable.has(id));

    if (notAssignable.length > 0) {
      throw new HTTPException(403, {
        message: "One or more assignees are not members of this workspace",
      });
    }
  }

  const previousPrimaryId = existingTask.userId;

  await setTaskAssignees(db, id, trimmedUserIds);

  const [updatedTask] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      position: taskTable.position,
      number: taskTable.number,
      userId: taskTable.userId,
      title: taskTable.title,
      description: taskTable.description,
      status: taskTable.status,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      progress: taskTable.progress,
      isMilestone: taskTable.isMilestone,
      baselineStartDate: taskTable.baselineStartDate,
      baselineDueDate: taskTable.baselineDueDate,
      constraintType: taskTable.constraintType,
      constraintDate: taskTable.constraintDate,
      approvalStatus: taskTable.approvalStatus,
      approvalNote: taskTable.approvalNote,
      createdAt: taskTable.createdAt,
      assigneeName: userTable.name,
      assigneeId: userTable.id,
    })
    .from(taskTable)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(eq(taskTable.id, id))
    .limit(1);

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task assignees",
    });
  }

  // Preserve the same primary-based events the single-assignee route fires,
  // so external webhooks/GitHub sync stay unaffected by this route existing.
  if (previousPrimaryId !== updatedTask.userId) {
    if (!updatedTask.userId) {
      await publishEvent("task.unassigned", {
        taskId: updatedTask.id,
        projectId: updatedTask.projectId,
        userId: currentUserId,
        title: updatedTask.title,
        type: "unassigned",
      });
    } else {
      await publishEvent("task.assignee_changed", {
        taskId: updatedTask.id,
        projectId: updatedTask.projectId,
        userId: currentUserId,
        oldAssignee: previousPrimaryId,
        newAssignee: updatedTask.assigneeName ?? undefined,
        newAssigneeId: updatedTask.userId,
        title: updatedTask.title,
        type: "assignee_changed",
      });
    }
  }

  const assigneesByTaskId = await readTaskAssignees(db, [id]);

  return {
    ...updatedTask,
    assignees: assigneesByTaskId.get(id) ?? [],
  };
}

export default updateTaskAssignees;
