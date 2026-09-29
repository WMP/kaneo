import { and, eq } from "drizzle-orm";
import db, { schema } from "../../database";
import type { ProjectAccess } from "../../utils/project-access";
import { assertCanManageInvitation } from "../delegation";
import {
  lockInvitationEmail,
  requirePendingProjectInvitation,
} from "../queries";

// Removes THIS project from an invitation. An invitation created through the
// project routes (it has a `ganttpro_invitation_origin` row) is canceled as a
// whole (status `canceled`, like Better Auth's cancel-invitation) when no
// project is left. A plain workspace invitation to which a project was added
// only loses that project.
async function cancelProjectInvitation({
  access,
  actorUserId,
  invitationId,
}: {
  access: ProjectAccess;
  actorUserId: string;
  invitationId: string;
}) {
  const invitation = await requirePendingProjectInvitation(
    access,
    invitationId,
  );
  await assertCanManageInvitation(access, actorUserId, invitation);

  const canceled = await db.transaction(async (tx) => {
    // Serializes with a concurrent add of another project to the same
    // invitation, so an invitation is never canceled while gaining a project.
    await lockInvitationEmail(tx, access.workspaceId, invitation.email);

    await tx
      .delete(schema.invitationProjectTable)
      .where(
        and(
          eq(schema.invitationProjectTable.invitationId, invitationId),
          eq(schema.invitationProjectTable.projectId, access.projectId),
        ),
      );

    // The database cancels a project-origin invitation whose last project is
    // gone (trigger of migration 0057), whatever removed the row. A workspace
    // invitation that only had a project attached keeps its status.
    const [current] = await tx
      .select({ status: schema.invitationTable.status })
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, invitationId));
    return current?.status === "canceled";
  });

  return { id: invitation.id, email: invitation.email, canceled };
}

export default cancelProjectInvitation;
