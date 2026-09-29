import { asc, eq, inArray } from "drizzle-orm";
import db, { schema } from "../../database";

export type InvitationProject = { id: string; name: string; role: string };

// The projects (and project role in each) that accepting the invitations would
// grant, for the accept page. Only projects that still belong to the
// invitation's workspace are listed, exactly as acceptance would grant them.
// Nothing else about a project is exposed: this feeds a route that also
// answers to whoever holds the invitation link.
export async function getInvitationProjects(
  invitationIds: string[],
): Promise<Map<string, InvitationProject[]>> {
  const byInvitation = new Map<string, InvitationProject[]>();
  if (invitationIds.length === 0) return byInvitation;

  const rows = await db
    .select({
      invitationId: schema.invitationProjectTable.invitationId,
      id: schema.projectTable.id,
      name: schema.projectTable.name,
      role: schema.invitationProjectTable.role,
      projectWorkspaceId: schema.projectTable.workspaceId,
      invitationWorkspaceId: schema.invitationTable.workspaceId,
    })
    .from(schema.invitationProjectTable)
    .innerJoin(
      schema.invitationTable,
      eq(schema.invitationProjectTable.invitationId, schema.invitationTable.id),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.invitationProjectTable.projectId, schema.projectTable.id),
    )
    .where(inArray(schema.invitationProjectTable.invitationId, invitationIds))
    .orderBy(asc(schema.projectTable.name), asc(schema.projectTable.id));

  for (const row of rows) {
    if (row.projectWorkspaceId !== row.invitationWorkspaceId) continue;
    const list = byInvitation.get(row.invitationId) ?? [];
    list.push({ id: row.id, name: row.name, role: row.role });
    byInvitation.set(row.invitationId, list);
  }
  return byInvitation;
}
