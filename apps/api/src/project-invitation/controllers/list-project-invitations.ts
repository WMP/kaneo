import { and, asc, eq } from "drizzle-orm";
import db, { schema } from "../../database";
import type { ProjectAccess } from "../../utils/project-access";

// Pending invitations that grant this project, live and expired. Accepted,
// canceled and rejected invitations are not listed.
async function listProjectInvitations(access: ProjectAccess) {
  const rows = await db
    .select({
      id: schema.invitationTable.id,
      email: schema.invitationTable.email,
      workspaceRole: schema.invitationTable.role,
      projectRole: schema.invitationProjectTable.role,
      expiresAt: schema.invitationTable.expiresAt,
      inviterName: schema.userTable.name,
    })
    .from(schema.invitationProjectTable)
    .innerJoin(
      schema.invitationTable,
      eq(schema.invitationProjectTable.invitationId, schema.invitationTable.id),
    )
    .innerJoin(
      schema.userTable,
      eq(schema.invitationTable.inviterId, schema.userTable.id),
    )
    .where(
      and(
        eq(schema.invitationProjectTable.projectId, access.projectId),
        eq(schema.invitationTable.workspaceId, access.workspaceId),
        eq(schema.invitationTable.status, "pending"),
      ),
    )
    .orderBy(asc(schema.invitationTable.createdAt));

  const now = Date.now();
  return rows.map((row) => ({
    ...row,
    workspaceRole: row.workspaceRole ?? "",
    status:
      row.expiresAt.getTime() > now ? ("live" as const) : ("expired" as const),
  }));
}

export default listProjectInvitations;
