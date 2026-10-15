import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiError } from "../errors/api-error";
import { isInstanceAdmin } from "./is-instance-admin";
import { missingPermissions } from "./missing-permissions";
import {
  type ProjectAccess,
  projectAccessSatisfies,
  workspaceMemberStanding,
} from "./project-access";
import { type PermissionMap, satisfies } from "./role-statements";

function apiKeyScope(c: Context) {
  const apiKey = c.get("apiKey") as
    | { permissions?: Record<string, string[]> | null }
    | undefined;
  return apiKey?.permissions ?? null;
}

// Does the API key behind this request (if any) allow `required`? A request
// without a scoped key is not restricted here. Every scope check goes through
// this helper.
export function apiKeyAllows(c: Context, required: PermissionMap): boolean {
  const scope = apiKeyScope(c);
  return !scope || satisfies(scope, required);
}

function assertApiKeyScope(c: Context, permissions: PermissionMap) {
  const scope = apiKeyScope(c);
  if (scope && !satisfies(scope, permissions)) {
    throw new ApiError(403, {
      message: "Insufficient API key scope",
      code: "API_KEY_SCOPE",
      missingPermissions: missingPermissions(scope, permissions),
    });
  }
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

type Decision = { allowed: true } | { allowed: false; missing: string[] };

const DENIED = (missing: string[]): Decision => ({ allowed: false, missing });

// The decision behind `hasWorkspacePermission` and `requireWorkspacePermission`
// (see the former for the rules), with the permissions the caller lacks for the
// error body.
async function decide(
  c: Context,
  permissions: PermissionMap,
  workspaceIdOverride?: string,
): Promise<Decision> {
  const workspaceId = workspaceIdOverride ?? c.get("workspaceId");
  if (!workspaceId) return DENIED(missingPermissions(null, permissions));

  if (!apiKeyAllows(c, permissions)) {
    return DENIED(missingPermissions(apiKeyScope(c), permissions));
  }

  if (await isInstanceAdmin(c)) {
    return { allowed: true };
  }

  const userId = c.get("userId");
  if (!userId) return DENIED(missingPermissions(null, permissions));

  const projectAccesses = workspaceIdOverride ? null : projectAccessesOf(c);
  const { workspaceLevel, projectLevel } = projectAccesses
    ? splitPermissions(permissions)
    : { workspaceLevel: permissions, projectLevel: {} as PermissionMap };

  if (Object.keys(projectLevel).length > 0) {
    const missing = new Set<string>();
    for (const access of projectAccesses ?? []) {
      if (!projectAccessSatisfies(access, projectLevel)) {
        for (const entry of missingPermissions(
          access.statements,
          projectLevel,
        )) {
          missing.add(entry);
        }
      }
    }
    if (!projectAccesses || missing.size > 0) {
      return DENIED(
        missing.size > 0
          ? [...missing]
          : missingPermissions(null, projectLevel),
      );
    }
  }
  if (Object.keys(workspaceLevel).length === 0) return { allowed: true };

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
    return projectAccessSatisfies(first, workspaceLevel)
      ? { allowed: true }
      : DENIED(missingPermissions(first.statements, workspaceLevel));
  }

  const standing = await workspaceMemberStanding(userId, workspaceId);
  if (!standing) return DENIED(missingPermissions(null, workspaceLevel));
  if (standing.owner) return { allowed: true };
  return standing.statements && satisfies(standing.statements, workspaceLevel)
    ? { allowed: true }
    : DENIED(missingPermissions(standing.statements, workspaceLevel));
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
  return (await decide(c, permissions, workspaceIdOverride)).allowed;
}

// Same rules as `hasWorkspacePermission` for the WORKSPACE role (no project
// context), but resolves the caller's standing once so many checks (the UI's
// capability map) cost a single lookup.
export async function workspacePermissionChecker(
  c: Context,
): Promise<(permissions: PermissionMap) => boolean> {
  const workspaceId = c.get("workspaceId");
  if (!workspaceId) return () => false;

  const isAdmin = await isInstanceAdmin(c);
  const userId = c.get("userId");
  const standing =
    isAdmin || !userId
      ? null
      : await workspaceMemberStanding(userId, workspaceId);

  return (permissions) => {
    if (!apiKeyAllows(c, permissions)) return false;
    if (isAdmin) return true;
    if (!standing) return false;
    if (standing.owner) return true;
    return Boolean(
      standing.statements && satisfies(standing.statements, permissions),
    );
  };
}

// Only the API key scope; for routes that need no workspace role (for example
// reading the caller's own workspaces).
export function requireApiKeyScope(permissions: PermissionMap) {
  return async (c: Context, next: Next) => {
    assertApiKeyScope(c, permissions);
    return next();
  };
}

export function requireWorkspacePermission(permissions: PermissionMap) {
  return async (c: Context, next: Next) => {
    if (!c.get("workspaceId")) {
      throw new HTTPException(500, {
        message: "workspaceId not set in context",
      });
    }

    assertApiKeyScope(c, permissions);

    const decision = await decide(c, permissions);
    if (!decision.allowed) {
      if (!c.get("userId")) {
        throw new HTTPException(401, { message: "Unauthorized" });
      }
      throw new ApiError(403, {
        message: "Insufficient permissions",
        code: "MISSING_PERMISSION",
        missingPermissions: decision.missing,
      });
    }

    return next();
  };
}
