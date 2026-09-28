import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { resourceTable, taskAssignmentTable } from "../../database/schema";
import { recomputeTaskPrimaryAssignees } from "../../task/assignments";

// Deleting a resource cascades away its assignment rows (FK onDelete:
// cascade), but a task's primary-assignee mirror only ever mirrors a USER
// target, so no task's `userId` needs recomputing here. This still reads the
// affected task ids first — a resource can be assigned to several tasks — in
// case a later phase adds a resource-aware mirror.
async function deleteResource(id: string) {
  const affectedTasks = await db
    .select({ taskId: taskAssignmentTable.taskId })
    .from(taskAssignmentTable)
    .where(eq(taskAssignmentTable.resourceId, id));

  const [deleted] = await db
    .delete(resourceTable)
    .where(eq(resourceTable.id, id))
    .returning();

  if (!deleted) {
    throw new HTTPException(404, { message: "Resource not found" });
  }

  // Defensive no-op today (see comment above); kept so a future change that
  // gives a resource its own primary-mirror semantics doesn't have to
  // remember to add this.
  await recomputeTaskPrimaryAssignees(
    db,
    affectedTasks.map((task) => task.taskId),
  );

  return deleted;
}

export default deleteResource;
