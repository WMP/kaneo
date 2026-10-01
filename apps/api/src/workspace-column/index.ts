import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { codedErrorResponse } from "../utils/coded-error";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createWorkspaceColumn from "./controllers/create-workspace-column";
import deleteWorkspaceColumn from "./controllers/delete-workspace-column";
import { previewEnforcement, setEnforcement } from "./controllers/enforcement";
import getWorkspaceColumns from "./controllers/get-workspace-columns";
import reorderWorkspaceColumns from "./controllers/reorder-workspace-columns";
import updateWorkspaceColumn from "./controllers/update-workspace-column";
import {
  enforcementPreviewSchema,
  enforcementResultSchema,
  workspaceColumnSchema,
  workspaceColumnsSchema,
} from "./response";
import {
  createWorkspaceColumnBody,
  deleteWorkspaceColumnQuery,
  enforcementPreviewQuery,
  reorderWorkspaceColumnsBody,
  setEnforcementBody,
  updateWorkspaceColumnBody,
  workspaceColumnParam,
  workspaceIdParam,
} from "./schema";

// Managing workspace columns takes the permission that managing workspace
// custom fields takes (project:update in the WORKSPACE role: the routes resolve
// no project). Reading needs project:read, which every member holds: the
// project page needs the `enforced` flag. Turning enforcement on or off
// rewrites the columns of every project, so it is a workspace setting.
const MANAGE_PERMISSION = { project: ["update"] };
const READ_PERMISSION = { project: ["read"] };
const ENFORCEMENT_PERMISSION = { workspace: ["manage_settings"] };

const forbidden = errorResponse("No workspace access, or missing permission");

const getWorkspaceColumnsRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceColumns",
  path: "/{workspaceId}",
  tags: ["Workspace Columns"],
  summary: "Get workspace columns",
  description:
    "Get the board columns defined for a workspace, ordered by position, and whether the workspace enforces them in every project.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission(READ_PERMISSION),
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse(
      "Workspace columns and enforcement flag",
      workspaceColumnsSchema,
    ),
    400: errorResponse("The workspace could not be determined"),
    403: forbidden,
    404: errorResponse("Workspace not found"),
  },
});

const createWorkspaceColumnRoute = createRoute({
  method: "post",
  operationId: "createWorkspaceColumn",
  path: "/{workspaceId}",
  tags: ["Workspace Columns"],
  summary: "Create workspace column",
  description:
    "Add a column to the end of the workspace columns. The slug is derived from the name. When the workspace enforces its columns, the column is created in every project. Errors carry a `code`: 409 WORKSPACE_COLUMN_SLUG_CONFLICT, 409 WORKSPACE_COLUMN_RESERVED_SLUG.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission(MANAGE_PERMISSION),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createWorkspaceColumnBody } },
    },
  },
  responses: {
    200: jsonResponse("The created column", workspaceColumnSchema),
    400: errorResponse("Invalid body"),
    403: forbidden,
    404: errorResponse("Workspace not found"),
    409: codedErrorResponse(
      "The slug is reserved, or already used in this workspace",
    ),
  },
});

const reorderWorkspaceColumnsRoute = createRoute({
  method: "put",
  operationId: "reorderWorkspaceColumns",
  path: "/{workspaceId}/reorder",
  tags: ["Workspace Columns"],
  summary: "Reorder workspace columns",
  description:
    "Set new positions for workspace columns and return all of them in the new order. When the workspace enforces its columns, every project gets the same positions.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission(MANAGE_PERMISSION),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: reorderWorkspaceColumnsBody },
      },
    },
  },
  responses: {
    200: jsonResponse("The reordered columns", workspaceColumnSchema.array()),
    400: errorResponse("Invalid body"),
    403: forbidden,
    404: errorResponse("A column does not belong to this workspace"),
  },
});

const enforcementPreviewRoute = createRoute({
  method: "get",
  operationId: "previewWorkspaceColumnEnforcement",
  path: "/{workspaceId}/enforcement-preview",
  tags: ["Workspace Columns"],
  summary: "Preview column enforcement",
  description:
    "Dry run of turning enforcement on: per project the columns that would be created, removed or changed, the tasks that would move to the fallback column and the workflow rules that would be deleted. Only projects the caller can see are listed. Errors carry a `code`: 400 WORKSPACE_COLUMNS_EMPTY.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission(ENFORCEMENT_PERMISSION),
  ] as const,
  request: { params: workspaceIdParam, query: enforcementPreviewQuery },
  responses: {
    200: jsonResponse(
      "What enforcement would change",
      enforcementPreviewSchema,
    ),
    400: codedErrorResponse(
      "The workspace has no columns, or the workspace could not be determined",
    ),
    403: forbidden,
    404: errorResponse("The fallback column is not a workspace column"),
  },
});

