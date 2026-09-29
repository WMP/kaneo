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
  // The email is needed for the lock; everything that decides the outcome is
  // read again under it.
  const { email } = await requirePendingProjectInvitation(access, invitationId);

  const canceled = await db.transaction(async (tx) => {
    // Serializes with a concurrent add of another project (or role change) on
    // the same invitation, so the roles checked below are the ones removed.
    await lockInvitationEmail(tx, access.workspaceId, email);
    const invitation = await requirePendingProjectInvitation(
      access,
      invitationId,
      tx,
    );
    await assertCanManageInvitation(access, actorUserId, invitation, {
      allowInert: true,
    });

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
    return {
      canceled: current?.status === "canceled",
      email: invitation.email,
    };
  });

  return {
    id: invitationId,
    email: canceled.email,
    canceled: canceled.canceled,
  };
}

export default cancelProjectInvitation;
