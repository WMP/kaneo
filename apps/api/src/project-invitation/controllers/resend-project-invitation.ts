import { and, eq, gt } from "drizzle-orm";
import type { Context } from "hono";
import db, { schema } from "../../database";
import type { ProjectAccess } from "../../utils/project-access";
import { assertCloudInvitationAllowed } from "../cloud-gates";
import { newInvitationExpiry } from "../constants";
import {
  assertCanManageInvitation,
  INVITATION_ERROR_CODES,
  invitationError,
} from "../delegation";
import { deliverInvitationEmail } from "../deliver-email";
import { assertMayExtendInvitation, canInviteToWorkspace } from "../origin";
import {
  lockInvitationEmail,
  requirePendingProjectInvitation,
} from "../queries";

// Like Better Auth's re-send: only a live pending invitation, expiry pushed
// out by the default lifetime, and the email sent again with the re-sender as
// the inviter shown in it. An expired invitation is refused; invite again.
async function resendProjectInvitation({
  c,
  access,
  actorUserId,
  invitationId,
}: {
  c: Context;
  access: ProjectAccess;
  actorUserId: string;
  invitationId: string;
}) {
  const first = await requirePendingProjectInvitation(access, invitationId);
  await assertCloudInvitationAllowed(actorUserId, first.email);

  const mayInviteToWorkspace = await canInviteToWorkspace(c);

  const expiresAt = newInvitationExpiry();
  // Read and checked again under the lock: the roles the caller is judged on
  // are the ones the email is sent for.
  const extended = await db.transaction(async (tx) => {
    await lockInvitationEmail(tx, access.workspaceId, first.email);
    // Locks the invitation row and re-checks it is still pending (the
    // trigger of migration 0057 cancels through the same row).
    const current = await requirePendingProjectInvitation(
      access,
      invitationId,
      tx,
      { lock: true },
    );
    await assertMayExtendInvitation(tx, invitationId, mayInviteToWorkspace);
    await assertCanManageInvitation(access, actorUserId, current, {
      executor: tx,
    });
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
  if (!extended) {
    throw invitationError(
      409,
      INVITATION_ERROR_CODES.expired,
      "The invitation has expired or is no longer pending; invite the person again",
    );
  }

  const delivery = await deliverInvitationEmail({
    invitationId,
    email: first.email,
    workspaceId: access.workspaceId,
    inviterUserId: actorUserId,
  });

  return { id: invitationId, email: first.email, expiresAt, ...delivery };
}

export default resendProjectInvitation;
