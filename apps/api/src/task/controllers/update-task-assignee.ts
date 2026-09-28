import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable, userTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  assertAssignableUser,
  getProjectWorkspaceId,
} from "../../utils/assert-assignable-user";
import { readTaskAssignees, setTaskAssignees } from "../assignments";

async function updateTaskAssignee({
  id,
  userId,
  currentUserId,
}: {
  id: string;
  userId: string | null;
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

  const nextAssigneeId = userId?.trim() || null;
  if (existingTask.userId === nextAssigneeId) {
    return existingTask;
  }

  if (nextAssigneeId) {
    await assertAssignableUser(
      nextAssigneeId,
      await getProjectWorkspaceId(existingTask.projectId),
    );
  }

  // This endpoint replaces the *entire* assignee list with a single user (or
  // none), so a task with other assignees loses them here too; read the
  // pre-mutation list to report that in the event's addedAssigneeIds/
  // removedAssigneeIds, same as the multi-assignee route.
  const previousAssigneesByTaskId = await readTaskAssignees(db, [id]);
  // Only user assignees are ever relevant here: this route only ever sets a
  // single user (or none), and only a user can be notified/diffed this way —
  // a previous resource assignee (from the multi-assignee route) is dropped
  // by this replace, same as any other non-primary assignee was already.
  const previousAssigneeIds = (previousAssigneesByTaskId.get(id) ?? [])
    .map((assignee) => assignee.userId)
    .filter((userId): userId is string => userId !== null);
  const nextAssigneeIds = nextAssigneeId ? [nextAssigneeId] : [];
  const addedAssigneeIds = nextAssigneeIds.filter(
    (assigneeId) => !previousAssigneeIds.includes(assigneeId),
  );
  const removedAssigneeIds = previousAssigneeIds.filter(
    (assigneeId) => !nextAssigneeIds.includes(assigneeId),
  );

  // Wired through the shared helper (rather than a direct `.update()`) so
  // `ganttpro_task_assignment` mirrors this task's single assignee, same as
  // every other assignee mutation.
  await setTaskAssignees(
    db,
    id,
    nextAssigneeId ? [{ userId: nextAssigneeId }] : [],
  );

  const [updatedTask] = await db
    .select()
    .from(taskTable)
    .where(eq(taskTable.id, id))
    .limit(1);

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task assignee",
    });
  }

  const newAssigneeName = nextAssigneeId
    ? (
        await db
          .select({ name: userTable.name })
          .from(userTable)
          .where(eq(userTable.id, nextAssigneeId))
          .limit(1)
      )[0]?.name
    : undefined;

  if (!nextAssigneeId) {
    await publishEvent("task.unassigned", {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      userId: currentUserId,
      title: updatedTask.title,
      type: "unassigned",
    });

    return updatedTask;
  }

  await publishEvent("task.assignee_changed", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    userId: currentUserId,
    oldAssignee: existingTask.userId,
    newAssignee: newAssigneeName,
    newAssigneeId: nextAssigneeId,
    addedAssigneeIds,
    removedAssigneeIds,
    title: updatedTask.title,
    type: "assignee_changed",
  });

  return updatedTask;
}

export default updateTaskAssignee;
