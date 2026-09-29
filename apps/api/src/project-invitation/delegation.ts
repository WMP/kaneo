import { isAPIError } from "better-auth/api";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  assertAssignableProjectRole,
  assertCanManageRole,
  PROJECT_MEMBER_ERRORS,
} from "../project-member/delegation";
import {
  isOwnerRole,
  type ProjectAccess,
  projectAccessSatisfies,
  workspaceMemberStanding,
} from "../utils/project-access";
import { apiKeyAllows } from "../utils/require-workspace-permission";
import { assertCanAssignRole, splitRoles } from "../utils/role-delegation";
import { resolveRoleStatements, satisfies } from "../utils/role-statements";

// Errors of the project invitation API: JSON `{ code, message }` so the web
// client can branch on `code` (for example to offer "add to project" instead
// of inviting somebody who already is a workspace member).
export const INVITATION_ERROR_CODES = {
  insufficient: "INSUFFICIENT_PERMISSIONS",
  apiKeyScope: "INSUFFICIENT_API_KEY_SCOPE",
  roleExceeds: "ROLE_EXCEEDS_YOUR_PERMISSIONS",
  ownerRole: "OWNER_ROLE_NOT_ALLOWED",
  unknownRole: "UNKNOWN_ROLE",
  alreadyMember: "ALREADY_WORKSPACE_MEMBER",
  roleConflict: "INVITATION_ROLE_CONFLICT",
  workspaceInvitationExists: "WORKSPACE_INVITATION_EXISTS",
  limitReached: "INVITATION_LIMIT_REACHED",
  guest: "GUEST_CANNOT_INVITE",
  disposableEmail: "DISPOSABLE_EMAIL_NOT_ALLOWED",
  notFound: "INVITATION_NOT_FOUND",
  expired: "INVITATION_EXPIRED",
} as const;

export function invitationError(
  status: ContentfulStatusCode,
  code: string,
  message: string,
): HTTPException {
  return new HTTPException(status, {
    message,
    res: Response.json({ code, message }, { status }),
  });
}

// The caller's effective PROJECT statements decide whether they may manage
// invitations (the `invitation` resource is workspace-level for
// `requireWorkspacePermission`, so this checks the project statements and the
// API key scope itself, like the project member API does for `member`).
export function assertInvitationPermission(
  c: Context,
  access: ProjectAccess,
  action: "create" | "cancel",
): void {
  const required = { invitation: [action] };
  if (!apiKeyAllows(c, required)) {
    throw invitationError(
      403,
      INVITATION_ERROR_CODES.apiKeyScope,
      PROJECT_MEMBER_ERRORS.apiKeyScope,
    );
  }
  if (!projectAccessSatisfies(access, required)) {
    throw invitationError(
      403,
      INVITATION_ERROR_CODES.insufficient,
      PROJECT_MEMBER_ERRORS.insufficient,
    );
  }
}

// Listing shows who was invited: either right is enough, and the API key must
// allow the same action the project role grants.
export function assertMayListInvitations(
  c: Context,
  access: ProjectAccess,
): void {
  for (const action of ["create", "cancel"] as const) {
    const required = { invitation: [action] };
    if (apiKeyAllows(c, required) && projectAccessSatisfies(access, required)) {
      return;
    }
  }
  throw invitationError(
    403,
    INVITATION_ERROR_CODES.insufficient,
    PROJECT_MEMBER_ERRORS.insufficient,
  );
}

function roleExceeds(message: string): HTTPException {
  return invitationError(403, INVITATION_ERROR_CODES.roleExceeds, message);
}

// `assertCanAssignRole` speaks Better Auth's `APIError`, which a Hono route
// would turn into a 500: translate it.
async function assertWorkspaceRoleWithinCaller(
  access: ProjectAccess,
  actorUserId: string,
  workspaceRole: string,
): Promise<void> {
  try {
    await assertCanAssignRole({
      workspaceId: access.workspaceId,
      actorUserId,
      targetRole: workspaceRole,
    });
  } catch (error) {
    if (isAPIError(error)) {
      const code =
        (error.body as { code?: string } | undefined)?.code ??
        INVITATION_ERROR_CODES.roleExceeds;
      throw invitationError(
        403,
        code,
        (error.body as { message?: string } | undefined)?.message ??
          "You cannot assign a role with permissions you do not have.",
      );
    }
    throw error;
  }
}

