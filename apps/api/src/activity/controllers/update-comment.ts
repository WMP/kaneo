import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { activityTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";

async function updateComment(userId: string, id: string, content: string) {
  const [existing] = await db
    .select({
      id: activityTable.id,
      content: activityTable.content,
      taskId: activityTable.taskId,
    })
    .from(activityTable)
    .where(
      and(
        eq(activityTable.id, id),
        eq(activityTable.userId, userId),
        eq(activityTable.type, "comment"),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new HTTPException(404, {
      message: "Comment not found or you are not the author",
    });
  }

  const [updated] = await db
    .update(activityTable)
    .set({ content })
    .where(
      and(
        eq(activityTable.id, id),
        eq(activityTable.userId, userId),
        eq(activityTable.type, "comment"),
      ),
    )
    .returning();

  if (!updated) {
    throw new HTTPException(404, {
      message: "Comment not found or you are not the author",
    });
  }

  // Comments are always task-scoped (the `type: "comment"` filter above
  // guarantees a task_id — only workspace-level activity, e.g. calendar
  // changes, ever leaves it null; see activityTable.workspaceId in
  // schema.ts), so narrowing it back to `string` here is safe.
  const commentTaskId = updated.taskId as string;

  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, commentTaskId))
    .limit(1);

  if (task) {
    await publishEvent("comment.updated", {
      ...updated,
      taskId: commentTaskId,
      projectId: task.projectId,
      userId,
    });
  }

  deleteOrphanedAssets(existing.content, content, {
    taskId: commentTaskId,
  }).catch(() => {});

  return { ...updated, taskId: commentTaskId };
}

export default updateComment;
