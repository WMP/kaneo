import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { activityTable, columnTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";
import {
  assertAssignableUser,
  getProjectWorkspaceId,
} from "../../utils/assert-assignable-user";
import { boardDescription, descriptionDeferred } from "../description-pages";
import { buildScheduleChanges } from "../diff-schedule-fields";
import { assertValidTaskStatus } from "../validate-task-fields";
import { assertTaskPosition } from "./next-task-position";

async function updateTask(
  id: string,
  title: string,
  status: string,
  startDate: Date | undefined,
  dueDate: Date | undefined,
  projectId: string,
  description: string | undefined,
  priority: string,
  position: number,
  progress: number | undefined,
  isMilestone: boolean | undefined,
  constraintType: string | undefined,
  constraintDate: Date | null | undefined,
  userId?: string,
  currentUserId?: string,
  approvalStatus?: string,
  approvalNote?: string | null,
) {
  assertTaskPosition(position);

  const [existingTask] = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      priority: taskTable.priority,
      description:
        description === undefined ? sql<null>`null` : taskTable.description,
      status: taskTable.status,
      projectId: taskTable.projectId,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      progress: taskTable.progress,
      isMilestone: taskTable.isMilestone,
      constraintType: taskTable.constraintType,
      constraintDate: taskTable.constraintDate,
      approvalStatus: taskTable.approvalStatus,
      approvalNote: taskTable.approvalNote,
    })
    .from(taskTable)
    .where(eq(taskTable.id, id))
    .limit(1);

  if (!existingTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  if (projectId !== existingTask.projectId) {
    throw new HTTPException(400, {
      message: "Use the task move endpoint to move tasks between projects",
    });
  }

  await assertValidTaskStatus(status, projectId);

  const normalizedUserId = userId?.trim() || undefined;

  if (normalizedUserId) {
    await assertAssignableUser(
      normalizedUserId,
      await getProjectWorkspaceId(projectId),
    );
  }

  const column = await db.query.columnTable.findFirst({
    where: and(
      eq(columnTable.projectId, projectId),
      eq(columnTable.slug, status),
    ),
  });

  const approvalStatusChanged =
    approvalStatus !== undefined &&
    existingTask.approvalStatus !== approvalStatus;
  const nextApprovalStatus = approvalStatus ?? existingTask.approvalStatus;
  const nextApprovalNote =
    approvalNote === undefined ? existingTask.approvalNote : approvalNote;

  // The approval gate's activity row is written in the same transaction as
  // the column update (see update-task-approval.ts for why: it is a
  // compliance-relevant audit trail that a fire-and-forget event subscriber
  // cannot guarantee exists).
  const updatedTask = await db.transaction(async (tx) => {
    const [task] = await tx
      .update(taskTable)
      .set({
        title,
        status,
        columnId: column?.id ?? null,
        startDate: startDate || null,
        dueDate: dueDate || null,
        projectId,
        description,
        priority,
        position,
        progress,
        isMilestone,
        constraintType,
        constraintDate,
        userId: normalizedUserId ?? null,
        approvalStatus: nextApprovalStatus,
        approvalNote: nextApprovalNote,
      })
      .where(eq(taskTable.id, id))
      .returning({
        ...getTableColumns(taskTable),
        description: boardDescription,
        descriptionDeferred,
      });

    if (!task) {
      throw new HTTPException(500, {
        message: "Failed to update task",
      });
    }

    if (approvalStatusChanged) {
      await tx.insert(activityTable).values({
        taskId: task.id,
        type: "approval_changed",
        userId: currentUserId,
        content: null,
        eventData: {
          oldApprovalStatus: existingTask.approvalStatus,
          newApprovalStatus: task.approvalStatus,
          approvalNote: task.approvalNote,
        },
      });
    }

    return task;
  });

  if (existingTask.status !== status) {
    await publishEvent("task.status_changed", {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      userId: currentUserId,
      oldStatus: existingTask.status,
      newStatus: status,
      title: updatedTask.title,
      assigneeId: updatedTask.userId,
      type: "status_changed",
    });

    await publishEvent("task-relation.refresh", {
      projectId: updatedTask.projectId,
      userId: currentUserId,
    });
  }

  if (approvalStatusChanged) {
    await publishEvent("task.approval_changed", {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      userId: currentUserId,
      oldApprovalStatus: existingTask.approvalStatus,
      newApprovalStatus: updatedTask.approvalStatus,
      approvalNote: updatedTask.approvalNote,
      title: updatedTask.title,
      type: "approval_changed",
    });
  }

  if (existingTask.title !== title) {
    await publishEvent("task.title_changed", {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      userId: currentUserId,
      oldTitle: existingTask.title,
      newTitle: title,
      type: "title_changed",
    });
  }

  if (description !== undefined && existingTask.description !== description) {
    await publishEvent("task.description_changed", {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      userId: currentUserId,
      oldDescription: existingTask.description,
      newDescription: description,
      type: "description_changed",
    });
  }

  if (existingTask.priority !== priority) {
    await publishEvent("task.priority_changed", {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      userId: currentUserId,
      oldPriority: existingTask.priority,
      newPriority: priority,
      title: updatedTask.title,
      type: "priority_changed",
    });
  }

  // waitForHandlers: the activity module logs a "changes" diff off this
  // event, and that write should be visible by the time this request
  // returns rather than racing the response (audit history is not
  // best-effort — see update-task-title.ts's atomic insert for the same
  // rule applied a different way).
  await publishEvent(
    "task.updated",
    {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      title: updatedTask.title,
      status: updatedTask.status,
      userId: currentUserId,
      changes: buildScheduleChanges(existingTask, updatedTask),
    },
    { waitForHandlers: true },
  );

  if (description !== undefined && existingTask.description !== description) {
    deleteOrphanedAssets(existingTask.description, description, {
      taskId: id,
    }).catch(() => {});
  }

  return updatedTask;
}

export default updateTask;
