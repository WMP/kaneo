import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { isInstanceAdmin } from "./is-instance-admin";
import {
  type PermissionMap,
  resolveRoleStatements,
  satisfies,
} from "./role-statements";

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

  return Boolean(statements && satisfies(statements, permissions));
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
