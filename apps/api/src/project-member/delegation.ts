import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  isFullAccess,
  isOwnerRole,
  type ProjectAccess,
  projectAccessSatisfies,
  projectRoleStatements,
} from "../utils/project-access";
import { apiKeyAllows } from "../utils/require-workspace-permission";
import { rolesWithin, splitRoles } from "../utils/role-delegation";
import {
  type PermissionMap,
  resolveRoleStatements,
  type SelectExecutor,
} from "../utils/role-statements";

// Stable error messages of the project member API. They are part of the API
// contract (documented in the route descriptions) and asserted by tests.
export const PROJECT_MEMBER_ERRORS = {
  ownerRole: "The owner role cannot be a project role",
  unknownRole: "Unknown role",
  roleExceeds: "You cannot assign a role with permissions you do not have",
  memberExceeds: "You cannot manage a member with permissions you do not have",
  ownRole: "You cannot change your own project role",
  notWorkspaceMember: "User is not a member of this workspace",
  alreadyMember: "User is already a member of this project",
  alreadyFullAccess: "User already has full access to this project",
  fullAccessTarget:
    "Members with full access cannot be changed or removed at project level",
  notProjectMember: "User is not a member of this project",
  insufficient: "Insufficient permissions",
  apiKeyScope: "Insufficient API key scope",
  changed: "The project membership changed, please retry",
} as const;

// The caller's effective access, set by `workspaceAccess.fromProject`.
export function requireProjectAccess(
  access: ProjectAccess | undefined,
): ProjectAccess {
  if (!access) {
    throw new HTTPException(500, {
      message: "projectAccess not set in context",
    });
  }
  return access;
}

// `role` must be a catalog role of the project's workspace, never `owner`, and
// (unless the caller is unrestricted) within the caller's effective statements
// in this project.
export async function assertAssignableProjectRole(
  access: ProjectAccess,
  role: string,
): Promise<void> {
  if (isOwnerRole(role)) {
    throw new HTTPException(400, { message: PROJECT_MEMBER_ERRORS.ownerRole });
  }
  // A composite name such as "a,b" resolves as one unknown role.
  if (!(await projectRoleStatements(access.workspaceId, role))) {
    throw new HTTPException(400, {
      message: PROJECT_MEMBER_ERRORS.unknownRole,
    });
  }
  if (access.unrestricted) return;
  if (
    !access.statements ||
    !(await rolesWithin(access.workspaceId, [role], access.statements))
  ) {
    throw new HTTPException(403, {
      message: PROJECT_MEMBER_ERRORS.roleExceeds,
    });
  }
}

// The caller may only manage a member whose current role is within their own
// statements.
export async function assertCanManageRole(
  access: ProjectAccess,
  currentRole: string,
  executor?: SelectExecutor,
): Promise<void> {
  if (access.unrestricted) return;
  if (
    !access.statements ||
    !(await rolesWithin(
      access.workspaceId,
      splitRoles(currentRole),
      access.statements,
      executor,
    ))
  ) {
    throw new HTTPException(403, {
      message: PROJECT_MEMBER_ERRORS.memberExceeds,
    });
  }
}

export async function assertNotFullAccess(
  access: ProjectAccess,
  userId: string,
): Promise<void> {
  if (await isFullAccess(userId, access.workspaceId)) {
    throw new HTTPException(400, {
      message: PROJECT_MEMBER_ERRORS.fullAccessTarget,
    });
  }
}

export type ProjectStatementsDecision =
  | "allowed"
  | "apiKeyScope"
  | "insufficient";

// The ONE decision behind every check of a workspace-level resource that a
// project route evaluates on the caller's effective PROJECT statements
// (`member:*`, `invitation:*`): the API key scope first, then the statements.
// The asserts below and `GET /api/project/{id}/access` both use it.
export function projectStatementsDecision(
  c: Context,
  access: ProjectAccess,
  required: PermissionMap,
): ProjectStatementsDecision {
  if (!apiKeyAllows(c, required)) return "apiKeyScope";
  return projectAccessSatisfies(access, required) ? "allowed" : "insufficient";
}

export function mayUseProjectStatements(
  c: Context,
  access: ProjectAccess,
  required: PermissionMap,
): boolean {
  return projectStatementsDecision(c, access, required) === "allowed";
}

// Member management is decided by the caller's PROJECT role, not by their
// workspace role (the `member` resource is workspace-level for
// `hasWorkspacePermission`). An API key's scope still has to allow the action.
export function assertProjectMemberPermission(
  c: Context,
  access: ProjectAccess,
  action: "create" | "update" | "delete",
): void {
  const decision = projectStatementsDecision(c, access, { member: [action] });
  if (decision === "apiKeyScope") {
    throw new HTTPException(403, {
      message: PROJECT_MEMBER_ERRORS.apiKeyScope,
    });
  }
  if (decision === "insufficient") {
    throw new HTTPException(403, {
      message: PROJECT_MEMBER_ERRORS.insufficient,
    });
  }
}

// A membership whose role grants nothing (deleted role, or moved from another
// workspace) is inert. Whoever may manage members can still remove or replace
// it, whatever the role once contained.
export async function isInertRole(
  access: ProjectAccess,
  role: string,
  executor?: SelectExecutor,
): Promise<boolean> {
  return (
    (await projectRoleStatements(
      access.workspaceId,
      role,
      executor
        ? (workspaceId, name) =>
            resolveRoleStatements(workspaceId, name, executor)
        : undefined,
    )) === null
  );
}
