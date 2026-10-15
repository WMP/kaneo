import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { taskTable } from "../../database/schema";
import { assertProjectAssignableUser } from "../../utils/assert-assignable-user";
import { readTaskAssignees, setTaskAssignees } from "../assignments";
import { publishTaskMutation } from "./task-mutation-effects";
import { withLockedTask } from "./with-locked-task";

async function updateTaskAssignee({
  id,
  userId,
  currentUserId,
}: {
  id: string;
  userId: string | null;
  currentUserId: string;
}) {
  const nextAssigneeId = userId?.trim() || null;
  let addedAssigneeIds: string[] = [];
  let removedAssigneeIds: string[] = [];

  const { before: existingTask, after: updatedTask } = await withLockedTask(
    id,
    async (tx, existingTask) => {
      if (existingTask.userId === nextAssigneeId) {
        return existingTask;
      }

      if (nextAssigneeId) {
        await assertProjectAssignableUser(
          nextAssigneeId,
          existingTask.projectId,
          tx,
        );
      }

      // This endpoint replaces the *entire* assignee list with a single user
      // (or none), so a task with other assignees loses them here too; read the
      // pre-mutation list to report that in the event's addedAssigneeIds/
      // removedAssigneeIds, same as the multi-assignee route.
      const previousAssigneesByTaskId = await readTaskAssignees(tx, [id]);
      // Only user assignees are relevant here: this route only ever sets a
      // single user (or none), and only a user can be notified/diffed this
      // way; a previous resource assignee is dropped by this replace.
      const previousAssigneeIds = (previousAssigneesByTaskId.get(id) ?? [])
        .map((assignee) => assignee.userId)
        .filter((assigneeId): assigneeId is string => assigneeId !== null);
      const nextAssigneeIds = nextAssigneeId ? [nextAssigneeId] : [];
      addedAssigneeIds = nextAssigneeIds.filter(
        (assigneeId) => !previousAssigneeIds.includes(assigneeId),
      );
      removedAssigneeIds = previousAssigneeIds.filter(
        (assigneeId) => !nextAssigneeIds.includes(assigneeId),
      );

      // Wired through the shared helper (rather than a direct `.update()`) so
      // `ganttpro_task_assignment` mirrors this task's single assignee, same
      // as every other assignee mutation.
      await setTaskAssignees(
        tx,
        id,
        nextAssigneeId ? [{ userId: nextAssigneeId }] : [],
      );

      const [updatedTask] = await tx
        .select()
        .from(taskTable)
        .where(eq(taskTable.id, id))
        .limit(1);

      if (!updatedTask) {
        throw new HTTPException(500, {
          message: "Failed to update task assignee",
        });
      }

      return updatedTask;
    },
  );

  await publishTaskMutation(existingTask, updatedTask, currentUserId, {
    fields: ["userId"],
    addedAssigneeIds,
    removedAssigneeIds,
  });

  return updatedTask;
}

export default updateTaskAssignee;
