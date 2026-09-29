import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireInvitationRateLimit } from "../project-invitation/rate-limit";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createResource from "./controllers/create-resource";
import deleteResource from "./controllers/delete-resource";
import getInviteDefaults from "./controllers/get-invite-defaults";
import inviteResource from "./controllers/invite-resource";
import listResources from "./controllers/list-resources";
import updateResource from "./controllers/update-resource";
import { describeResources } from "./describe-resources";
import { linkResourceToMember, unlinkResource } from "./link-resource";
import {
  codedErrorResponse,
  resourceInvitationSchema,
  resourceInviteDefaultsSchema,
  resourceLinkSchema,
  resourceListSchema,
  resourceSchema,
} from "./response";
import {
  createResourceBody,
  inviteResourceBody,
  linkResourceBody,
  listResourcesQuery,
  resourceIdParam,
  updateResourceBody,
  workspaceIdParam,
} from "./schema";

// Gated the same as the workspace-level custom-field routes: project:update
// resolved directly against the workspace, since managing a workspace's
// assignable resources is a workspace-admin action, not tied to one project.
const RESOURCE_MANAGE_PERMISSION = { project: ["update"] };

// Linking a resource to a member also decides which account holds its
// assignments, so it needs the right to update members as well. Both are
// evaluated against the WORKSPACE role (there is no project in these requests).
const RESOURCE_LINK_PERMISSION = {
  project: ["update"],
  member: ["update"],
};

const listResourcesRoute = createRoute({
  method: "get",
  operationId: "listResources",
  path: "/workspace/{workspaceId}",
  tags: ["Resources"],
  summary: "List workspace resources",
  description:
    "List a workspace's assignable resources (people, equipment, material). Pass ?kind= to restrict to one kind. A person resource can be linked to a Kaneo account: `userId` is that account and `user` its name, email and image when the caller may see that member; `invitation` is the state of the invitation sent from the resource.",
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
    "Create an assignable resource (a person, equipment, or material) in this workspace. It has no Kaneo account and can't sign in until a person resource is invited or linked to a member; it can be assigned to tasks like a user. Only a person can have an email (400 RESOURCE_EMAIL_NOT_ALLOWED); it is stored in lower case.",
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
    400: codedErrorResponse("Invalid body, or unknown workspace"),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
    404: codedErrorResponse("Workspace not found"),
  },
});

const updateResourceRoute = createRoute({
  method: "patch",
  operationId: "updateResource",
  path: "/{id}",
  tags: ["Resources"],
  summary: "Update a resource",
  description:
    "Update a resource's name or email. Its kind can't be changed after creation, and only a person can have an email (400 RESOURCE_EMAIL_NOT_ALLOWED). Changing or clearing the email detaches an invitation sent from the resource.",
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
    400: codedErrorResponse("Invalid body, or unknown resource"),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
    404: codedErrorResponse("Resource not found"),
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
    404: codedErrorResponse("Resource not found"),
  },
});

const inviteResourceRoute = createRoute({
  method: "post",
  operationId: "inviteResource",
  path: "/{id}/invite",
  tags: ["Resources"],
  summary: "Invite a person resource to the workspace",
  description:
    "Send an invitation to the email address of a person resource, granting a workspace role and the listed projects (one project role each). The resource must be a person with an email and not linked to an account (400 RESOURCE_NOT_PERSON, 400 RESOURCE_HAS_NO_EMAIL, 409 RESOURCE_ALREADY_LINKED). The invitation is the same as a project invitation (accept link, one project row per project) and the resource remembers it. When the person accepts, the resource is linked to their account and its task assignments in the projects they can open move to the account (an assignment they already had on the same task is merged: the higher `units`, `work` kept from either side). Assignments in other projects stay on the resource. Authorization: resource management (project:update in the workspace role) plus, for EACH project, invitation:create in the caller's effective permissions in that project (API key scope too); the workspace role must be within the caller's own workspace role and each project role within the caller's effective permissions in that project; owner is never allowed. Errors carry a `code`: 403 ROLE_EXCEEDS_YOUR_PERMISSIONS, 403 INSUFFICIENT_PERMISSIONS, 400 OWNER_ROLE_NOT_ALLOWED, 400 UNKNOWN_ROLE, 409 ALREADY_WORKSPACE_MEMBER (use link instead), 409 INVITATION_ROLE_CONFLICT, 403 INVITATION_LIMIT_REACHED, and on cloud 403 GUEST_CANNOT_INVITE, 400 DISPOSABLE_EMAIL_NOT_ALLOWED and 429 RATE_LIMITED. When a live pending invitation with the same workspace role exists for the address, the projects are added to it (200, no second email).",
  middleware: [
    workspaceAccess.fromResource("id"),
    requireWorkspacePermission(RESOURCE_MANAGE_PERMISSION),
    requireInvitationRateLimit,
  ] as const,
  request: {
    params: resourceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: inviteResourceBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "An existing pending invitation now also grants these projects",
      resourceInvitationSchema,
    ),
    201: jsonResponse("The new invitation", resourceInvitationSchema),
    400: codedErrorResponse(
      "Invalid body, not a person, no email, owner role, unknown role, or a duplicated project",
    ),
    403: codedErrorResponse(
      "No workspace access, missing project:update, no access to a project, missing invitation:create in a project, or a role beyond the caller's permissions",
    ),
    404: codedErrorResponse("Resource not found"),
    409: codedErrorResponse(
      "Already linked, the address belongs to a workspace member, a pending invitation has another workspace role, or the resource changed meanwhile",
    ),
    429: codedErrorResponse(
      "Too many invitations from this user (cloud only, 5 per minute, shared with project invitations)",
    ),
  },
});

