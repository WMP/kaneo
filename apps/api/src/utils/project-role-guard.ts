import { DEFAULT_ROLE_NAMES } from "@kaneo/permissions";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";
import { isOwnerRole } from "./project-access";
import { resolveRoleStatements } from "./role-statements";

// A project role is a name from the workspace role catalog. Deleting or
// renaming a `workspace_role` that a project membership (or a pending project
// invitation) still names would leave people with a role that no longer
// resolves, so it is refused until they are moved to another role. Better Auth
// has no organization hook for role changes, so `auth.ts` calls this from
// `hooks.before` for `/organization/delete-role` and `/organization/update-role`.
//
// The guard runs BEFORE Better Auth authorizes the request, so it must not tell
// an unauthorized caller anything: it only speaks up for a caller who would be
// allowed to delete or rename the role anyway, and stays out of the way of
// Better Auth's own answer for predefined roles.

export const ROLE_IN_USE_CODE = "ROLE_IS_ASSIGNED_TO_PROJECT_MEMBERS";

const PREDEFINED_ROLES: readonly string[] = [...DEFAULT_ROLE_NAMES, "owner"];

async function findRoleName(
  workspaceId: string,
  target: { roleName?: unknown; roleId?: unknown },
): Promise<string | null> {
  if (typeof target.roleName === "string" && target.roleName) {
    return target.roleName;
  }
  if (typeof target.roleId === "string" && target.roleId) {
    const [row] = await db
      .select({ role: schema.workspaceRoleTable.role })
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspaceId),
          eq(schema.workspaceRoleTable.id, target.roleId),
        ),
      )
      .limit(1);
    return row?.role ?? null;
  }
  return null;
}

// Would Better Auth let this user delete (`ac:delete`) or rename (`ac:update`)
// roles of the workspace? Instance administrators and owners always may.
async function mayManageRoles(
  workspaceId: string,
  userId: string,
  action: "delete" | "update",
): Promise<boolean> {
  const [user] = await db
    .select({ role: schema.userTable.role })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  if (user?.role === "admin") return true;

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
  if (isOwnerRole(member.role)) return true;

  const statements = await resolveRoleStatements(workspaceId, member.role);
  return Boolean(statements?.ac?.includes(action));
}

export async function isRoleUsedByProjects(
  workspaceId: string,
  role: string,
): Promise<boolean> {
  const [member] = await db
    .select({ id: schema.projectMemberTable.id })
    .from(schema.projectMemberTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.projectMemberTable.projectId),
    )
    .where(
      and(
        eq(schema.projectTable.workspaceId, workspaceId),
        eq(schema.projectMemberTable.role, role),
      ),
    )
    .limit(1);
  if (member) return true;

  // A pending invitation grants its project roles in the workspace of the
  // INVITED PROJECT, whatever workspace the invitation itself belongs to.
  const [invited] = await db
    .select({ id: schema.invitationProjectTable.id })
    .from(schema.invitationProjectTable)
    .innerJoin(
      schema.invitationTable,
      eq(schema.invitationTable.id, schema.invitationProjectTable.invitationId),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.invitationProjectTable.projectId),
    )
    .where(
      and(
        eq(schema.projectTable.workspaceId, workspaceId),
        eq(schema.invitationTable.status, "pending"),
        eq(schema.invitationProjectTable.role, role),
      ),
    )
    .limit(1);
  return Boolean(invited);
}

// `body` is the raw request body of `/organization/delete-role` or
// `/organization/update-role`; `actor` is the resolved session (or nothing, in
// which case Better Auth answers 401 itself). The workspace is resolved like
// Better Auth does: `??`, the body first, then the active organization.
export async function guardRoleChange({
  action,
  body,
  actor,
}: {
  action: "delete" | "rename";
  body: {
    organizationId?: unknown;
    roleName?: unknown;
    roleId?: unknown;
  } | null;
  actor: { userId: string; activeOrganizationId?: string | null } | null;
}): Promise<void> {
  if (!actor) return;
  const workspaceId = body?.organizationId ?? actor.activeOrganizationId;
  if (typeof workspaceId !== "string" || !workspaceId) return;

  if (
    !(await mayManageRoles(
      workspaceId,
      actor.userId,
      action === "delete" ? "delete" : "update",
    ))
  ) {
    return;
  }

  const role = await findRoleName(workspaceId, body ?? {});
  if (!role || PREDEFINED_ROLES.includes(role)) return;

  if (await isRoleUsedByProjects(workspaceId, role)) {
    throw new APIError("BAD_REQUEST", {
      code: ROLE_IN_USE_CODE,
      message: `Cannot ${action} a role that is assigned to project members or pending project invitations. Move them to another role first.`,
    });
  }
}