const setEnforcementRoute = createRoute({
  method: "put",
  operationId: "setWorkspaceColumnEnforcement",
  path: "/{workspaceId}/enforcement",
  tags: ["Workspace Columns"],
  summary: "Turn column enforcement on or off",
  description:
    "Turning enforcement on matches the columns of every project to the workspace columns in one transaction (a column linked to the workspace column, then the same slug, then the same name), creates the missing ones, moves the tasks of unmatched columns to the fallback column and deletes those columns together with their workflow rules. Turning it off only clears the flag. Errors carry a `code`: 400 WORKSPACE_COLUMNS_EMPTY.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission(ENFORCEMENT_PERMISSION),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: setEnforcementBody } },
    },
  },
  responses: {
    200: jsonResponse("What changed", enforcementResultSchema),
    400: codedErrorResponse("Invalid body, or the workspace has no columns"),
    403: forbidden,
    404: errorResponse("The fallback column is not a workspace column"),
  },
});

const updateWorkspaceColumnRoute = createRoute({
  method: "put",
  operationId: "updateWorkspaceColumn",
  path: "/{workspaceId}/{columnId}",
  tags: ["Workspace Columns"],
  summary: "Update workspace column",
  description:
    "Update a workspace column. Omitted fields are left unchanged; icon and color accept null to clear them. The slug never changes. When the workspace enforces its columns, every project column linked to it gets the same values.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission(MANAGE_PERMISSION),
  ] as const,
  request: {
    params: workspaceColumnParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateWorkspaceColumnBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated column", workspaceColumnSchema),
    400: errorResponse("Invalid body"),
    403: forbidden,
    404: errorResponse("The column does not belong to this workspace"),
  },
});

const deleteWorkspaceColumnRoute = createRoute({
  method: "delete",
  operationId: "deleteWorkspaceColumn",
  path: "/{workspaceId}/{columnId}",
  tags: ["Workspace Columns"],
  summary: "Delete workspace column",
  description:
    "Delete a workspace column. When the workspace enforces its columns, the column disappears from every project: tasks in it move to the column passed as moveTasksTo (409 WORKSPACE_COLUMN_NOT_EMPTY when a task exists and none is given), workflow rules on it are deleted, and the last column cannot be deleted (409 WORKSPACE_COLUMN_LAST). Without enforcement projects keep their columns.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission(MANAGE_PERMISSION),
  ] as const,
  request: { params: workspaceColumnParam, query: deleteWorkspaceColumnQuery },
  responses: {
    200: jsonResponse("The deleted column", workspaceColumnSchema),
    400: errorResponse("moveTasksTo is the column being deleted"),
    403: forbidden,
    404: errorResponse(
      "The column, or the column to move tasks to, does not belong to this workspace",
    ),
    409: codedErrorResponse(
      "Tasks would be left without a column, or this is the last column",
    ),
  },
});

// Static paths (`reorder`, `enforcement`, `enforcement-preview`) are registered
// before the `{columnId}` routes so they are never read as a column id.
const workspaceColumn = apiRouter()
  .openapi(getWorkspaceColumnsRoute, async (c) =>
    c.json(await getWorkspaceColumns(c.req.valid("param").workspaceId), 200),
  )
  .openapi(createWorkspaceColumnRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { name, icon, color, isFinal } = c.req.valid("json");
    return c.json(
      await createWorkspaceColumn({ workspaceId, name, icon, color, isFinal }),
      200,
    );
  })
  .openapi(reorderWorkspaceColumnsRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { columns } = c.req.valid("json");
    return c.json(await reorderWorkspaceColumns(workspaceId, columns), 200);
  })
  .openapi(enforcementPreviewRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { fallbackColumnId } = c.req.valid("query");
    return c.json(
      await previewEnforcement({
        workspaceId,
        userId: c.get("userId"),
        fallbackColumnId,
      }),
      200,
    );
  })
  .openapi(setEnforcementRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { enforced, fallbackColumnId } = c.req.valid("json");
    return c.json(
      await setEnforcement({ workspaceId, enforced, fallbackColumnId }),
      200,
    );
  })
  .openapi(updateWorkspaceColumnRoute, async (c) => {
    const { workspaceId, columnId } = c.req.valid("param");
    return c.json(
      await updateWorkspaceColumn(workspaceId, columnId, c.req.valid("json")),
      200,
    );
  })
  .openapi(deleteWorkspaceColumnRoute, async (c) => {
    const { workspaceId, columnId } = c.req.valid("param");
    const { moveTasksTo } = c.req.valid("query");
    return c.json(
      await deleteWorkspaceColumn(workspaceId, columnId, moveTasksTo),
      200,
    );
  });

export default workspaceColumn;
