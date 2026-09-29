import { and, eq, gt } from "drizzle-orm";
import db, { schema } from "../../database";
import type { ProjectAccess } from "../../utils/project-access";
import { newInvitationExpiry } from "../constants";
import {
  assertCanManageInvitation,
  INVITATION_ERROR_CODES,
  invitationError,
} from "../delegation";
import { deliverInvitationEmail } from "../deliver-email";
import {
  lockInvitationEmail,
  requirePendingProjectInvitation,
} from "../queries";

// Like Better Auth's re-send: only a live pending invitation, expiry pushed
// out by the default lifetime, and the email sent again with the re-sender as
// the inviter shown in it. An expired invitation is refused; invite again.
async function resendProjectInvitation({
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

  const expiresAt = newInvitationExpiry();
  const updated = await db.transaction(async (tx) => {
    await lockInvitationEmail(tx, access.workspaceId, invitation.email);
    const rows = await tx
      .update(schema.invitationTable)
      .set({ expiresAt })
      .where(
        and(
          eq(schema.invitationTable.id, invitationId),
          eq(schema.invitationTable.status, "pending"),
          gt(schema.invitationTable.expiresAt, new Date()),
        ),
      )
      .returning({ id: schema.invitationTable.id });
    return rows.length > 0;
  });
  if (!updated) {
    throw invitationError(
      409,
      INVITATION_ERROR_CODES.expired,
      "The invitation has expired or is no longer pending; invite the person again",
    );
  }

  const delivery = await deliverInvitationEmail({
    invitationId,
    email: invitation.email,
    workspaceId: access.workspaceId,
    inviterUserId: actorUserId,
  });

  return { id: invitation.id, email: invitation.email, expiresAt, ...delivery };
}

export default resendProjectInvitation;
