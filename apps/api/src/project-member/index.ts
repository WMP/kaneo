import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { assignableRolesSchema } from "../workspace/response";
import addProjectMember from "./controllers/add-project-member";
import getAssignableProjectRoles from "./controllers/get-assignable-project-roles";
import listProjectMembers from "./controllers/list-project-members";
import removeProjectMember from "./controllers/remove-project-member";
import updateProjectMember from "./controllers/update-project-member";
import { requireProjectAccess } from "./delegation";
import { projectMemberListSchema, projectMemberSchema } from "./response";
import {
  addProjectMemberBody,
  projectIdParam,
  projectMemberParam,
  updateProjectMemberBody,
} from "./schema";

const listProjectMembersRoute = createRoute({
  method: "get",
  operationId: "listProjectMembers",
  path: "/{projectId}/members",
  tags: ["Project members"],
  summary: "List project members",
  description:
    "List who can reach the project: members of the project (source project, with their project role) and workspace members with full access (source full-access, with their workspace role). Any project access is enough.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Project members", projectMemberListSchema),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("No access to the project"),
  },
});

const addProjectMemberRoute = createRoute({
  method: "post",
  operationId: "addProjectMember",
  path: "/{projectId}/members",
  tags: ["Project members"],
  summary: "Add a project member",
  description:
    "Give an existing workspace member access to the project with a project role. Requires member:create in the caller's effective project permissions. The role must exist in the workspace, must not be owner, and every permission it carries must also be held by the caller (owners and instance administrators may assign any role except owner). Errors: 400 'The owner role cannot be a project role', 400 'Unknown role', 403 'You cannot assign a role with permissions you do not have', 404 'User is not a member of this workspace', 409 'User is already a member of this project', 409 'User already has full access to this project'.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ member: ["create"] }),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: addProjectMemberBody } },
    },
  },
  responses: {
    200: jsonResponse("The new project member", projectMemberSchema),
    400: errorResponse("Invalid body, owner role, or unknown role"),
    403: errorResponse(
      "No access to the project, missing member:create permission, or the role exceeds the caller's permissions",
    ),
    404: errorResponse("The user is not a member of the workspace"),
    409: errorResponse(
      "The user is already a project member or already has full access",
    ),
  },
});

const updateProjectMemberRoute = createRoute({
  method: "patch",
  operationId: "updateProjectMember",
  path: "/{projectId}/members/{userId}",
  tags: ["Project members"],
  summary: "Change a project member's role",
  description:
    "Change the project role of a project member. Requires member:update in the caller's effective project permissions. Both the member's current role and the new role must be within the caller's own permissions, and only owners and instance administrators may change their own row. Errors: 400 'Members with full access cannot be changed or removed at project level', 400 'The owner role cannot be a project role', 400 'Unknown role', 403 'You cannot change your own project role', 403 'You cannot assign a role with permissions you do not have', 403 'You cannot manage a member with permissions you do not have', 404 'User is not a member of this project'.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ member: ["update"] }),
  ] as const,
  request: {
    params: projectMemberParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateProjectMemberBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated project member", projectMemberSchema),
    400: errorResponse(
      "Invalid body, owner role, unknown role, or the member has full access",
    ),
    403: errorResponse(
      "No access to the project, missing member:update permission, own role, or a role beyond the caller's permissions",
    ),
    404: errorResponse("The user is not a member of the project"),
  },
});

const removeProjectMemberRoute = createRoute({
  method: "delete",
  operationId: "removeProjectMember",
  path: "/{projectId}/members/{userId}",
  tags: ["Project members"],
  summary: "Remove a project member or leave the project",
  description:
    "Remove a member from the project, or leave it by passing your own user id (no extra permission needed). Removing somebody else requires member:delete in the caller's effective project permissions and a target role within the caller's own permissions. Errors: 400 'Members with full access cannot be changed or removed at project level', 403 'Insufficient permissions', 403 'You cannot manage a member with permissions you do not have', 404 'User is not a member of this project'.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectMemberParam },
  responses: {
    200: jsonResponse("The removed project member", projectMemberSchema),
    400: errorResponse("The member has full access and cannot be removed"),
    403: errorResponse(
      "No access to the project, missing member:delete permission, or a member beyond the caller's permissions",
    ),
    404: errorResponse("The user is not a member of the project"),
  },
});

const getProjectAssignableRolesRoute = createRoute({
  method: "get",
  operationId: "getProjectAssignableRoles",
  path: "/{projectId}/assignable-roles",
  tags: ["Project members"],
  summary: "Get assignable project roles",
  description:
    "List the roles the caller may grant as a project role: those whose permissions the caller also holds in this project. Owners and instance administrators can assign every role except owner.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Roles the caller may assign", assignableRolesSchema),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("No access to the project"),
  },
});

const projectMember = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listProjectMembersRoute, async (c) => {
    const access = requireProjectAccess(c.get("projectAccess"));
    return c.json(
      await listProjectMembers(access.projectId, access.workspaceId),
      200,
    );
  })
  .openapi(addProjectMemberRoute, async (c) => {
    const access = requireProjectAccess(c.get("projectAccess"));
    const { userId, role } = c.req.valid("json");
    return c.json(await addProjectMember({ access, userId, role }), 200);
  })
  .openapi(updateProjectMemberRoute, async (c) => {
    const access = requireProjectAccess(c.get("projectAccess"));
    const { userId } = c.req.valid("param");
    const { role } = c.req.valid("json");
    return c.json(
      await updateProjectMember({
        access,
        actorUserId: c.get("userId"),
        userId,
        role,
      }),
      200,
    );
  })
  .openapi(removeProjectMemberRoute, async (c) => {
    const access = requireProjectAccess(c.get("projectAccess"));
    const { userId } = c.req.valid("param");
    return c.json(
      await removeProjectMember({
        c,
        access,
        actorUserId: c.get("userId"),
        userId,
      }),
      200,
    );
  })
  .openapi(getProjectAssignableRolesRoute, async (c) => {
    const access = requireProjectAccess(c.get("projectAccess"));
    return c.json(await getAssignableProjectRoles(access), 200);
  });

export default projectMember;
