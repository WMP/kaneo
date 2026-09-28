import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createResource from "./controllers/create-resource";
import deleteResource from "./controllers/delete-resource";
import listResources from "./controllers/list-resources";
import updateResource from "./controllers/update-resource";
import { resourceListSchema, resourceSchema } from "./response";
import {
  createResourceBody,
  listResourcesQuery,
  resourceIdParam,
  updateResourceBody,
  workspaceIdParam,
} from "./schema";

// Gated the same as the workspace-level custom-field routes: project:update
// resolved directly against the workspace, since managing a workspace's
// assignable resources is a workspace-admin action, not tied to one project.
const RESOURCE_MANAGE_PERMISSION = { project: ["update"] };

const listResourcesRoute = createRoute({
  method: "get",
  operationId: "listResources",
  path: "/workspace/{workspaceId}",
  tags: ["Resources"],
  summary: "List workspace resources",
  description:
    "List a workspace's account-less assignable resources (people, equipment, material). Pass ?kind= to restrict to one kind.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: { params: workspaceIdParam, query: listResourcesQuery },
  responses: {
    200: jsonResponse("List of workspace resources", resourceListSchema),
    403: errorResponse("No workspace access or missing read permission"),
  },
});

const createResourceRoute = createRoute({
  method: "post",
  operationId: "createResource",
  path: "/workspace/{workspaceId}",
  tags: ["Resources"],
  summary: "Create a workspace resource",
  description:
    "Create an account-less assignable resource (a person, equipment, or material) in this workspace. It has no Kaneo account and can't sign in; it can be assigned to tasks like a user.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission(RESOURCE_MANAGE_PERMISSION),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createResourceBody } },
    },
  },
  responses: {
    200: jsonResponse("The created resource", resourceSchema),
    400: errorResponse("Invalid body, or unknown workspace"),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
    404: errorResponse("Workspace not found"),
  },
});

const updateResourceRoute = createRoute({
  method: "patch",
  operationId: "updateResource",
  path: "/{id}",
  tags: ["Resources"],
  summary: "Update a resource",
  description:
    "Update a resource's name or email. Its kind can't be changed after creation.",
  middleware: [
    workspaceAccess.fromResource("id"),
    requireWorkspacePermission(RESOURCE_MANAGE_PERMISSION),
  ] as const,
  request: {
    params: resourceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateResourceBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated resource", resourceSchema),
    400: errorResponse("Invalid body, or unknown resource"),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
    404: errorResponse("Resource not found"),
  },
});

const deleteResourceRoute = createRoute({
  method: "delete",
  operationId: "deleteResource",
  path: "/{id}",
  tags: ["Resources"],
  summary: "Delete a resource",
  description:
    "Permanently delete a resource. It is removed from every task it was assigned to.",
  middleware: [
    workspaceAccess.fromResource("id"),
    requireWorkspacePermission(RESOURCE_MANAGE_PERMISSION),
  ] as const,
  request: { params: resourceIdParam },
  responses: {
    200: jsonResponse("The deleted resource", resourceSchema),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
    404: errorResponse("Resource not found"),
  },
});

const resource = apiRouter()
  .openapi(listResourcesRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { kind } = c.req.valid("query");
    return c.json(await listResources(workspaceId, kind), 200);
  })
  .openapi(createResourceRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { kind, name, email } = c.req.valid("json");
    return c.json(await createResource(workspaceId, kind, name, email), 200);
  })
  .openapi(updateResourceRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { name, email } = c.req.valid("json");
    return c.json(await updateResource(id, name, email), 200);
  })
  .openapi(deleteResourceRoute, async (c) =>
    c.json(await deleteResource(c.req.valid("param").id), 200),
  );

export default resource;
