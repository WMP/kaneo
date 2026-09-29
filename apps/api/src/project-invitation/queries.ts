import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../database";
import type { ProjectAccess } from "../utils/project-access";
import type { SelectExecutor } from "../utils/role-statements";
import { INVITATION_ERROR_CODES, invitationError } from "./delegation";

// Serializes everything that creates, cancels or extends invitations of one
// email in one workspace: two creates would both pass the "no live invitation"
// check, and a cancel must not race an upsert into the same invitation. The
// lock lives until the surrounding transaction ends.
export async function lockInvitationEmail(
  executor: Pick<typeof db, "execute">,
  workspaceId: string,
  email: string,
): Promise<void> {
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`project-invitation:${workspaceId}:${email.toLowerCase()}`}))`,
  );
}

export type ProjectInvitationRow = {
  id: string;
  email: string;
  workspaceRole: string;
  projectRole: string;
  expiresAt: Date;
};

// A PENDING invitation of this project's workspace that grants this project.
// Anything else (unknown id, another project's invitation, accepted, canceled)
// is a 404 so ids of foreign invitations are not confirmed.
//
// With `lock`, the invitation row (and the project row of the invitation) is
// locked `FOR UPDATE` and the conditions are evaluated after the lock is
// granted, so an invitation that was canceled or moved while waiting is a 404,
// never a stale row. The trigger of migration 0057 cancels a project-origin
// invitation by updating that very row, so holding the lock keeps a concurrent
// project move or delete from interleaving. The invitation-project row is
// locked first, the same order the trigger's statement takes them in (it
// deletes the project rows, then updates the invitation), so the two cannot
// deadlock.
export async function requirePendingProjectInvitation(
  access: ProjectAccess,
  invitationId: string,
  executor: SelectExecutor = db,
  { lock = false }: { lock?: boolean } = {},
): Promise<ProjectInvitationRow> {
  const query = executor
    .select({
      id: schema.invitationTable.id,
      email: schema.invitationTable.email,
      workspaceRole: schema.invitationTable.role,
      projectRole: schema.invitationProjectTable.role,
      expiresAt: schema.invitationTable.expiresAt,
    })
    .from(schema.invitationProjectTable)
    .innerJoin(
      schema.invitationTable,
      eq(schema.invitationProjectTable.invitationId, schema.invitationTable.id),
    )
    .where(
      and(
        eq(schema.invitationTable.id, invitationId),
        eq(schema.invitationProjectTable.projectId, access.projectId),
        eq(schema.invitationTable.workspaceId, access.workspaceId),
        eq(schema.invitationTable.status, "pending"),
      ),
    )
    .limit(1);
  const [row] = lock
    ? await query.for("update", {
        of: [schema.invitationProjectTable, schema.invitationTable],
      })
    : await query;
  if (!row) {
    throw invitationError(
      404,
      INVITATION_ERROR_CODES.notFound,
      "Invitation not found",
    );
  }
  return { ...row, workspaceRole: row.workspaceRole ?? "" };
}