const inviteDefaultsRoute = createRoute({
  method: "get",
  operationId: "getResourceInviteDefaults",
  path: "/{id}/invite-defaults",
  tags: ["Resources"],
  summary: "Projects a resource can be invited to",
  description:
    "The projects the caller can invite to (invitation:create in their effective permissions of that project, and in the API key scope), for the invite dialog. `hasAssignments` marks the projects the resource is assigned in: the ones to pre-select. Projects the caller cannot open, or cannot invite to, and archived projects are not listed.",
  middleware: [
    workspaceAccess.fromResource("id"),
    requireWorkspacePermission(RESOURCE_MANAGE_PERMISSION),
  ] as const,
  request: { params: resourceIdParam },
  responses: {
    200: jsonResponse("Projects to invite to", resourceInviteDefaultsSchema),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
    404: codedErrorResponse("Resource not found"),
  },
});

const linkResourceRoute = createRoute({
  method: "post",
  operationId: "linkResource",
  path: "/{id}/link",
  tags: ["Resources"],
  summary: "Link a person resource to a workspace member",
  description:
    "Link a person resource to somebody who already is a member of the workspace, without an invitation. The resource's task assignments in the projects the member can open move to their account (merged with an assignment they already have on the same task: the higher `units`, `work` kept from either side); assignments in other projects stay on the resource, and the workload counts them in the member's row. Requires resource management (project:update) and member:update in the caller's workspace role. Errors carry a `code`: 400 RESOURCE_NOT_PERSON, 400 NOT_A_WORKSPACE_MEMBER, 409 RESOURCE_ALREADY_LINKED.",
  middleware: [
    workspaceAccess.fromResource("id"),
    requireWorkspacePermission(RESOURCE_LINK_PERMISSION),
  ] as const,
  request: {
    params: resourceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: linkResourceBody } },
    },
  },
  responses: {
    200: jsonResponse("The linked resource", resourceLinkSchema),
    400: codedErrorResponse("Not a person, or the user is not a member"),
    403: errorResponse(
      "No workspace access, or missing project:update or member:update",
    ),
    404: codedErrorResponse("Resource not found"),
    409: codedErrorResponse("The resource is already linked"),
  },
});

const unlinkResourceRoute = createRoute({
  method: "post",
  operationId: "unlinkResource",
  path: "/{id}/unlink",
  tags: ["Resources"],
  summary: "Unlink a resource from its account",
  description:
    "Remove the link between a resource and its account. Assignments that were moved to the account stay with the account (they are ordinary assignments now); the resource has its own workload row again. Requires the same permissions as linking. 409 RESOURCE_NOT_LINKED when it is not linked.",
  middleware: [
    workspaceAccess.fromResource("id"),
    requireWorkspacePermission(RESOURCE_LINK_PERMISSION),
  ] as const,
  request: { params: resourceIdParam },
  responses: {
    200: jsonResponse("The unlinked resource", resourceSchema),
    403: errorResponse(
      "No workspace access, or missing project:update or member:update",
    ),
    404: codedErrorResponse("Resource not found"),
    409: codedErrorResponse("The resource is not linked"),
  },
});

const resource = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listResourcesRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { kind } = c.req.valid("query");
    return c.json(await listResources(workspaceId, c.get("userId"), kind), 200);
  })
  .openapi(createResourceRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { kind, name, email } = c.req.valid("json");
    return c.json(
      await createResource(workspaceId, c.get("userId"), kind, name, email),
      200,
    );
  })
  .openapi(updateResourceRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { name, email } = c.req.valid("json");
    return c.json(await updateResource(id, c.get("userId"), name, email), 200);
  })
  .openapi(deleteResourceRoute, async (c) =>
    c.json(await deleteResource(c.req.valid("param").id, c.get("userId")), 200),
  )
  .openapi(inviteResourceRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { workspaceRole, projects } = c.req.valid("json");
    const invitation = await inviteResource({
      c,
      resourceId: id,
      workspaceId: c.get("workspaceId"),
      actorUserId: c.get("userId"),
      workspaceRole,
      projects,
    });
    return invitation.created
      ? c.json(invitation, 201)
      : c.json(invitation, 200);
  })
  .openapi(inviteDefaultsRoute, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(
      await getInviteDefaults({
        c,
        resourceId: id,
        workspaceId: c.get("workspaceId"),
        actorUserId: c.get("userId"),
      }),
      200,
    );
  })
  .openapi(linkResourceRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { userId } = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const { resource, movedTaskCount, movedProjectIds } =
      await linkResourceToMember({
        resourceId: id,
        workspaceId,
        userId,
        actorUserId: c.get("userId"),
      });
    const [described] = await describeResources([resource], {
      userId: c.get("userId"),
      workspaceId,
    });
    if (!described) throw new Error("Failed to describe the linked resource");
    return c.json(
      { resource: described, movedTaskCount, movedProjectIds },
      200,
    );
  })
  .openapi(unlinkResourceRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const unlinked = await unlinkResource({ resourceId: id, workspaceId });
    const [described] = await describeResources([unlinked], {
      userId: c.get("userId"),
      workspaceId,
    });
    if (!described) throw new Error("Failed to describe the resource");
    return c.json(described, 200);
  });

export default resource;
