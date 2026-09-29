import type { Context, Next } from "hono";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  assertProjectMemberPermission,
  requireProjectAccess,
} from "../project-member/delegation";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import cancelProjectInvitation from "./controllers/cancel-project-invitation";
import createProjectInvitation from "./controllers/create-project-invitation";
import listMemberCandidates from "./controllers/list-member-candidates";
import listProjectInvitations from "./controllers/list-project-invitations";
import resendProjectInvitation from "./controllers/resend-project-invitation";
import {
  assertInvitationPermission,
  assertMayListInvitations,
} from "./delegation";
import {
  codedErrorResponse,
  memberCandidateListSchema,
  projectInvitationCancelSchema,
  projectInvitationListSchema,
  projectInvitationResendSchema,
  projectInvitationSchema,
} from "./response";
import {
  createProjectInvitationBody,
  projectIdParam,
  projectInvitationParam,
} from "./schema";

// Invitation rights are decided by the caller's PROJECT role: `invitation` is
// a workspace-level resource for requireWorkspacePermission, so these checks
// (and the API key scope) run against the effective project statements here.
function requireInvitationPermission(action: "create" | "cancel") {
  return async (c: Context, next: Next) => {
    assertInvitationPermission(
      c,
      requireProjectAccess(c.get("projectAccess")),
      action,
    );
    return next();
  };
}

async function requireMayListInvitations(c: Context, next: Next) {
  assertMayListInvitations(c, requireProjectAccess(c.get("projectAccess")));
  return next();
}

async function requireMemberCreate(c: Context, next: Next) {
  assertProjectMemberPermission(
    c,
    requireProjectAccess(c.get("projectAccess")),
    "create",
  );
  return next();
}

const createProjectInvitationRoute = createRoute({
  method: "post",
  operationId: "createProjectInvitation",
  path: "/{projectId}/invitations",
  tags: ["Project invitations"],
  summary: "Invite a person to a project",
  description:
    "Invite somebody who is not in the workspace yet to this project, with a workspace role and a project role. The invitee accepts through the usual invitation link (`/invitation/accept/{id}`, Better Auth accept-invitation, email must match); acceptance creates the project membership. Requires invitation:create in the caller's effective project permissions (the project role for a project member, the workspace role for a full-access user; an API key must allow it too). The workspace role must be within the caller's own workspace role, the project role within the caller's effective permissions in this project, and owner is never allowed as either (owners and instance administrators are otherwise unrestricted). Errors carry a `code`: 403 ROLE_EXCEEDS_YOUR_PERMISSIONS, 400 OWNER_ROLE_NOT_ALLOWED, 400 UNKNOWN_ROLE, 409 ALREADY_WORKSPACE_MEMBER (add the person to the project instead), 409 INVITATION_ROLE_CONFLICT (a live pending invitation for this email has another workspace role), 403 INVITATION_LIMIT_REACHED, and on cloud 403 GUEST_CANNOT_INVITE and 400 DISPOSABLE_EMAIL_NOT_ALLOWED. When a live pending invitation with the same workspace role exists, this project is added to it (200, no second email) instead of creating another invitation (201).",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireInvitationPermission("create"),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: createProjectInvitationBody },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "An existing pending invitation now also grants this project",
      projectInvitationSchema,
    ),
    201: jsonResponse("The new invitation", projectInvitationSchema),
    400: codedErrorResponse("Invalid body, owner role, or unknown role"),
    403: codedErrorResponse(
      "No access to the project, missing invitation:create, a role beyond the caller's permissions, or the invitation limit",
    ),
    409: codedErrorResponse(
      "The person is already a workspace member, or a pending invitation has a different workspace role",
    ),
  },
});

const listProjectInvitationsRoute = createRoute({
  method: "get",
  operationId: "listProjectInvitations",
  path: "/{projectId}/invitations",
  tags: ["Project invitations"],
  summary: "List pending project invitations",
  description:
    "Pending invitations that grant this project, live and expired. Requires invitation:create or invitation:cancel in the caller's effective project permissions.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireMayListInvitations,
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Pending invitations", projectInvitationListSchema),
    403: codedErrorResponse(
      "No access to the project, or neither invitation:create nor invitation:cancel",
    ),
  },
});

