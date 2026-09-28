import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createCustomField from "./controllers/create-custom-field";
import createWorkspaceCustomField from "./controllers/create-workspace-custom-field";
import deleteCustomField from "./controllers/delete-custom-field";
import getCustomFieldFilterValues from "./controllers/get-custom-field-filter-values";
import getCustomFieldValuesByProject from "./controllers/get-custom-field-values-by-project";
import getCustomFieldValuesByTask from "./controllers/get-custom-field-values-by-task";
import getCustomFieldsByProject from "./controllers/get-custom-fields-by-project";
import getWorkspaceCustomFields from "./controllers/get-workspace-custom-fields";
import reorderCustomFields from "./controllers/reorder-custom-field";
import reorderWorkspaceCustomFields from "./controllers/reorder-workspace-custom-field";
import setCustomFieldValue from "./controllers/set-custom-field-value";
import setCustomFieldVisibility from "./controllers/set-custom-field-visibility";
import updateCustomField from "./controllers/update-custom-field";
import {
  customFieldDefinitionListSchema,
  customFieldDefinitionSchema,
  customFieldFilterValuesListSchema,
  customFieldValueListSchema,
  reorderCustomFieldsResponseSchema,
  setCustomFieldValueResponseSchema,
} from "./response";
import {
  createCustomFieldBody,
  createWorkspaceCustomFieldBody,
  customFieldIdParam,
  getCustomFieldsQuery,
  projectIdParam,
  reorderCustomFieldsBody,
  reorderWorkspaceCustomFieldsBody,
  setCustomFieldValueBody,
  setCustomFieldVisibilityBody,
  taskIdParam,
  updateCustomFieldBody,
  workspaceIdParam,
} from "./schema";

// Same permission the project-scoped custom-field routes below gate their
// mutations on (project:update — a project admin), just resolved against the
// workspace directly instead of through a project lookup. A workspace field
// is inherited by every project in the workspace, so managing it is a
// workspace-admin action.
const WORKSPACE_FIELD_MANAGE_PERMISSION = {
  project: ["update"],
};

const getCustomFieldsRoute = createRoute({
  method: "get",
  operationId: "getCustomFieldsByProject",
  path: "/project/{projectId}",
  tags: ["Custom Fields"],
  summary: "Get custom fields",
  description:
    "Get the effective custom field definitions for a project: its workspace's fields (minus the ones this project hides) plus the project's own fields. " +
    "Pass ?includeHidden=true to instead get every inherited workspace field — hidden ones included, with their real per-project hidden state — for the project's field-visibility editor.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: { params: projectIdParam, query: getCustomFieldsQuery },
  responses: {
    200: jsonResponse(
      "List of custom field definitions",
      customFieldDefinitionListSchema,
    ),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("No workspace access or missing read permission"),
  },
});

const getCustomFieldValuesByProjectRoute = createRoute({
  method: "get",
  operationId: "getCustomFieldValuesByProject",
  path: "/project/{projectId}/values",
  tags: ["Custom Fields"],
  summary: "Get project custom field values",
  description:
    "Get all custom field values for every task in a project, including values for inherited (non-hidden) workspace fields.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "List of custom field values for the project",
      customFieldValueListSchema,
    ),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("No workspace access or missing read permission"),
  },
});

const getCustomFieldValuesByTaskRoute = createRoute({
  method: "get",
  operationId: "getCustomFieldValuesByTask",
  path: "/task/{taskId}",
  tags: ["Custom Fields"],
  summary: "Get task custom field values",
  description:
    "Get all custom field values for a task with their definitions, including values for inherited (non-hidden) workspace fields.",
  middleware: [
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse(
      "List of custom field values for the task",
      customFieldValueListSchema,
    ),
    400: errorResponse(
      "Unknown task, or its workspace could not be determined",
    ),
    403: errorResponse("No workspace access or missing task:read permission"),
  },
});

const getCustomFieldFilterValuesRoute = createRoute({
  method: "get",
  operationId: "getCustomFieldFilterValues",
  path: "/project/{projectId}/filter-values",
  tags: ["Custom Fields"],
  summary: "Get custom field filter values",
  description:
    "Get distinct values used by tasks for each of a project's effective custom fields.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "Distinct values used for each custom field",
      customFieldFilterValuesListSchema,
    ),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("No workspace access or missing read permission"),
  },
});

