import { DEFAULT_ROLE_NAMES } from "@kaneo/permissions";
import { APIError } from "better-auth/api";
import { and, eq, gt } from "drizzle-orm";
import db, { schema } from "../database";
import {
  builtInRoleStatements,
  isStatementSubset,
  parsePermissionStatements,
  type RoleStatements,
  resolveRoleStatements,
  type SelectExecutor,
} from "./role-statements";

// A non-owner may only hand out roles whose permissions are a subset of their
// own. Better Auth checks `invitation:create` / `member:update` but not what
// the role being granted contains, so a delegated inviter could otherwise mint
// an admin. Enforced from `auth.ts`: the `beforeCreateInvitation` and
// `beforeUpdateMemberRole` organization hooks, plus `hooks.before` for
// invitation re-sends (which reach no organization hook).

type AssignableRole = { role: string; isDefault: boolean };

const OWNER_ROLE = "owner";

export function splitRoles(role: string): string[] {
  return role
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

async function isInstanceAdminUser(
  userId: string,
  executor: SelectExecutor,
): Promise<boolean> {
  // Read the current role instead of a session snapshot, which can predate
  // an administrator's change.
  const [row] = await executor
    .select({ role: schema.userTable.role })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  return row?.role === "admin";
}

async function findMembershipRole(
  workspaceId: string,
  userId: string,
  executor: SelectExecutor,
): Promise<string | null> {
  const [member] = await executor
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

export type Actor =
  | { unrestricted: true }
  | { unrestricted: false; statements: RoleStatements | null };

// `null` when the user is neither an instance administrator nor a member.
async function resolveActor(
  workspaceId: string,
  actorUserId: string,
  executor: SelectExecutor = db,
): Promise<Actor | null> {
  if (await isInstanceAdminUser(actorUserId, executor)) {
    return { unrestricted: true };
  }

  const role = await findMembershipRole(workspaceId, actorUserId, executor);
  if (!role) return null;

  if (splitRoles(role).includes(OWNER_ROLE)) {
    return { unrestricted: true };
  }

  // Same semantics as `hasWorkspacePermission`: a composite actor role such as
  // "a,b" resolves as one unknown name and therefore grants nothing.
  return {
    unrestricted: false,
    statements: await resolveRoleStatements(workspaceId, role, executor),
  };
}

async function requireActor(
  workspaceId: string,
  actorUserId: string,
  executor: SelectExecutor = db,
): Promise<Actor> {
  const actor = await resolveActor(workspaceId, actorUserId, executor);
  if (!actor) {
    throw new APIError("FORBIDDEN", {
      code: "YOU_ARE_NOT_A_MEMBER_OF_THIS_WORKSPACE",
      message: "You are not a member of this workspace.",
    });
  }
  return actor;
}

function exceedsPermissions(): APIError {
  return new APIError("FORBIDDEN", {
    code: "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    message: "You cannot assign a role with permissions you do not have.",
  });
}

// True when every role resolves to a non-owner role within `granted`. An empty
// list, `owner` and an unresolvable name are never within.
export async function rolesWithin(
  workspaceId: string,
  roles: string[],
  granted: RoleStatements,
  executor: SelectExecutor = db,
): Promise<boolean> {
  if (roles.length === 0) return false;
  for (const role of roles) {
    if (role === OWNER_ROLE) return false;
    const statements = await resolveRoleStatements(workspaceId, role, executor);
    if (!statements || !isStatementSubset(statements, granted)) return false;
  }
  return true;
}

export async function assertCanAssignRole({
  workspaceId,
  actorUserId,
  targetRole,
  targetMember,
  executor = db,
}: {
  workspaceId: string;
  actorUserId: string;
  targetRole: string;
  targetMember?: { userId: string; role: string };
  // Run the lookups on this connection (a transaction that holds locks).
  executor?: SelectExecutor;
}): Promise<void> {
  const actor = await requireActor(workspaceId, actorUserId, executor);
  if (actor.unrestricted) return;

  if (targetMember && targetMember.userId === actorUserId) {
    throw new APIError("FORBIDDEN", {
      code: "YOU_CANNOT_CHANGE_YOUR_OWN_ROLE",
      message: "You cannot change your own role.",
    });
  }

  const granted = actor.statements;
  if (!granted) throw exceedsPermissions();

  if (
    !(await rolesWithin(workspaceId, splitRoles(targetRole), granted, executor))
  ) {
    throw exceedsPermissions();
  }

  if (
    targetMember &&
    !(await rolesWithin(
      workspaceId,
      splitRoles(targetMember.role),
      granted,
      executor,
    ))
  ) {
    throw new APIError("FORBIDDEN", {
      code: "YOU_CANNOT_MANAGE_THIS_MEMBER",
      message:
        "You cannot change the role of a member with permissions you do not have.",
    });
  }
}

// `invite-member` with `resend: true` returns before `beforeCreateInvitation`
// and re-sends the EXISTING invitation, so that invitation's role is what must
// be checked. Selects like Better Auth's `findPendingInvitation`: workspace,
// lower-cased email, `pending` and not expired. Better Auth then takes the
// first row of an unordered query, which cannot be reproduced here, so every
// live pending row is checked; that is identical in the normal case of a
// single invitation. With none, Better Auth creates a new invitation and
// `beforeCreateInvitation` checks that one.
export async function assertCanResendInvitation({
  workspaceId,
  actorUserId,
  email,
}: {
  workspaceId: string;
  actorUserId: string;
  email: string;
}): Promise<void> {
  const pending = await db
    .select({ role: schema.invitationTable.role })
    .from(schema.invitationTable)
    .where(
      and(
        eq(schema.invitationTable.workspaceId, workspaceId),
        eq(schema.invitationTable.email, email.toLowerCase()),
        eq(schema.invitationTable.status, "pending"),
        gt(schema.invitationTable.expiresAt, new Date()),
      ),
    );
  // Nothing to re-send: Better Auth creates a new invitation instead.
  if (pending.length === 0) return;

  const actor = await requireActor(workspaceId, actorUserId);
  if (actor.unrestricted) return;
  const granted = actor.statements;
  if (!granted) throw exceedsPermissions();

  // One check per distinct role set, however many rows share it.
  const roleSets = new Set(pending.map((invitation) => invitation.role ?? ""));
  for (const roleSet of roleSets) {
    if (!(await rolesWithin(workspaceId, splitRoles(roleSet), granted))) {
      throw exceedsPermissions();
    }
  }
}

export async function getAssignableRoles(
  workspaceId: string,
  actorUserId: string,
): Promise<AssignableRole[]> {
  const actor = await resolveActor(workspaceId, actorUserId);
  // Called from a Hono route, where an `APIError` would surface as a 500: a
  // non-member simply has nothing to assign.
  if (!actor) return [];

  return assignableRolesFor(workspaceId, actor);
}

// The catalog roles an actor may hand out: those whose permissions the actor
// also holds (everything but `owner` for an unrestricted actor). `actor` is the
// workspace-level actor for workspace invitations and role changes, or the
// actor's effective statements inside a project for project membership.
export async function assignableRolesFor(
  workspaceId: string,
  actor: Actor,
): Promise<AssignableRole[]> {
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