const cancelProjectInvitationRoute = createRoute({
  method: "delete",
  operationId: "cancelProjectInvitation",
  path: "/{projectId}/invitations/{invitationId}",
  tags: ["Project invitations"],
  summary: "Cancel a project invitation",
  description:
    "Remove this project from a pending invitation. Requires invitation:cancel in the caller's effective project permissions, and both roles of the invitation (workspace role and project role) within the caller's own permissions unless the caller is an owner or instance administrator. When no project is left on the invitation it is canceled as a whole (status canceled, the link stops working); the invitation table does not record how it was created, so a plain workspace invitation to which this project was added is canceled too. Errors carry a `code`: 403 ROLE_EXCEEDS_YOUR_PERMISSIONS, 404 INVITATION_NOT_FOUND.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireInvitationPermission("cancel"),
  ] as const,
  request: { params: projectInvitationParam },
  responses: {
    200: jsonResponse(
      "The invitation was updated",
      projectInvitationCancelSchema,
    ),
    403: codedErrorResponse(
      "No access to the project, missing invitation:cancel, or a role beyond the caller's permissions",
    ),
    404: codedErrorResponse("No pending invitation of this project"),
  },
});

const resendProjectInvitationRoute = createRoute({
  method: "post",
  operationId: "resendProjectInvitation",
  path: "/{projectId}/invitations/{invitationId}/resend",
  tags: ["Project invitations"],
  summary: "Resend a project invitation",
  description:
    "Extend a live pending invitation by the default lifetime (48 hours) and send the email again. Requires invitation:create and both roles of the invitation within the caller's own permissions. An expired invitation cannot be re-sent (409 INVITATION_EXPIRED): invite the person again. `emailAttempted` is false when SMTP is not configured.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireInvitationPermission("create"),
  ] as const,
  request: { params: projectInvitationParam },
  responses: {
    200: jsonResponse("The extended invitation", projectInvitationResendSchema),
    403: codedErrorResponse(
      "No access to the project, missing invitation:create, or a role beyond the caller's permissions",
    ),
    404: codedErrorResponse("No pending invitation of this project"),
    409: codedErrorResponse("The invitation has expired"),
  },
});

const listMemberCandidatesRoute = createRoute({
  method: "get",
  operationId: "listProjectMemberCandidates",
  path: "/{projectId}/member-candidates",
  tags: ["Project invitations"],
  summary: "List workspace members who can be added to the project",
  description:
    "Workspace members who are not project members yet and do not have full access, for the add-to-project picker. Requires member:create in the caller's effective project permissions, like adding a member.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireMemberCreate,
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Candidates", memberCandidateListSchema),
    403: errorResponse("No access to the project, or missing member:create"),
  },
});

const projectInvitation = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(createProjectInvitationRoute, async (c) => {
    const access = requireProjectAccess(c.get("projectAccess"));
    const { email, workspaceRole, projectRole } = c.req.valid("json");
    const { created, invitation } = await createProjectInvitation({
      access,
      actorUserId: c.get("userId"),
      email,
      workspaceRole,
      projectRole,
    });
    return created ? c.json(invitation, 201) : c.json(invitation, 200);
  })
  .openapi(listProjectInvitationsRoute, async (c) => {
    const access = requireProjectAccess(c.get("projectAccess"));
    return c.json(await listProjectInvitations(access), 200);
  })
  .openapi(cancelProjectInvitationRoute, async (c) => {
    const access = requireProjectAccess(c.get("projectAccess"));
    const { invitationId } = c.req.valid("param");
    return c.json(
      await cancelProjectInvitation({
        access,
        actorUserId: c.get("userId"),
        invitationId,
      }),
      200,
    );
  })
  .openapi(resendProjectInvitationRoute, async (c) => {
    const access = requireProjectAccess(c.get("projectAccess"));
    const { invitationId } = c.req.valid("param");
    return c.json(
      await resendProjectInvitation({
        access,
        actorUserId: c.get("userId"),
        invitationId,
      }),
      200,
    );
  })
  .openapi(listMemberCandidatesRoute, async (c) => {
    const access = requireProjectAccess(c.get("projectAccess"));
    return c.json(await listMemberCandidates(access), 200);
  });

export default projectInvitation;
