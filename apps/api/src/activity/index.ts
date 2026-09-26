import { HTTPException } from "hono/http-exception";
import { subscribeToEvent } from "../events";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createActivity from "./controllers/create-activity";
import createComment from "./controllers/create-comment";
import deleteComment from "./controllers/delete-comment";
import getActivities from "./controllers/get-activities";
import updateComment from "./controllers/update-comment";
import { activityListSchema, activitySchema } from "./response";
import {
  createActivityBody,
  createCommentBody,
  deleteCommentBody,
  taskIdParam,
  updateCommentBody,
} from "./schema";

const getActivitiesRoute = createRoute({
  method: "get",
  operationId: "getActivities",
  path: "/{taskId}",
  tags: ["Activity"],
  summary: "Get task activity",
  description:
    "Get a task's full activity feed, newest first: comments alongside system events such as status and assignee changes.",
  middleware: [workspaceAccess.fromTaskId()] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("List of activities for the task", activityListSchema),
    400: errorResponse(
      "Unknown task, or its workspace could not be determined",
    ),
    403: errorResponse("No access to the task's workspace"),
  },
});

const createActivityRoute = createRoute({
  method: "post",
  operationId: "createActivity",
  path: "/create",
  tags: ["Activity"],
  summary: "Create activity",
  description:
    "Record a system-generated event on a task. Most events are written by the server itself; this exists for importers and integrations.",
  middleware: [
    workspaceAccess.fromTaskId(),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createActivityBody } },
    },
  },
  responses: {
    200: jsonResponse("The created activity", activitySchema),
    400: {
      description:
        "Invalid body, unknown task, or comment activity submitted through the generic endpoint",
      content: {
        "text/plain": { schema: z.string() },
        "application/json": { schema: z.object({ message: z.string() }) },
      },
    },
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
  },
});

const createCommentRoute = createRoute({
  method: "post",
  operationId: "createComment",
  path: "/comment",
  tags: ["Activity"],
  summary: "Create comment",
  description:
    "Add a comment to a task. Equivalent to POST /comment/{taskId}, kept for the activity-feed client.",
  middleware: [
    workspaceAccess.fromTaskId(),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createCommentBody } },
    },
  },
  responses: {
    200: jsonResponse("The created comment", activitySchema),
    400: errorResponse("Invalid body, or unknown task"),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
  },
});

const updateCommentRoute = createRoute({
  method: "put",
  operationId: "updateComment",
  path: "/comment",
  tags: ["Activity"],
  summary: "Update comment",
  description: "Edit a comment. Only the comment's author may do this.",
  middleware: [workspaceAccess.fromActivity("activityId")] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: updateCommentBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated comment", activitySchema),
    400: errorResponse("Invalid body, or unknown activity"),
    403: errorResponse("Not the author, or no access to the workspace"),
    404: errorResponse("Comment not found"),
  },
});

const deleteCommentRoute = createRoute({
  method: "delete",
  operationId: "deleteComment",
  path: "/comment",
  tags: ["Activity"],
  summary: "Delete comment",
  description: "Delete a comment. Only the comment's author may do this.",
  middleware: [workspaceAccess.fromActivity("activityId")] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: deleteCommentBody } },
    },
  },
  responses: {
    200: jsonResponse("The deleted comment", activitySchema),
    400: errorResponse("Invalid body, or unknown activity"),
    403: errorResponse("Not the author, or no access to the workspace"),
    404: errorResponse("Comment not found"),
  },
});

const activity = apiRouter()
  .openapi(getActivitiesRoute, async (c) =>
    c.json(await getActivities(c.req.valid("param").taskId), 200),
  )
  .openapi(createActivityRoute, async (c) => {
    const { taskId, message, type, eventData } = c.req.valid("json");
    if (type === "comment") {
      throw new HTTPException(400, {
        res: c.json(
          { message: "Use the comment endpoint to create comments" },
          400,
        ),
      });
    }
    return c.json(
      await createActivity(taskId, type, c.get("userId"), message, eventData),
      200,
    );
  })
  .openapi(createCommentRoute, async (c) => {
    const { taskId, comment } = c.req.valid("json");
    return c.json(await createComment(taskId, c.get("userId"), comment), 200);
  })
  .openapi(updateCommentRoute, async (c) => {
    const { activityId, comment } = c.req.valid("json");
    return c.json(
      await updateComment(c.get("userId"), activityId, comment),
      200,
    );
  })
  .openapi(deleteCommentRoute, async (c) =>
    c.json(
      await deleteComment(c.get("userId"), c.req.valid("json").activityId),
      200,
    ),
  );

subscribeToEvent<{
  taskId: string;
  currentUserId: string;
  type: string;
  content: string | null;
}>("task.created", async (data) => {
  if (!data.currentUserId || !data.taskId || !data.type) {
    return;
  }
  await createActivity(data.taskId, data.type, data.currentUserId, null, {});
});

subscribeToEvent<{
  taskId: string;
  userId: string;
  type: string;
  content: string;
  fromProjectId: string;
  fromProjectName: string;
  toProjectId: string;
  toProjectName: string;
  oldStatus: string;
  newStatus: string;
}>("task.moved", async (data) => {
  const {
    fromProjectId,
    fromProjectName,
    toProjectId,
    toProjectName,
    oldStatus,
    newStatus,
  } = data;

  await createActivity(data.taskId, data.type, data.userId, null, {
    fromProjectId,
    fromProjectName,
    toProjectId,
    toProjectName,
    oldStatus,
    newStatus,
  });
});

