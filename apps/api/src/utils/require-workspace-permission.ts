import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { isInstanceAdmin } from "./is-instance-admin";
import { type ProjectAccess, projectAccessSatisfies } from "./project-access";
import {
  type PermissionMap,
  resolveRoleStatements,
  satisfies,
} from "./role-statements";

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

  const apiKey = c.get("apiKey") as
    | { permissions?: Record<string, string[]> | null }
    | undefined;
  if (apiKey?.permissions && !satisfies(apiKey.permissions, permissions)) {
    return false;
  }

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

  const [member] = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);

  if (!member?.role) return false;

  const statements = await resolveRoleStatements(workspaceId, member.role);

  return Boolean(statements && satisfies(statements, workspaceLevel));
}

export function requireWorkspacePermission(permissions: PermissionMap) {
  return async (c: Context, next: Next) => {
    if (!c.get("workspaceId")) {
      throw new HTTPException(500, {
        message: "workspaceId not set in context",
      });
    }

    const apiKey = c.get("apiKey") as
      | { permissions?: Record<string, string[]> | null }
      | undefined;
    if (apiKey?.permissions && !satisfies(apiKey.permissions, permissions)) {
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
