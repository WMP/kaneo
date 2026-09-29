import { DEFAULT_ROLE_NAMES } from "@kaneo/permissions";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";
import {
  builtInRoleStatements,
  isStatementSubset,
  parsePermissionStatements,
  type RoleStatements,
  resolveRoleStatements,
} from "./role-statements";

// A non-owner may only hand out roles whose permissions are a subset of their
// own. Better Auth checks `invitation:create` / `member:update` but not what
// the role being granted contains, so a delegated inviter could otherwise mint
// an admin. Enforced from `auth.ts` (organization hook + `hooks.before`).

type AssignableRole = { role: string; isDefault: boolean };

const OWNER_ROLE = "owner";

function splitRoles(role: string): string[] {
  return role
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

async function isInstanceAdminUser(userId: string): Promise<boolean> {
  // Read the current role instead of a session snapshot, which can predate
  // an administrator's change.
  const [row] = await db
    .select({ role: schema.userTable.role })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  return row?.role === "admin";
}

async function findMembershipRole(
  workspaceId: string,
  userId: string,
): Promise<string | null> {
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
  return member?.role ?? null;
}

type Actor =
  | { unrestricted: true }
  | { unrestricted: false; statements: RoleStatements | null };

async function resolveActor(
  workspaceId: string,
  actorUserId: string,
): Promise<Actor> {
  if (await isInstanceAdminUser(actorUserId)) {
    return { unrestricted: true };
  }

  const role = await findMembershipRole(workspaceId, actorUserId);
  if (!role) {
    throw new APIError("FORBIDDEN", {
      code: "YOU_ARE_NOT_A_MEMBER_OF_THIS_WORKSPACE",
      message: "You are not a member of this workspace.",
    });
  }

  if (splitRoles(role).includes(OWNER_ROLE)) {
    return { unrestricted: true };
  }

  // Same semantics as `hasWorkspacePermission`: a composite actor role such as
  // "a,b" resolves as one unknown name and therefore grants nothing.
  return {
    unrestricted: false,
    statements: await resolveRoleStatements(workspaceId, role),
  };
}

function exceedsPermissions(): APIError {
  return new APIError("FORBIDDEN", {
    code: "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    message: "You cannot assign a role with permissions you do not have.",
  });
}

export async function assertCanAssignRole({
  workspaceId,
  actorUserId,
  targetRole,
  targetMember,
}: {
  workspaceId: string;
  actorUserId: string;
  targetRole: string;
  targetMember?: { userId: string; role: string };
}): Promise<void> {
  const actor = await resolveActor(workspaceId, actorUserId);
  if (actor.unrestricted) return;

  if (targetMember && targetMember.userId === actorUserId) {
    throw new APIError("FORBIDDEN", {
      code: "YOU_CANNOT_CHANGE_YOUR_OWN_ROLE",
      message: "You cannot change your own role.",
    });
  }

  const granted = actor.statements;
  if (!granted) throw exceedsPermissions();

  const targetRoles = splitRoles(targetRole);
  if (targetRoles.length === 0) throw exceedsPermissions();

  for (const role of targetRoles) {
    const statements =
      role === OWNER_ROLE
        ? null
        : await resolveRoleStatements(workspaceId, role);
    if (!statements || !isStatementSubset(statements, granted)) {
      throw exceedsPermissions();
    }
  }

  if (targetMember) {
    const currentRoles = splitRoles(targetMember.role);
    let manageable = currentRoles.length > 0;
    for (const role of currentRoles) {
      const statements =
        role === OWNER_ROLE
          ? null
          : await resolveRoleStatements(workspaceId, role);
      if (!statements || !isStatementSubset(statements, granted)) {
        manageable = false;
        break;
      }
    }
    if (!manageable) {
      throw new APIError("FORBIDDEN", {
        code: "YOU_CANNOT_MANAGE_THIS_MEMBER",
        message:
          "You cannot change the role of a member with permissions you do not have.",
      });
    }
  }
}

export async function getAssignableRoles(
  workspaceId: string,
  actorUserId: string,
): Promise<AssignableRole[]> {
  const actor = await resolveActor(workspaceId, actorUserId);

  const rows = await db
    .select({
      role: schema.workspaceRoleTable.role,
      permission: schema.workspaceRoleTable.permission,
    })
    .from(schema.workspaceRoleTable)
    .where(eq(schema.workspaceRoleTable.workspaceId, workspaceId));

  const rowStatements = new Map<string, RoleStatements | null>();
  for (const row of rows) {
    rowStatements.set(
      row.role,
      row.permission ? parsePermissionStatements(row.permission) : null,
    );
  }

  const defaults: string[] = [...DEFAULT_ROLE_NAMES];
  const custom = [...rowStatements.keys()]
    .filter((role) => role !== OWNER_ROLE && !defaults.includes(role))
    .sort();

  const result: AssignableRole[] = [];
  for (const role of [...defaults, ...custom]) {
    const statements = rowStatements.get(role) ?? builtInRoleStatements(role);
    if (!statements) continue;
    if (
      !actor.unrestricted &&
      !(actor.statements && isStatementSubset(statements, actor.statements))
    ) {
      continue;
    }
    result.push({ role, isDefault: defaults.includes(role) });
  }
  return result;
}
