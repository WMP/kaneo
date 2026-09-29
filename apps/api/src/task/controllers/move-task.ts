import { and, asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  assetTable,
  columnTable,
  projectTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import {
  projectAccessSatisfies,
  requireProjectAccessFor,
} from "../../utils/project-access";
import { filterUsersWithProjectAccess } from "../../utils/project-scope-filters";
import {
  type AssigneeTarget,
  readTaskAssignees,
  setTaskAssignees,
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

  // Assignees who cannot open the destination project are removed with the move
  // (as `moveProject` does for people outside the target workspace); the rest,
  // and resources, stay.
  const assignees = (await readTaskAssignees(db, [taskId])).get(taskId) ?? [];
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
  const removedAssigneeIds = userAssigneeIds.filter(
    (userId) => !keptUserIds.has(userId),
  );

  const movedTask = await db.transaction(async (tx) => {
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

    if (removedAssigneeIds.length > 0) {
      const remaining: AssigneeTarget[] = [
        ...userAssigneeIds
          .filter((userId) => keptUserIds.has(userId))
          .map((userId) => ({ userId })),
        ...assignees.flatMap((assignee) =>
          assignee.resourceId ? [{ resourceId: assignee.resourceId }] : [],
        ),
      ];
      await setTaskAssignees(tx, taskId, remaining);
      const [reloaded] = await tx
        .select({ userId: taskTable.userId })
        .from(taskTable)
        .where(eq(taskTable.id, taskId));
      return { ...updatedTask, userId: reloaded?.userId ?? null };
    }

    return updatedTask;
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

  if (removedAssigneeIds.length > 0 && !movedTask.userId) {
    await publishEvent("task.unassigned", {
      taskId,
      type: "unassigned",
      userId: currentUserId,
      projectId: destinationProject.id,
      title: movedTask.title,
    });
  }

  return {
    task: movedTask,
    sourceProjectId: sourceProject.id,
    destinationProjectId: destinationProject.id,
  };
}

export default moveTask;
