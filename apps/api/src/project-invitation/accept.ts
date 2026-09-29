import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";
import {
  isFullAccess,
  removeUserProjectMemberships,
} from "../utils/project-access";
import { applyInvitationProjects } from "./apply-invitation-projects";

// Project invitations ride on Better Auth's accept flow
// (`/organization/accept-invitation`). Better Auth runs, in order:
//
//   1. its own checks (pending, unexpired, email of the session matches,
//      membership limit),
//   2. `beforeAcceptInvitation({ invitation, user, organization })`,
//   3. invitation status -> accepted, then the workspace member row is created
//      (in its own transaction; a failure there puts the status back),
//   4. `afterAcceptInvitation({ invitation, member, user, organization })`,
//      whose failure Better Auth does NOT roll back.
//
// `before` removes the leftovers of an earlier membership, `after` creates the
// project memberships.

type AcceptInput = {
  invitation: { id: string; organizationId: string };
  user: { id: string };
};

// Runs before anything of the acceptance is written. A person who is not in
// the workspace yet must not get project memberships back that an earlier
// membership left behind (a removal whose cleanup failed, direct database
// edits): every project role of a workspace member comes from an invitation or
// an explicit add. A person who already is a member (they joined by another
// route since the invitation was sent) keeps what they have.
export async function beforeAcceptProjectInvitation({
  invitation,
  user,
}: AcceptInput): Promise<void> {
  const [member] = await db
    .select({ id: schema.workspaceUserTable.id })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, invitation.organizationId),
        eq(schema.workspaceUserTable.userId, user.id),
      ),
    )
    .limit(1);
  if (member) return;
  await removeUserProjectMemberships(user.id, invitation.organizationId);
}

// Runs after Better Auth accepted the invitation and created the member. Turns
// the invitation's `ganttpro_invitation_project` rows into project memberships
// in one transaction (see `applyInvitationProjects`).
//
// If that fails, Better Auth has already committed the acceptance and would
// answer 200. Leaving the person in the workspace with no projects would be a
// silent half state (and the retry impossible, the invitation being accepted),
// so the acceptance is reverted the way Better Auth reverts its own failure:
// the member row this request created is deleted and the invitation is pending
// again, then the request fails loudly and can simply be repeated. Only if
// that revert fails as well does the half state remain (member without
// project access, invitation accepted, its project rows kept): it is logged and
// reported in the error, and an administrator can add the person to the
// projects.
export async function afterAcceptProjectInvitation({
  invitation,
  member,
  user,
}: AcceptInput & { member: { id: string } }): Promise<void> {
  try {
    const fullAccess = await isFullAccess(user.id, invitation.organizationId);
    await applyInvitationProjects({
      invitationId: invitation.id,
      workspaceId: invitation.organizationId,
      userId: user.id,
      // A full-access person reaches every project through their workspace
      // role; a stored project row would only become a stale grant after a
      // demotion (the member API refuses to add such people, too).
      skipGrants: fullAccess,
    });
  } catch (error) {
    console.error(
      `Applying the project invitation ${invitation.id} failed:`,
      error,
    );
    try {
      await db.transaction(async (tx) => {
        await tx
          .delete(schema.workspaceUserTable)
          .where(eq(schema.workspaceUserTable.id, member.id));
        await tx
          .update(schema.invitationTable)
          .set({ status: "pending" })
          .where(
            and(
              eq(schema.invitationTable.id, invitation.id),
              eq(schema.invitationTable.status, "accepted"),
            ),
          );
      });
    } catch (revertError) {
      console.error(
        `Reverting the acceptance of invitation ${invitation.id} failed; the person is a workspace member without the project access of the invitation:`,
        revertError,
      );
      throw new APIError("INTERNAL_SERVER_ERROR", {
        code: "PROJECT_INVITATION_NOT_APPLIED",
        message:
          "You joined the workspace, but the project access of the invitation could not be applied. Ask a workspace administrator to add you to the projects.",
      });
    }
    throw new APIError("INTERNAL_SERVER_ERROR", {
      code: "PROJECT_INVITATION_NOT_APPLIED",
      message:
        "The project access of the invitation could not be applied and nothing was changed. Please try accepting again.",
    });
  }
}