const createCustomFieldRoute = createRoute({
  method: "post",
  operationId: "createCustomField",
  path: "/",
  tags: ["Custom Fields"],
  summary: "Create custom field",
  description: "Create a custom field definition for a project.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createCustomFieldBody } },
    },
  },
  responses: {
    200: jsonResponse("The created custom field", customFieldDefinitionSchema),
    400: errorResponse("Invalid body, or unknown project"),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
  },
});

const getWorkspaceCustomFieldsRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceCustomFields",
  path: "/workspace/{workspaceId}",
  tags: ["Custom Fields"],
  summary: "Get workspace custom fields",
  description:
    "Get all workspace-level custom field definitions, inherited by every project in the workspace.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse(
      "List of workspace-level custom field definitions",
      customFieldDefinitionListSchema,
    ),
    403: errorResponse("No workspace access or missing read permission"),
  },
});

const createWorkspaceCustomFieldRoute = createRoute({
  method: "post",
  operationId: "createWorkspaceCustomField",
  path: "/workspace/{workspaceId}",
  tags: ["Custom Fields"],
  summary: "Create workspace custom field",
  description:
    "Create a workspace-level custom field definition, inherited by every project in the workspace.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission(WORKSPACE_FIELD_MANAGE_PERMISSION),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: createWorkspaceCustomFieldBody },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "The created workspace custom field",
      customFieldDefinitionSchema,
    ),
    400: errorResponse("Invalid body, or unknown workspace"),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
  },
});

const updateCustomFieldRoute = createRoute({
  method: "patch",
  operationId: "updateCustomField",
  path: "/{id}",
  tags: ["Custom Fields"],
  summary: "Update custom field",
  description:
    "Update a custom field definition's name or dropdown option colors. Works for both a project-level field and a workspace-level field — a workspace field's name/type/options stay shared across every project that inherits it.",
  middleware: [
    workspaceAccess.fromCustomField("id"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: customFieldIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateCustomFieldBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated custom field", customFieldDefinitionSchema),
    400: errorResponse(
      "Invalid body, unknown custom field, or its workspace could not be determined",
    ),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
  },
});

const reorderCustomFieldsRoute = createRoute({
  method: "put",
  operationId: "reorderCustomFields",
  path: "/reorder/{projectId}",
  tags: ["Custom Fields"],
  summary: "Reorder custom fields",
  description: "Set new positions for a project's own custom fields.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: reorderCustomFieldsBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The reordered custom fields",
      reorderCustomFieldsResponseSchema,
    ),
    400: errorResponse("A custom field does not belong to this project"),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
  },
});

const reorderWorkspaceCustomFieldsRoute = createRoute({
  method: "put",
  operationId: "reorderWorkspaceCustomFields",
  path: "/workspace/{workspaceId}/reorder",
  tags: ["Custom Fields"],
  summary: "Reorder workspace custom fields",
  description: "Set new positions for a workspace's custom fields.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission(WORKSPACE_FIELD_MANAGE_PERMISSION),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: reorderWorkspaceCustomFieldsBody },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "The reordered workspace custom fields",
      reorderCustomFieldsResponseSchema,
    ),
    400: errorResponse("A custom field does not belong to this workspace"),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
  },
});

const setCustomFieldValueRoute = createRoute({
  method: "put",
  operationId: "setCustomFieldValue",
  path: "/value",
  tags: ["Custom Fields"],
  summary: "Set custom field value",
  description:
    "Create or update a custom field value for a task. The field must be one of the task's project's effective fields — its own field, or an inherited workspace field the project hasn't hidden.",
  middleware: [
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: setCustomFieldValueBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The saved custom field value",
      setCustomFieldValueResponseSchema,
    ),
    400: errorResponse("Invalid body, unknown task, or unknown custom field"),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
  },
});