subscribeToEvent<{
  taskId: string;
  userId: string;
  oldStatus: string;
  newStatus: string;
  title: string;
  assigneeId?: string;
  type: string;
}>("task.status_changed", async (data) => {
  await createActivity(data.taskId, data.type, data.userId, null, {
    oldStatus: data.oldStatus,
    newStatus: data.newStatus,
  });
});

subscribeToEvent<{
  taskId: string;
  userId: string;
  oldPriority: string;
  newPriority: string;
  title: string;
  type: string;
}>("task.priority_changed", async (data) => {
  await createActivity(data.taskId, data.type, data.userId, null, {
    oldPriority: data.oldPriority,
    newPriority: data.newPriority,
  });
});

// Unlike the other task.*_changed events above, the approval-gate's activity
// row is written transactionally alongside the column update in
// update-task-approval.ts and update-task.ts, not from this event: it is a
// compliance-relevant audit trail (client sign-off before a cutover), so it
// cannot be best-effort the way a fire-and-forget subscriber would make it.

subscribeToEvent<{
  taskId: string;
  userId: string;
  title: string;
  type: string;
}>("task.unassigned", async (data) => {
  await createActivity(data.taskId, data.type, data.userId, null, {});
});

subscribeToEvent<{
  taskId: string;
  userId: string;
  oldAssignee: string | null;
  newAssignee: string;
  newAssigneeId: string;
  title: string;
  type: string;
}>("task.assignee_changed", async (data) => {
  await createActivity(data.taskId, data.type, data.userId, null, {
    newAssigneeId: data.newAssigneeId,
    newAssignee: data.newAssignee,
    isSelfAssigned: data.userId === data.newAssigneeId,
  });
});

subscribeToEvent<{
  taskId: string;
  userId: string;
  oldDueDate: Date | null;
  newDueDate: Date;
  title: string;
  type: string;
}>("task.due_date_changed", async (data) => {
  await createActivity(data.taskId, data.type, data.userId, null, {
    oldDueDate:
      data.oldDueDate instanceof Date
        ? data.oldDueDate.toISOString()
        : data.oldDueDate,
    newDueDate:
      data.newDueDate instanceof Date
        ? data.newDueDate.toISOString()
        : data.newDueDate,
  });
});

// Catch-all for plan/schedule edits that don't have their own dedicated
// event: a Gantt drag or resize, the auto-reschedule cascade, a progress or
// milestone edit, a constraint change, and setting/clearing a baseline all
// publish this. `changes` (see diff-schedule-fields.ts) is only present,
// and only ever non-empty, when one of those fields actually differs, so a
// plain title/description/priority edit through the same endpoint is
// dropped rather than logged as a content-free "updated".
subscribeToEvent<{
  taskId: string;
  userId?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
}>("task.updated", async (data) => {
  if (!data.taskId || !data.userId || !data.changes) {
    return;
  }
  if (Object.keys(data.changes).length === 0) {
    return;
  }
  await createActivity(data.taskId, "updated", data.userId, null, {
    changes: data.changes,
  });
});

// task-relation.created/.updated/.deleted are already published for
// realtime/WS purposes (see task-relation/controllers/*.ts). When a relation
// links tasks in two different projects, the same event is published a
// second time with the other project's id so its own subscribers refresh —
// `secondaryNotification` marks that duplicate so it isn't logged twice
// against the same (source) task.
type TaskRelationEventData = {
  id: string;
  taskId: string;
  userId?: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
  dependencyType?: string;
  lagDays?: number;
  secondaryNotification?: boolean;
};

subscribeToEvent<TaskRelationEventData>(
  "task-relation.created",
  async (data) => {
    if (!data.taskId || !data.userId || !data.id) return;
    if (data.secondaryNotification) return;
    await createActivity(data.taskId, "relation_created", data.userId, null, {
      relationId: data.id,
      relationType: data.relationType,
      sourceTaskId: data.sourceTaskId,
      targetTaskId: data.targetTaskId,
      dependencyType: data.dependencyType,
      lagDays: data.lagDays,
    });
  },
);

subscribeToEvent<TaskRelationEventData>(
  "task-relation.updated",
  async (data) => {
    if (!data.taskId || !data.userId || !data.id) return;
    if (data.secondaryNotification) return;
    await createActivity(data.taskId, "relation_updated", data.userId, null, {
      relationId: data.id,
      relationType: data.relationType,
      sourceTaskId: data.sourceTaskId,
      targetTaskId: data.targetTaskId,
      dependencyType: data.dependencyType,
      lagDays: data.lagDays,
    });
  },
);

subscribeToEvent<TaskRelationEventData>(
  "task-relation.deleted",
  async (data) => {
    if (!data.taskId || !data.userId || !data.id) return;
    if (data.secondaryNotification) return;
    await createActivity(data.taskId, "relation_deleted", data.userId, null, {
      relationId: data.id,
      relationType: data.relationType,
      sourceTaskId: data.sourceTaskId,
      targetTaskId: data.targetTaskId,
    });
  },
);

export default activity;
