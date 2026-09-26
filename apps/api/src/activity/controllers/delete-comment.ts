import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { activityTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";

async function deleteComment(userId: string, id: string) {
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

  const [deletedComment] = await db
    .delete(activityTable)
    .where(
      and(
        eq(activityTable.id, id),
        eq(activityTable.userId, userId),
        eq(activityTable.type, "comment"),
      ),
    )
    .returning();

  if (!deletedComment) {
    throw new HTTPException(404, {
      message: "Comment not found or you are not the author",
    });
  }

  // Comments are always task-scoped (the `type: "comment"` filter above
  // guarantees a task_id — only workspace-level activity, e.g. calendar
  // changes, ever leaves it null; see activityTable.workspaceId in
  // schema.ts), so narrowing it back to `string` here is safe.
  const commentTaskId = deletedComment.taskId as string;

  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, commentTaskId))
    .limit(1);

  if (task) {
    await publishEvent("comment.deleted", {
      ...deletedComment,
      taskId: commentTaskId,
      projectId: task.projectId,
      userId,
    });
  }

  deleteOrphanedAssets(existing.content, null, {
    taskId: commentTaskId,
  }).catch(() => {});

  return { ...deletedComment, taskId: commentTaskId };
}

export default deleteComment;
