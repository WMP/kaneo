import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../database";
import type { ProjectAccess } from "../utils/project-access";
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
export async function requirePendingProjectInvitation(
  access: ProjectAccess,
  invitationId: string,
): Promise<ProjectInvitationRow> {
  const [row] = await db
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
  if (!row) {
    throw invitationError(
      404,
      INVITATION_ERROR_CODES.notFound,
      "Invitation not found",
    );
  }
  return { ...row, workspaceRole: row.workspaceRole ?? "" };
}
