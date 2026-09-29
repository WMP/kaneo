import { type BuiltInRoleName, builtInRoles } from "@kaneo/permissions";
import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";

export type PermissionMap = Record<string, string[]>;
export type RoleStatements = Record<string, readonly string[]>;

export function builtInRoleStatements(role: string): RoleStatements | null {
  if (role in builtInRoles) {
    return builtInRoles[role as BuiltInRoleName].statements as RoleStatements;
  }
  return null;
}

export function parsePermissionStatements(raw: string): RoleStatements | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  // Only keep entries shaped like { [resource: string]: string[] }.
  // Anything malformed is dropped so `satisfies()` never calls
  // `.includes()` on a non-array.
  const result: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!Array.isArray(actions)) continue;
    const filtered = actions.filter(
      (action): action is string => typeof action === "string",
    );
    if (filtered.length > 0) {
      result[resource] = filtered;
    }
  }
  return result;
}

async function customRoleStatements(
  workspaceId: string,
  role: string,
): Promise<RoleStatements | null> {
  const [row] = await db
    .select({ permission: schema.workspaceRoleTable.permission })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    )
    .limit(1);

  if (!row?.permission) return null;

  return parsePermissionStatements(row.permission);
}

export function satisfies(
  statements: RoleStatements,
  required: PermissionMap,
): boolean {
  for (const [resource, actions] of Object.entries(required)) {
    const granted = statements[resource];
    if (!granted) return false;
    for (const action of actions) {
      if (!granted.includes(action)) return false;
    }
  }
  return true;
}

// Prefer the DB row when present so admin-edited defaults
// (viewer/member/admin) take effect immediately. Falls back to the
// compiled-in static definitions only when no row exists, which protects
// viewer/member/admin users from a 403 if their workspace somehow
// missed the seed (e.g., seed failed during workspace creation and
// the boot-time backfill hasn't run yet).
export async function resolveRoleStatements(
  workspaceId: string,
  role: string,
): Promise<RoleStatements | null> {
  return (
    (await customRoleStatements(workspaceId, role)) ??
    builtInRoleStatements(role)
  );
}

// True when every action `target` grants is also granted by `granted`.
// Resources with no actions grant nothing and are ignored.
export function isStatementSubset(
  target: RoleStatements,
  granted: RoleStatements,
): boolean {
  for (const [resource, actions] of Object.entries(target)) {
    if (actions.length === 0) continue;
    const allowed = granted[resource];
    if (!allowed) return false;
    for (const action of actions) {
      if (!allowed.includes(action)) return false;
    }
  }
  return true;
}
