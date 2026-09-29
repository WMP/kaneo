import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";
import { workspaceMemberStanding } from "./project-access";

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
// Better Auth's own answer for `owner`. `viewer`, `member` and `admin` are
// dynamic catalog rows that Better Auth lets a caller delete or rename, so they
// are guarded like any custom role.

export const ROLE_IN_USE_CODE = "ROLE_IS_ASSIGNED_TO_PROJECT_MEMBERS";

// The only static role: Better Auth refuses to delete it itself. `viewer`,
// `member` and `admin` are deliberately NOT skipped: they are rows in the role
// catalog that an administrator may have narrowed, and deleting or renaming such
// a row would silently widen every project member holding it back to the
// built-in statements (a name without a row resolves to the built-in role).
const STATIC_ROLE = "owner";

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
// roles of the workspace? Its rule: a member of that workspace whose role holds
// the permission, `owner` included. Instance administrators get no special
// treatment there, so they get none here.
async function mayManageRoles(
  workspaceId: string,
  userId: string,
  action: "delete" | "update",
): Promise<boolean> {
  const standing = await workspaceMemberStanding(userId, workspaceId);
  if (!standing) return false;
  return standing.owner || Boolean(standing.statements?.ac?.includes(action));
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
  if (!role || role === STATIC_ROLE) return;

  if (await isRoleUsedByProjects(workspaceId, role)) {
    throw new APIError("BAD_REQUEST", {
      code: ROLE_IN_USE_CODE,
      message: `Cannot ${action} a role that is assigned to project members or pending project invitations. Move them to another role first.`,
    });
  }
}
