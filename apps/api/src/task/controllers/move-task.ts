import { and, asc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  assetTable,
  columnTable,
  projectTable,
  taskAssignmentTable,
  taskTable,
  userTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import {
  projectAccessSatisfies,
  requireProjectAccessFor,
} from "../../utils/project-access";
import { filterUsersWithProjectAccess } from "../../utils/project-scope-filters";
import {
  readTaskAssignees,
  recomputeTaskPrimaryAssignees,
} from "../assignments";
import { claimTaskNumber } from "./claim-task-numbers";
import { nextTaskPosition } from "./next-task-position";

function isSameProjectMove(
  sourceProjectId: string,
  destinationProjectId: string,
) {
  return sourceProjectId === destinationProjectId;
}

async function resolveDestinationStatus(
  destinationProjectId: string,
  currentStatus: string,
  requestedStatus?: string,
) {
  const destinationColumns = await db
    .select({
      id: columnTable.id,
      slug: columnTable.slug,
      position: columnTable.position,
    })
    .from(columnTable)
    .where(eq(columnTable.projectId, destinationProjectId))
    .orderBy(asc(columnTable.position));

  const [firstColumn] = destinationColumns;

  if (!firstColumn) {
    throw new HTTPException(400, {
      message: "Destination project does not have a workflow",
    });
  }

  const requestedColumn = requestedStatus
    ? destinationColumns.find((column) => column.slug === requestedStatus)
    : null;

  if (requestedStatus && !requestedColumn) {
    throw new HTTPException(400, {
      message: "Selected status is not valid for the destination project",
    });
  }

  const matchingCurrentColumn = destinationColumns.find(
    (column) => column.slug === currentStatus,
  );

  return requestedColumn ?? matchingCurrentColumn ?? firstColumn;
}

async function moveTask({
  taskId,
  destinationProjectId,
  destinationStatus,
  currentUserId,
}: {
  taskId: string;
  destinationProjectId: string;
  destinationStatus?: string;
  currentUserId: string;
}) {
  const existingTask = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, taskId),
  });

  if (!existingTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  if (isSameProjectMove(existingTask.projectId, destinationProjectId)) {
    throw new HTTPException(400, {
      message: "Task is already in that project",
    });
  }

  const sourceProject = await db.query.projectTable.findFirst({
    where: eq(projectTable.id, existingTask.projectId),
  });
  if (!sourceProject) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  const destinationProject = await db.query.projectTable.findFirst({
    where: and(
      eq(projectTable.id, destinationProjectId),
      eq(projectTable.workspaceId, sourceProject.workspaceId),
    ),
  });
  if (!destinationProject) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  // The request was authorized against the source project. Moving a task into
  // another project also needs access there, and the right to create tasks in it.
  const destinationAccess = await requireProjectAccessFor(
    currentUserId,
    destinationProjectId,
  );
  if (!projectAccessSatisfies(destinationAccess, { task: ["create"] })) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }

  const resolvedColumn = await resolveDestinationStatus(
    destinationProjectId,
    existingTask.status,
    destinationStatus,
  );

  const { movedTask, removedAssigneeIds } = await db.transaction(async (tx) => {
    const nextTaskNumber = await claimTaskNumber(destinationProjectId, tx);
    const nextPosition = await nextTaskPosition(
      tx,
      destinationProjectId,
      resolvedColumn.slug,
      resolvedColumn.id,
    );

    const [updatedTask] = await tx
      .update(taskTable)
      .set({
        projectId: destinationProjectId,
        status: resolvedColumn.slug,
        columnId: resolvedColumn.id,
        number: nextTaskNumber,
        position: nextPosition,
      })
      .where(eq(taskTable.id, taskId))
      .returning();

    if (!updatedTask) {
      throw new HTTPException(500, {
        message: "Failed to move task",
      });
    }

    await tx
      .update(assetTable)
      .set({ projectId: destinationProjectId })
      .where(eq(assetTable.taskId, taskId));

    // Assignees who cannot open the destination project are removed with the
    // move (as `moveProject` does for people outside the target workspace);
    // the others, and resources, stay. Read inside the transaction, so the rows
    // that are checked are the rows that are deleted.
    const assignees = (await readTaskAssignees(tx, [taskId])).get(taskId) ?? [];
    const userAssigneeIds = [
      ...new Set([
        ...(existingTask.userId ? [existingTask.userId] : []),
        ...assignees.flatMap((assignee) =>
          assignee.userId ? [assignee.userId] : [],
        ),
      ]),
    ];
    const keptUserIds = await filterUsersWithProjectAccess(
      userAssigneeIds,
      destinationProjectId,
    );
    const removed = userAssigneeIds.filter(
      (userId) => !keptUserIds.has(userId),
    );

    if (removed.length === 0) {
      return { movedTask: updatedTask, removedAssigneeIds: removed };
    }

    await tx
      .delete(taskAssignmentTable)
      .where(
        and(
          eq(taskAssignmentTable.taskId, taskId),
          inArray(taskAssignmentTable.userId, removed),
        ),
      );
    await recomputeTaskPrimaryAssignees(tx, [taskId]);
    const [reloaded] = await tx
      .select({ userId: taskTable.userId })
      .from(taskTable)
      .where(eq(taskTable.id, taskId));
    return {
      movedTask: { ...updatedTask, userId: reloaded?.userId ?? null },
      removedAssigneeIds: removed,
    };
  });

  await publishEvent("task.moved", {
    taskId,
    type: "moved",
    userId: currentUserId,
    fromProjectId: sourceProject.id,
    fromProjectName: sourceProject.name,
    toProjectId: destinationProject.id,
    toProjectName: destinationProject.name,
    oldStatus: existingTask.status,
    newStatus: resolvedColumn.slug,
  });

  // The same events an assignee change publishes, so the activity feed,
  // notifications and integrations see the removal.
  if (removedAssigneeIds.length > 0) {
    if (!movedTask.userId) {
      await publishEvent("task.unassigned", {
        taskId,
        projectId: destinationProject.id,
        userId: currentUserId,
        title: movedTask.title,
        type: "unassigned",
      });
    } else {
      const [newAssignee] = await db
        .select({ name: userTable.name })
        .from(userTable)
        .where(eq(userTable.id, movedTask.userId));
      await publishEvent("task.assignee_changed", {
        taskId,
        projectId: destinationProject.id,
        userId: currentUserId,
        oldAssignee: existingTask.userId,
        newAssignee: newAssignee?.name,
        newAssigneeId: movedTask.userId,
        addedAssigneeIds: [],
        removedAssigneeIds,
        title: movedTask.title,
        type: "assignee_changed",
      });
    }
  }

  return {
    task: movedTask,
    sourceProjectId: sourceProject.id,
    destinationProjectId: destinationProject.id,
  };
}

export default moveTask;
