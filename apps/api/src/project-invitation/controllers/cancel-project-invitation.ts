import { and, count, eq } from "drizzle-orm";
import db, { schema } from "../../database";
import type { ProjectAccess } from "../../utils/project-access";
import { assertCanManageInvitation } from "../delegation";
import {
  lockInvitationEmail,
  requirePendingProjectInvitation,
} from "../queries";

// Removes THIS project from an invitation. When no project is left the
// invitation is canceled as a whole (status `canceled`, like Better Auth's
// cancel-invitation). The invitation table does not record how an invitation
// was created, so this also cancels a plain workspace invitation to which a
// project was added and then removed again: nothing else is stored to tell the
// two apart.
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

    const removed = await tx
      .delete(schema.invitationProjectTable)
      .where(
        and(
          eq(schema.invitationProjectTable.invitationId, invitationId),
          eq(schema.invitationProjectTable.projectId, access.projectId),
        ),
      )
      .returning({ id: schema.invitationProjectTable.id });
    if (removed.length === 0) return false;

    const [remaining] = await tx
      .select({ value: count() })
      .from(schema.invitationProjectTable)
      .where(eq(schema.invitationProjectTable.invitationId, invitationId));
    if ((remaining?.value ?? 0) > 0) return false;

    await tx
      .update(schema.invitationTable)
      .set({ status: "canceled" })
      .where(
        and(
          eq(schema.invitationTable.id, invitationId),
          eq(schema.invitationTable.status, "pending"),
        ),
      );
    return true;
  });

  return { id: invitation.id, email: invitation.email, canceled };
}

export default cancelProjectInvitation;
