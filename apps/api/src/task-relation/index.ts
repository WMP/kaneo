import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTable, taskRelationTable, taskTable } from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { resolveProjectAccess } from "../utils/project-access";
import { visibleProjectIdsFor } from "../utils/project-scope-filters";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import {
  assertProjectAccess,
  lookupScope,
  workspaceAccess,
} from "../utils/workspace-access-middleware";
import createTaskRelation from "./controllers/create-task-relation";
import deleteTaskRelation from "./controllers/delete-task-relation";
import getTaskRelations from "./controllers/get-task-relations";
import getTaskRelationsByProject from "./controllers/get-task-relations-by-project";
import updateTaskRelation from "./controllers/update-task-relation";
import {
  taskRelationSchema,
  taskRelationWithTasksListSchema,
} from "./response";
import {
  createTaskRelationBody,
  projectIdParam,
  taskIdParam,
  taskRelationParam,
  updateTaskRelationBody,
} from "./schema";

function requireUserId(c: Context) {
  const userId = c.get("userId");
  if (!userId) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return userId as string;
}

// Route middleware runs before the request validators, so these read the raw
// request rather than c.req.valid(), which is not populated yet.
async function scopeToSourceTask(c: Context, next: Next) {
  const userId = requireUserId(c);

  const body = (await c.req.json().catch(() => ({}))) as {
    sourceTaskId?: unknown;
  };
  const sourceTaskId =
    typeof body?.sourceTaskId === "string" ? body.sourceTaskId : null;
  if (!sourceTaskId) {
    throw new HTTPException(400, { message: "sourceTaskId is required" });
  }

  const scope = await lookupScope("task", sourceTaskId);
  if (!scope) {
    throw new HTTPException(404, { message: "Source task not found" });
  }

  await validateWorkspaceAccess(userId, scope.workspaceId, c.get("apiKey")?.id);
  await assertProjectAccess(c, userId, { projectId: scope.projectId });
  c.set("workspaceId", scope.workspaceId);
  return next();
}

const RELATION_NOT_FOUND = "Task relation not found";

// An update or delete acts on a relation, whose response carries both of its
// ends. The caller needs access to BOTH projects, and any shortfall answers 404
// (never 403), so the route cannot tell "no such relation" from "a relation you
// may not see". Both ends are loaded in one query, and the second access
// decision is skipped when they share a project.
async function scopeToRelation(c: Context, next: Next) {
  const userId = requireUserId(c);

  const target = alias(taskTable, "relation_target_task");
  const targetProject = alias(projectTable, "relation_target_project");
  const id = c.req.param("id");
  const [rel] = await db
    .select({
      workspaceId: projectTable.workspaceId,
      sourceProjectId: taskTable.projectId,
      targetProjectId: target.projectId,
      targetWorkspaceId: targetProject.workspaceId,
    })
    .from(taskRelationTable)
    .innerJoin(taskTable, eq(taskRelationTable.sourceTaskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .innerJoin(target, eq(taskRelationTable.targetTaskId, target.id))
    .innerJoin(targetProject, eq(target.projectId, targetProject.id))
    .where(eq(taskRelationTable.id, id ?? ""))
    .limit(1);
  if (!rel) {
    throw new HTTPException(404, { message: RELATION_NOT_FOUND });
  }

  try {
    await validateWorkspaceAccess(userId, rel.workspaceId, c.get("apiKey")?.id);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) {
      throw new HTTPException(404, { message: RELATION_NOT_FOUND });
    }
    throw error;
  }

  const sourceAccess = await resolveProjectAccess(userId, rel.sourceProjectId);
  if (!sourceAccess) {
    throw new HTTPException(404, { message: RELATION_NOT_FOUND });
  }
  if (
    rel.targetProjectId !== rel.sourceProjectId &&
    // A legacy row across workspaces is refused by the controller itself.
    rel.targetWorkspaceId === rel.workspaceId &&
    !(await resolveProjectAccess(userId, rel.targetProjectId))
  ) {
    throw new HTTPException(404, { message: RELATION_NOT_FOUND });
  }

  c.set("projectId", rel.sourceProjectId);
  c.set("projectAccess", sourceAccess);
  c.set("workspaceId", rel.workspaceId);
  return next();
}

const getTaskRelationsRoute = createRoute({
  method: "get",
  operationId: "getTaskRelations",
  path: "/{taskId}",
  tags: ["Task Relations"],
  summary: "Get task relations",
  description:
    "Get every relation where the task is the source or the target, each with a summary of both linked tasks. Relations pointing outside the caller's workspace, or to a task in a project the caller cannot access, are omitted.",
  middleware: [workspaceAccess.fromTaskId("taskId")] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse(
      "Task relations with the linked task summaries",
      taskRelationWithTasksListSchema,
    ),
    400: errorResponse(
      "Unknown task, or its workspace could not be determined",
    ),
    403: errorResponse("No access to the task's workspace"),
  },
});