const setCustomFieldVisibilityRoute = createRoute({
  method: "post",
  operationId: "setCustomFieldVisibility",
  path: "/project/{projectId}/visibility",
  tags: ["Custom Fields"],
  summary: "Hide or show an inherited workspace field",
  description:
    "Hide or show, for this project only, a custom field inherited from its workspace. A required workspace field can never be hidden, and a project-level field isn't a valid target.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: setCustomFieldVisibilityBody },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "The field's new visibility for this project",
      customFieldDefinitionSchema,
    ),
    400: errorResponse(
      "The field isn't a workspace-level field of this project's workspace",
    ),
    403: errorResponse(
      "No workspace access, missing project:update permission, or the field is required and can't be hidden",
    ),
    404: errorResponse("Unknown project or custom field"),
  },
});

const deleteCustomFieldRoute = createRoute({
  method: "delete",
  operationId: "deleteCustomField",
  path: "/{id}",
  tags: ["Custom Fields"],
  summary: "Delete custom field",
  description:
    "Delete a custom field definition by ID — works for both a project-level and a workspace-level field.",
  middleware: [
    workspaceAccess.fromCustomField("id"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: customFieldIdParam },
  responses: {
    200: jsonResponse("The deleted custom field", customFieldDefinitionSchema),
    400: errorResponse(
      "Unknown custom field, or its workspace could not be determined",
    ),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
  },
});

const customField = apiRouter()
  .openapi(getCustomFieldsRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { includeHidden } = c.req.valid("query");
    return c.json(
      await getCustomFieldsByProject(projectId, includeHidden === "true"),
      200,
    );
  })
  .openapi(getCustomFieldValuesByProjectRoute, async (c) =>
    c.json(
      await getCustomFieldValuesByProject(c.req.valid("param").projectId),
      200,
    ),
  )
  .openapi(getCustomFieldValuesByTaskRoute, async (c) =>
    c.json(await getCustomFieldValuesByTask(c.req.valid("param").taskId), 200),
  )
  .openapi(getCustomFieldFilterValuesRoute, async (c) =>
    c.json(
      await getCustomFieldFilterValues(c.req.valid("param").projectId),
      200,
    ),
  )
  .openapi(createCustomFieldRoute, async (c) => {
    const {
      projectId,
      name,
      type,
      required,
      defaultValue,
      options,
      optionColors,
    } = c.req.valid("json");

    return c.json(
      await createCustomField(
        projectId,
        name,
        type,
        required,
        defaultValue,
        options,
        optionColors,
      ),
      200,
    );
  })
  .openapi(getWorkspaceCustomFieldsRoute, async (c) =>
    c.json(
      await getWorkspaceCustomFields(c.req.valid("param").workspaceId),
      200,
    ),
  )
  .openapi(createWorkspaceCustomFieldRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const {
      name,
      type,
      required,
      defaultValue,
      options,
      optionColors,
      position,
    } = c.req.valid("json");

    return c.json(
      await createWorkspaceCustomField(
        workspaceId,
        name,
        type,
        required,
        defaultValue,
        options,
        optionColors,
        position,
      ),
      200,
    );
  })
  .openapi(updateCustomFieldRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { name, optionColors } = c.req.valid("json");

    return c.json(await updateCustomField(id, name, optionColors), 200);
  })
  .openapi(reorderCustomFieldsRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { fields } = c.req.valid("json");

    return c.json(await reorderCustomFields(projectId, fields), 200);
  })
  .openapi(reorderWorkspaceCustomFieldsRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { fields } = c.req.valid("json");

    return c.json(await reorderWorkspaceCustomFields(workspaceId, fields), 200);
  })
  .openapi(setCustomFieldValueRoute, async (c) => {
    const { taskId, fieldId, value } = c.req.valid("json");

    return c.json(await setCustomFieldValue(taskId, fieldId, value), 200);
  })
  .openapi(setCustomFieldVisibilityRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { fieldId, hidden } = c.req.valid("json");

    return c.json(
      await setCustomFieldVisibility(projectId, fieldId, hidden),
      200,
    );
  })
  .openapi(deleteCustomFieldRoute, async (c) =>
    c.json(await deleteCustomField(c.req.valid("param").id), 200),
  );

export default customField;
