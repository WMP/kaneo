import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { currentActorSource } from "../../activity/actor-source";
import db from "../../database";
import {
  activityTable,
  columnTable,
  taskAssignmentTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";
import { assertProjectAssignableUser } from "../../utils/assert-assignable-user";
import { type AssigneeTarget, setTaskAssignees } from "../assignments";
import { boardDescription, descriptionDeferred } from "../description-pages";
import { buildScheduleChanges } from "../diff-schedule-fields";
import { assertValidTaskStatus } from "../validate-task-fields";
import { assertTaskPosition } from "./next-task-position";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Replaces only the task's primary user assignee, keeping every other user and
 * resource assignment (existing rows stay, so their units/work are kept). The
 * new primary goes first in the list; the previous primary is dropped, and a
 * new primary that already was a secondary assignee is not duplicated. A null
 * new primary just removes the previous one, so when other users remain the
 * first of them becomes the primary mirror, as everywhere else
 * (`setTaskAssignees`). Returns the resulting `task.userId`.
 */
async function replacePrimaryAssignee(
  tx: Transaction,
  taskId: string,
  previousPrimaryUserId: string | null,
  nextPrimaryUserId: string | null,
): Promise<string | null> {
  const currentRows = await tx
    .select({
      userId: taskAssignmentTable.userId,
      resourceId: taskAssignmentTable.resourceId,
    })
    .from(taskAssignmentTable)
    .where(eq(taskAssignmentTable.taskId, taskId))
    .orderBy(asc(taskAssignmentTable.createdAt), asc(taskAssignmentTable.id));

  const keptUsers: AssigneeTarget[] = [];
  const keptResources: AssigneeTarget[] = [];
  for (const row of currentRows) {
    if (row.userId !== null) {
      if (row.userId !== previousPrimaryUserId) {
        keptUsers.push({ userId: row.userId });
      }
    } else if (row.resourceId !== null) {
      keptResources.push({ resourceId: row.resourceId });
    }
  }

  // setTaskAssignees dedupes, so a new primary that already is in keptUsers
  // moves to the front instead of appearing twice.
  const targets: AssigneeTarget[] = [
    ...(nextPrimaryUserId ? [{ userId: nextPrimaryUserId }] : []),
    ...keptUsers,
    ...keptResources,
  ];

  const saved = await setTaskAssignees(tx, taskId, targets);
  const primary = saved.find(
    (target): target is { userId: string } => "userId" in target,
  );

  return primary?.userId ?? null;
}

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
      userId: taskTable.userId,
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

  // The body's userId is the PRIMARY assignee only (the task.userId mirror):
  //   - omitted: the assignees are not touched at all;
  //   - blank: the primary assignee is unassigned;
  //   - otherwise: the new primary assignee, a no-op when it already is.
  // Whenever the primary changes, the rest of the assignee list (other users,
  // resources) is kept; see `replacePrimaryAssignee`. The full list is edited
  // through PUT /api/task/{id}/assignees.
  const assigneeUntouched = userId === undefined;
  const nextPrimaryUserId = userId?.trim() || null;

  // Only a NEW assignee is checked (they must be able to open the project). The
  // web client sends the current assignee back with every edit, so checking them
  // would make every edit of a task fail once they lost their membership or left
  // the workspace.
  if (
    !assigneeUntouched &&
    nextPrimaryUserId &&
    nextPrimaryUserId !== existingTask.userId
  ) {
    await assertProjectAssignableUser(nextPrimaryUserId, projectId);
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
    const [updatedRow] = await tx
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
        approvalStatus: nextApprovalStatus,
        approvalNote: nextApprovalNote,
      })
      .where(eq(taskTable.id, id))
      .returning({
        ...getTableColumns(taskTable),
        description: boardDescription,
        descriptionDeferred,
      });

    if (!updatedRow) {
      throw new HTTPException(500, {
        message: "Failed to update task",
      });
    }

    // The UPDATE above holds the task row and does not write userId, so the
    // returned userId is the current primary assignee even if another request
    // changed it since existingTask was read.
    let task = updatedRow;

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
        ...currentActorSource(),
      });
    }

    if (!assigneeUntouched && nextPrimaryUserId !== task.userId) {
      const primaryUserId = await replacePrimaryAssignee(
        tx,
        task.id,
        task.userId,
        nextPrimaryUserId,
      );
      task = { ...task, userId: primaryUserId };
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
