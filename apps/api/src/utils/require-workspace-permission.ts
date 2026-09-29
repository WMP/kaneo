import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { isInstanceAdmin } from "./is-instance-admin";
import {
  type ProjectAccess,
  projectAccessSatisfies,
  workspaceMemberStanding,
} from "./project-access";
import { type PermissionMap, satisfies } from "./role-statements";

// Does the API key behind this request (if any) allow `required`? A request
// without a scoped key is not restricted here. Every scope check goes through
// this helper.
export function apiKeyAllows(c: Context, required: PermissionMap): boolean {
  const apiKey = c.get("apiKey") as
    | { permissions?: Record<string, string[]> | null }
    | undefined;
  return !apiKey?.permissions || satisfies(apiKey.permissions, required);
}

function projectAccessesOf(c: Context): ProjectAccess[] | null {
  const many = c.get("projectAccesses") as ProjectAccess[] | undefined;
  if (many && many.length > 0) return many;
  const one = c.get("projectAccess") as ProjectAccess | undefined;
  return one ? [one] : null;
}

// Resources that describe the workspace itself (settings, members, invitations,
// roles, teams). A project role never carries them: they are always evaluated
// against the caller's WORKSPACE role, even inside a project-scoped request.
// Everything else (`project`, `task`, `label`, ...) belongs to the project.
const WORKSPACE_LEVEL_RESOURCES = new Set([
  "workspace",
  "member",
  "invitation",
  "organization",
  "ac",
  "team",
]);

function splitPermissions(permissions: PermissionMap) {
  const workspaceLevel: PermissionMap = {};
  const projectLevel: PermissionMap = {};
  for (const [resource, actions] of Object.entries(permissions)) {
    (WORKSPACE_LEVEL_RESOURCES.has(resource) ? workspaceLevel : projectLevel)[
      resource
    ] = actions;
  }
  return { workspaceLevel, projectLevel };
}

// Checks a permission for the current request.
//
// - Workspace-level resources (`workspace`, `member`, `invitation`,
//   `organization`, `ac`, `team`) are always checked against the caller's
//   workspace role.
// - Other resources: when the request resolved a project (`workspaceAccess` set
//   `projectAccess`), the statements of the user's effective role IN THAT
//   PROJECT apply: the project role for a project member, the workspace role
//   for a full-access user. A bulk request that touches several projects must
//   hold the permission in every one of them.
// - Without a resolved project the workspace role applies to everything
//   (settings, roles, invitations, creating projects, workspace-wide lists).
// - With `workspaceIdOverride` the request acts on ANOTHER workspace than the
//   one it was authorized against, so the workspace role of that workspace
//   applies, never the statements of the source project.
// - API-key scope is intersected first in every case.
export async function hasWorkspacePermission(
  c: Context,
  permissions: PermissionMap,
  // Checks a workspace other than the one the request authorized against.
  // Needed when a single request touches two workspaces (e.g. moving a
  // project), since the access middleware only resolves one.
  workspaceIdOverride?: string,
) {
  const workspaceId = workspaceIdOverride ?? c.get("workspaceId");
  if (!workspaceId) return false;

  if (!apiKeyAllows(c, permissions)) return false;

  if (await isInstanceAdmin(c)) {
    return true;
  }

  const userId = c.get("userId");
  if (!userId) return false;

  const projectAccesses = workspaceIdOverride ? null : projectAccessesOf(c);
  const { workspaceLevel, projectLevel } = projectAccesses
    ? splitPermissions(permissions)
    : { workspaceLevel: permissions, projectLevel: {} as PermissionMap };

  if (
    Object.keys(projectLevel).length > 0 &&
    !projectAccesses?.every((access) =>
      projectAccessSatisfies(access, projectLevel),
    )
  ) {
    return false;
  }
  if (Object.keys(workspaceLevel).length === 0) return true;

  // A full-access caller already holds their workspace role's statements in
  // the resolved access (and owners, composite owner names included, are
  // unrestricted): no second lookup. Only a project member needs their
  // workspace role looked up.
  const first = projectAccesses?.[0];
  if (
    first &&
    projectAccesses?.every(
      (access) => access.mode === "full" && access.workspaceId === workspaceId,
    )
  ) {
    return projectAccessSatisfies(first, workspaceLevel);
  }

  const standing = await workspaceMemberStanding(userId, workspaceId);
  if (!standing) return false;
  if (standing.owner) return true;
  return Boolean(
    standing.statements && satisfies(standing.statements, workspaceLevel),
  );
}

export function requireWorkspacePermission(permissions: PermissionMap) {
  return async (c: Context, next: Next) => {
    if (!c.get("workspaceId")) {
      throw new HTTPException(500, {
        message: "workspaceId not set in context",
      });
    }

    if (!apiKeyAllows(c, permissions)) {
      throw new HTTPException(403, { message: "Insufficient API key scope" });
    }

    if (!(await hasWorkspacePermission(c, permissions))) {
      if (!c.get("userId")) {
        throw new HTTPException(401, { message: "Unauthorized" });
      }
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }

    return next();
  };
}
