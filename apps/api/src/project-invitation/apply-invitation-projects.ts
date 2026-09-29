import { eq, sql } from "drizzle-orm";
import db, { schema } from "../database";
import { unusableProjectRoles } from "../utils/project-access";

// Turns the project rows of an accepted invitation into project memberships,
// atomically, and consumes the invitation's rows.
//
// - Only projects that still belong to the invitation's workspace are granted;
//   the project rows are read `FOR SHARE`, so a concurrent move of a project to
//   another workspace either finishes first (the project is skipped) or waits
//   until the memberships exist (and then drops the ones that do not fit the
//   target workspace).
// - A role that no longer resolves in the workspace (deleted meanwhile) is
//   skipped: it would be an inert row.
// - `ON CONFLICT (project_id, user_id) DO UPDATE SET role`: the role written is
//   exactly the one the inviter was allowed to grant, so it never exceeds what
//   the invitation granted.
// - Every invitation row is deleted afterwards, granted or skipped: nothing of
//   a used invitation is left to be applied a second time.
export async function applyInvitationProjects({
  invitationId,
  workspaceId,
  userId,
  skipGrants,
}: {
  invitationId: string;
  workspaceId: string;
  userId: string;
  skipGrants: boolean;
}): Promise<{ granted: number; skipped: number }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        projectId: schema.invitationProjectTable.projectId,
        role: schema.invitationProjectTable.role,
        projectWorkspaceId: schema.projectTable.workspaceId,
      })
      .from(schema.invitationProjectTable)
      .innerJoin(
        schema.projectTable,
        eq(schema.invitationProjectTable.projectId, schema.projectTable.id),
      )
      .where(eq(schema.invitationProjectTable.invitationId, invitationId))
      .for("share", { of: schema.projectTable });

    if (rows.length === 0) return { granted: 0, skipped: 0 };

    const inWorkspace = rows.filter(
      (row) => row.projectWorkspaceId === workspaceId,
    );
    const unusable = new Set(
      await unusableProjectRoles(tx, workspaceId, [
        ...new Set(inWorkspace.map((row) => row.role)),
      ]),
    );
    const grants = skipGrants
      ? []
      : inWorkspace.filter((row) => !unusable.has(row.role));

    if (grants.length > 0) {
      await tx
        .insert(schema.projectMemberTable)
        .values(
          grants.map((row) => ({
            projectId: row.projectId,
            userId,
            role: row.role,
          })),
        )
        .onConflictDoUpdate({
          target: [
            schema.projectMemberTable.projectId,
            schema.projectMemberTable.userId,
          ],
          set: { role: sql`excluded.role` },
        });
    }

    await tx
      .delete(schema.invitationProjectTable)
      .where(eq(schema.invitationProjectTable.invitationId, invitationId));

    return { granted: grants.length, skipped: rows.length - grants.length };
  });
}
