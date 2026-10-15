import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { currentActorSource } from "../../activity/actor-source";
import db from "../../database";
import {
  activityTable,
  columnTable,
  projectTable,
  taskAssignmentTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { assertProjectAssignableUser } from "../../utils/assert-assignable-user";
import { type AssigneeTarget, setTaskAssignees } from "../assignments";
import { boardDescription, descriptionDeferred } from "../description-pages";
import { buildScheduleChanges } from "../diff-schedule-fields";
import {
  assertEstimateExcludesDateRange,
  type EstimateUnit,
} from "../estimate";
import { assertValidTaskStatus } from "../validate-task-fields";
import { assertTaskPosition } from "./next-task-position";
import {
  publishTaskMutation,
  recordTaskMutation,
} from "./task-mutation-effects";

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
  estimateMinutes: number | null | undefined,
  estimateUnit: EstimateUnit | undefined,
  userId?: string,
  currentUserId?: string,
  approvalStatus?: string,
  approvalNote?: string | null,
) {
  assertTaskPosition(position);

  // The columns the audit diff, the events and the checks below read. The
  // description is only loaded when the request replaces it.
  const existingSelection = {
    id: taskTable.id,
    title: taskTable.title,
    priority: taskTable.priority,
    description:
      description === undefined ? sql<null>`null` : taskTable.description,
    status: taskTable.status,
    columnId: taskTable.columnId,
    position: taskTable.position,
    projectId: taskTable.projectId,
    userId: taskTable.userId,
    startDate: taskTable.startDate,
    dueDate: taskTable.dueDate,
    progress: taskTable.progress,
    estimateMinutes: taskTable.estimateMinutes,
    isMilestone: taskTable.isMilestone,
    constraintType: taskTable.constraintType,
    constraintDate: taskTable.constraintDate,
    approvalStatus: taskTable.approvalStatus,
    approvalNote: taskTable.approvalNote,
  };

  let [existingTask] = await db
    .select(existingSelection)
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

  // Merged state: the full update replaces both dates (an omitted date is
  // cleared), while an omitted estimate stays as stored.
  assertEstimateExcludesDateRange({
    estimateMinutes:
      estimateMinutes === undefined
        ? existingTask.estimateMinutes
        : estimateMinutes,
    startDate,
    dueDate,
  });

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

  const initialPosition = existingTask.position;
  const initialStatus = existingTask.status;

  // The approval gate's activity row is written in the same transaction as
  // the column update (see update-task-approval.ts for why: it is a
  // compliance-relevant audit trail that a fire-and-forget event subscriber
  // cannot guarantee exists).
  const updatedTask = await db.transaction(async (tx) => {
    // Serialize with moves and reorders of the project, then re-read the task
    // under its row lock: the diff below must describe the row that is
    // actually replaced, and a write based on a stale order is refused.
    const [project] = await tx
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(eq(projectTable.id, projectId))
      .for("update");
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });
    const [locked] = await tx
      .select(existingSelection)
      .from(taskTable)
      .where(and(eq(taskTable.id, id), eq(taskTable.projectId, projectId)))
      .for("update");
    if (!locked)
      throw new HTTPException(409, {
        message: "Task changed projects; retry the update",
      });
    if (locked.position !== initialPosition || locked.status !== initialStatus)
      throw new HTTPException(409, {
        message: "Task order changed; refresh before updating",
      });
    existingTask = locked;

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
        estimateMinutes,
        estimateUnit,
        isMilestone,
        constraintType,
        constraintDate,
        approvalStatus: nextApprovalStatus,
        approvalNote: nextApprovalNote,
      })
      .where(and(eq(taskTable.id, id), eq(taskTable.projectId, projectId)))
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

    await recordTaskMutation(
      tx,
      existingTask,
      { title, dueDate: dueDate ?? null },
      currentUserId,
    );

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

  await publishTaskMutation(
    {
      ...existingTask,
      description:
        description === undefined ? undefined : existingTask.description,
    },
    { ...updatedTask, description: description ?? updatedTask.description },
    currentUserId,
  );

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

  return updatedTask;
}

export default updateTask;
