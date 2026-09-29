import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";

// A project role is a name from the workspace role catalog. Deleting or
// renaming a `workspace_role` that a project membership (or a pending project
// invitation) still names would leave people with a role that no longer
// resolves, so it is refused until they are moved to another role. Better Auth
// has no organization hook for role changes, so `auth.ts` calls this from
// `hooks.before` for `/organization/delete-role` and `/organization/update-role`.

export async function findRoleName(
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

  const [invited] = await db
    .select({ id: schema.invitationProjectTable.id })
    .from(schema.invitationProjectTable)
    .innerJoin(
      schema.invitationTable,
      eq(schema.invitationTable.id, schema.invitationProjectTable.invitationId),
    )
    .where(
      and(
        eq(schema.invitationTable.workspaceId, workspaceId),
        eq(schema.invitationTable.status, "pending"),
        eq(schema.invitationProjectTable.role, role),
      ),
    )
    .limit(1);
  return Boolean(invited);
}

export async function assertRoleNotUsedByProjects({
  workspaceId,
  role,
  action,
}: {
  workspaceId: string;
  role: string;
  action: "delete" | "rename";
}): Promise<void> {
  if (!(await isRoleUsedByProjects(workspaceId, role))) return;
  throw new APIError("BAD_REQUEST", {
    code: "ROLE_IS_ASSIGNED_TO_PROJECT_MEMBERS",
    message: `Cannot ${action} a role that is assigned to project members or pending project invitations. Move them to another role first.`,
  });
}