// The workspace role of a NEW invitation: a single catalog role, never `owner`
// (a project invitation grants project access; a workspace owner is invited
// through Better Auth's own invitation), and within the caller's own
// workspace-role permissions.
export async function assertInvitableWorkspaceRole(
  access: ProjectAccess,
  actorUserId: string,
  workspaceRole: string,
): Promise<void> {
  if (isOwnerRole(workspaceRole)) {
    throw invitationError(
      400,
      INVITATION_ERROR_CODES.ownerRole,
      "The owner role cannot be granted through a project invitation",
    );
  }
  // A composite name such as "a,b" resolves as one unknown role.
  if (
    splitRoles(workspaceRole).length !== 1 ||
    !(await resolveRoleStatements(access.workspaceId, workspaceRole))
  ) {
    throw invitationError(
      400,
      INVITATION_ERROR_CODES.unknownRole,
      "Unknown workspace role",
    );
  }
  await assertWorkspaceRoleWithinCaller(access, actorUserId, workspaceRole);
}

// The project role of an invitation: the member API's rule (catalog role, not
// owner, within the caller's effective statements in THIS project), answered
// with a `code`.
export async function assertInvitableProjectRole(
  access: ProjectAccess,
  projectRole: string,
): Promise<void> {
  try {
    await assertAssignableProjectRole(access, projectRole);
  } catch (error) {
    if (error instanceof HTTPException) {
      if (error.message === PROJECT_MEMBER_ERRORS.roleExceeds) {
        throw roleExceeds(`${error.message}.`);
      }
      if (error.message === PROJECT_MEMBER_ERRORS.ownerRole) {
        throw invitationError(
          400,
          INVITATION_ERROR_CODES.ownerRole,
          error.message,
        );
      }
      if (error.message === PROJECT_MEMBER_ERRORS.unknownRole) {
        throw invitationError(
          400,
          INVITATION_ERROR_CODES.unknownRole,
          "Unknown project role",
        );
      }
    }
    throw error;
  }
}

// Cancelling or re-sending touches an EXISTING invitation: both of its roles
// must be within the caller's own permissions (owners and instance
// administrators are unrestricted).
export async function assertCanManageInvitation(
  access: ProjectAccess,
  actorUserId: string,
  invitation: { workspaceRole: string; projectRole: string },
): Promise<void> {
  if (access.unrestricted) return;
  await assertWorkspaceRoleWithinCaller(
    access,
    actorUserId,
    invitation.workspaceRole,
  );
  await assertCanManageProjectRole(access, invitation.projectRole);
}

// A project role that is already stored (an invitation row, or the role an
// upsert would replace) must be within the caller's statements too.
export async function assertCanManageProjectRole(
  access: ProjectAccess,
  projectRole: string,
): Promise<void> {
  try {
    await assertCanManageRole(access, projectRole);
  } catch (error) {
    if (
      error instanceof HTTPException &&
      error.message === PROJECT_MEMBER_ERRORS.memberExceeds
    ) {
      throw roleExceeds(
        "You cannot manage an invitation with permissions you do not have.",
      );
    }
    throw error;
  }
}

// Does the caller hold `invitation:create` in their WORKSPACE role (owners and
// instance administrators always do)? The project routes decide by the project
// role, but an invitation that is not a project invitation belongs to the
// workspace: only somebody who could have made it may attach a project to it.
export async function hasWorkspaceInvitationCreate(
  access: ProjectAccess,
  actorUserId: string,
): Promise<boolean> {
  if (access.unrestricted) return true;
  const standing = await workspaceMemberStanding(
    actorUserId,
    access.workspaceId,
  );
  if (!standing) return false;
  if (standing.owner) return true;
  return Boolean(
    standing.statements &&
      satisfies(standing.statements, { invitation: ["create"] }),
  );
}
