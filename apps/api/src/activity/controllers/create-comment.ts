import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  activityTable,
  projectTable,
  taskTable,
  userTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import createNotification from "../../notification/controllers/create-notification";
import { readTaskAssignees } from "../../task/assignments";
import { parseMentionIds } from "../../utils/parse-mentions";
import { currentActorSource } from "../actor-source";

async function createComment(
  taskId: string,
  userId: string,
  content: string,
  external?: { userName: string; source: string },
) {
  const [activity] = await db
    .insert(activityTable)
    .values({
      taskId,
      type: "comment",
      userId,
      content,
      ...currentActorSource(),
      ...(external
        ? {
            externalUserName: external.userName,
            externalSource: external.source,
          }
        : {}),
    })
    .returning();

  if (!activity) {
    throw new HTTPException(500, {
      message: "Failed to create activity",
    });
  }

  // taskId is a required parameter here (comments are always task-scoped),
  // so narrow it back from the column's now-nullable type (see
  // activityTable.workspaceId in schema.ts).
  const savedActivity = { ...activity, taskId };

  const [user] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId));

  const [task] = await db
    .select({
      projectId: taskTable.projectId,
      title: taskTable.title,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(eq(taskTable.id, taskId));

  if (task) {
    await publishEvent("comment.created", {
      ...savedActivity,
      comment: `**${user?.name}** commented:\n> ${content}`,
      projectId: task.projectId,
    });
  }

  // Notify any workspace members @mentioned in the comment (not the author).
  const mentionedIds = parseMentionIds(content).filter((id) => id !== userId);
  for (const mentionedId of mentionedIds) {
    await createNotification({
      userId: mentionedId,
      type: "task_mention",
      eventData: {
        taskTitle: task?.title ?? null,
        mentionerName: user?.name ?? null,
        projectId: task?.projectId ?? null,
        workspaceId: task?.workspaceId ?? null,
      },
      resourceId: taskId,
      resourceType: "task",
    });
  }

  // Notify every current assignee, not only the primary, except the
  // commenter and anyone already notified as an @mention above.
  if (task) {
    const assigneesByTaskId = await readTaskAssignees(db, [taskId]);
    const assigneeIds = (assigneesByTaskId.get(taskId) ?? [])
      .map((assignee) => assignee.userId)
      // Resource assignees (null userId) have no account to notify.
      .filter((id): id is string => id !== null)
      .filter((id) => id !== userId && !mentionedIds.includes(id));

    for (const assigneeId of assigneeIds) {
      await createNotification({
        userId: assigneeId,
        type: "task_comment",
        eventData: {
          taskTitle: task.title,
          commenterName: user?.name ?? null,
          commentPreview: content.slice(0, 160),
          projectId: task.projectId,
          workspaceId: task.workspaceId,
        },
        resourceId: taskId,
        resourceType: "task",
      });
    }
  }

  return savedActivity;
}

export default createComment;