const getTaskRelationsByProjectRoute = createRoute({
  method: "get",
  operationId: "getTaskRelationsByProject",
  path: "/project/{projectId}",
  tags: ["Task Relations"],
  summary: "Get project task relations",
  description:
    "Get every relation touching one of the project's tasks, each with a summary of both linked tasks, in a single call. Powers the Gantt chart's dependency lines. Relations pointing outside the caller's workspace, or to a task in a project the caller cannot access, are omitted.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "Task relations with the linked task summaries",
      taskRelationWithTasksListSchema,
    ),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("No workspace access or missing read permission"),
  },
});

const createTaskRelationRoute = createRoute({
  method: "post",
  operationId: "createTaskRelation",
  path: "/",
  tags: ["Task Relations"],
  summary: "Create task relation",
  description:
    "Link two tasks. Authorization is scoped to the source task's workspace.",
  middleware: [
    scopeToSourceTask,
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createTaskRelationBody } },
    },
  },
  responses: {
    200: jsonResponse("The created relation", taskRelationSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse("Source or target task not found"),
    409: errorResponse(
      "This relation already exists, or (for a 'blocks'/'subtask' relation) would create a circular dependency",
    ),
  },
});

const updateTaskRelationRoute = createRoute({
  method: "patch",
  operationId: "updateTaskRelation",
  path: "/{id}",
  tags: ["Task Relations"],
  summary: "Update task relation",
  description:
    "Change a 'blocks' relation's dependency type and/or lag. Rejected for a 'related'/'subtask' relation, which has no dependency type/lag to edit. Answers 404 when the relation does not exist or when either of its tasks is in a project the caller cannot access.",
  middleware: [
    scopeToRelation,
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    params: taskRelationParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTaskRelationBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated relation", taskRelationSchema),
    400: errorResponse("Invalid body, or the relation is not a 'blocks' one"),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse(
      "Task relation not found, or a task of it is in a project the caller cannot access",
    ),
  },
});

const deleteTaskRelationRoute = createRoute({
  method: "delete",
  operationId: "deleteTaskRelation",
  path: "/{id}",
  tags: ["Task Relations"],
  summary: "Delete task relation",
  description:
    "Remove a link between two tasks. Returns the deleted relation. Answers 404 when the relation does not exist or when either of its tasks is in a project the caller cannot access.",
  middleware: [
    scopeToRelation,
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: { params: taskRelationParam },
  responses: {
    200: jsonResponse("The deleted relation", taskRelationSchema),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse(
      "Task relation not found, or a task of it is in a project the caller cannot access",
    ),
  },
});

const taskRelation = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getTaskRelationsRoute, async (c) =>
    c.json(
      await getTaskRelations(
        c.req.valid("param").taskId,
        c.get("workspaceId"),
        await visibleProjectIdsFor(
          c.get("projectAccess"),
          c.get("userId"),
          c.get("workspaceId"),
        ),
      ),
      200,
    ),
  )
  .openapi(getTaskRelationsByProjectRoute, async (c) =>
    c.json(
      await getTaskRelationsByProject(
        c.req.valid("param").projectId,
        c.get("workspaceId"),
        await visibleProjectIdsFor(
          c.get("projectAccess"),
          c.get("userId"),
          c.get("workspaceId"),
        ),
      ),
      200,
    ),
  )
  .openapi(createTaskRelationRoute, async (c) => {
    const {
      sourceTaskId,
      targetTaskId,
      relationType,
      dependencyType,
      lagDays,
    } = c.req.valid("json");
    return c.json(
      await createTaskRelation({
        sourceTaskId,
        targetTaskId,
        relationType,
        dependencyType,
        lagDays,
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
      }),
      200,
    );
  })
  .openapi(updateTaskRelationRoute, async (c) =>
    c.json(
      await updateTaskRelation(
        c.req.valid("param").id,
        c.req.valid("json"),
        c.get("userId"),
        c.get("workspaceId"),
      ),
      200,
    ),
  )
  .openapi(deleteTaskRelationRoute, async (c) =>
    c.json(
      await deleteTaskRelation(
        c.req.valid("param").id,
        c.get("userId"),
        c.get("workspaceId"),
      ),
      200,
    ),
  );

export default taskRelation;
