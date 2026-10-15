import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable } from "../../database/schema";
import { assertEstimateExcludesDateRange } from "../estimate";
import {
  publishTaskMutation,
  recordTaskMutation,
} from "./task-mutation-effects";

async function updateTaskDueDate({
  id,
  dueDate,
  currentUserId,
}: {
  id: string;
  dueDate: Date | null;
  currentUserId: string;
}) {
  let existingTask = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, id),
  });

  if (!existingTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  const updatedTask = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(taskTable)
      .where(eq(taskTable.id, id))
      .for("update");
    if (!locked) throw new HTTPException(404, { message: "Task not found" });
    existingTask = locked;

    // Evaluated against the locked row so a concurrent estimate or start date
    // change cannot slip a full date range past the rule.
    assertEstimateExcludesDateRange({
      estimateMinutes: locked.estimateMinutes,
      startDate: locked.startDate,
      dueDate,
    });

    const [task] = await tx
      .update(taskTable)
      .set({ dueDate: dueDate || null })
      .where(eq(taskTable.id, id))
      .returning();
    if (task)
      await recordTaskMutation(tx, existingTask, { dueDate }, currentUserId);
    return task;
  });

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task due date",
    });
  }

  await publishTaskMutation(existingTask, updatedTask, currentUserId, {
    fields: ["dueDate"],
  });

  return updatedTask;
}

export default updateTaskDueDate;
