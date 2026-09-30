import { and, eq } from "drizzle-orm";
import db, { schema } from "../../database";
import { getInvitationProjects } from "../../invitation/controllers/get-invitation-projects";

// The projects (and the project role in each) the pending invitations of a
// workspace would grant, for the pending invitations list. A caller without
// the right to see invitations gets nothing, and everybody gets only projects
// they can open themselves (`viewerProjectIds`, `null` being every project), so
// the list names no project the caller could not see in the sidebar.
async function listInvitationProjects({
  workspaceId,
  viewerProjectIds,
  mayManageInvitations,
}: {
  workspaceId: string;
  viewerProjectIds: string[] | null;
  mayManageInvitations: boolean;
}) {
  if (!mayManageInvitations || viewerProjectIds?.length === 0) return [];

  const invitations = await db
    .select({ id: schema.invitationTable.id })
    .from(schema.invitationTable)
    .where(
      and(
        eq(schema.invitationTable.workspaceId, workspaceId),
        eq(schema.invitationTable.status, "pending"),
      ),
    );
  const byInvitation = await getInvitationProjects(
    invitations.map((invitation) => invitation.id),
  );

  const visible = viewerProjectIds ? new Set(viewerProjectIds) : null;
  const result: {
    invitationId: string;
    projects: { id: string; name: string; role: string }[];
  }[] = [];
  for (const [invitationId, projects] of byInvitation) {
    const shown = visible
      ? projects.filter((project) => visible.has(project.id))
      : projects;
    if (shown.length > 0) result.push({ invitationId, projects: shown });
  }
  return result;
}

export default listInvitationProjects;
