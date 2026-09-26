import { eq, getTableColumns } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { activityTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { boardDescription, descriptionDeferred } from "../description-pages";

async function updateTaskApproval({
  id,
  approvalStatus,
  approvalNote,
  currentUserId,
}: {
  id: string;
  approvalStatus: string;
  approvalNote?: string | null;
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

  const nextApprovalNote =
    approvalNote === undefined ? existingTask.approvalNote : approvalNote;
  const statusChanged = existingTask.approvalStatus !== approvalStatus;

  // The approval gate is a compliance-relevant audit trail (client sign-off
  // before a cutover), so its activity row is written in the same
  // transaction as the column update rather than from a fire-and-forget
  // event subscriber, which cannot guarantee the audit trail exists.
  const updatedTask = await db.transaction(async (tx) => {
    const [task] = await tx
      .update(taskTable)
      .set({ approvalStatus, approvalNote: nextApprovalNote })
      .where(eq(taskTable.id, id))
      .returning({
        ...getTableColumns(taskTable),
        description: boardDescription,
        descriptionDeferred,
      });

    if (!task) {
      throw new HTTPException(500, {
        message: "Failed to update task approval status",
      });
    }

    if (statusChanged) {
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

  if (statusChanged) {
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

  return updatedTask;
}

export default updateTaskApproval;
