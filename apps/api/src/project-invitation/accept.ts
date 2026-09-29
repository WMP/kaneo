import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";
import { linkInvitedResources } from "../resource/link-resource";
import { publishMovedAssignments } from "../resource/transfer-assignments";
import {
  isFullAccess,
  removeUserProjectMemberships,
} from "../utils/project-access";
import { closeUserWorkspaceConnections } from "../ws";
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
  invitation: { id: string; organizationId: string; inviterId?: string };
  user: { id: string };
};

// Runs before anything of the acceptance is written.
//
// Somebody who already is a member of the workspace cannot accept: Better Auth
// would add a second member row (nothing makes the pair unique), and a person
// with disagreeing duplicate rows counts as having no membership at all (see
// `singleWorkspaceRole` in `utils/project-access.ts`). This holds for every
// invitation, plain workspace invitations included; the invitation stays
// pending and can be rejected or canceled.
//
// A person who is not in the workspace yet must not get project memberships
// back that an earlier membership left behind (a removal whose cleanup failed,
// direct database edits): every project role of a workspace member comes from
// an invitation or an explicit add. So their rows in this workspace's projects
// are dropped before they join.
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
  // Known limitation: this check and Better Auth's member insert are not one
  // atomic step, and nothing makes (workspace, user) unique in Better Auth's
  // `workspace_member` table (adding a constraint to its table is out of scope
  // for existing installations, which may already hold duplicates). Accepting
  // two invitations to the same workspace at the same moment can therefore
  // still create two member rows; the access rules fail closed on duplicates
  // that disagree on the role (`singleWorkspaceRole`), and an administrator
  // removes the extra row.
  if (member) {
    throw new APIError("CONFLICT", {
      code: "ALREADY_WORKSPACE_MEMBER",
      message: "You are already a member of this workspace.",
    });
  }
  await removeUserProjectMemberships(user.id, invitation.organizationId);
}

// Runs after Better Auth accepted the invitation and created the member. Turns
// the invitation's `ganttpro_invitation_project` rows into project memberships
// in one transaction (see `applyInvitationProjects`). The same transaction also
// links the resources the invitation was sent from and moves their assignments
// in the projects the person can open now (`linkInvitedResources`), so a failure
// of either rolls both back and takes the revert below.
//
// If that fails, Better Auth has already committed the acceptance and would
// answer 200. Leaving the person in the workspace with no projects would be a
// silent half state (and the retry impossible, the invitation being accepted),
// so the acceptance is reverted the way Better Auth reverts its own failure:
// the member row this request created is deleted, the invitation is pending
// again and the sessions Better Auth pointed at the workspace (its accept
// flow makes it the active one) no longer name it, so a client does not land
// in a workspace it is not a member of; then the request fails loudly and can
// simply be repeated. Only if
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
    const moves = await db.transaction(async (tx) => {
      const applied = await applyInvitationProjects({
        invitationId: invitation.id,
        workspaceId: invitation.organizationId,
        userId: user.id,
        // A full-access person reaches every project through their workspace
        // role; a stored project row would only become a stale grant after a
        // demotion (the member API refuses to add such people, too).
        skipGrants: fullAccess,
        executor: tx,
      });
      return linkInvitedResources(tx, {
        invitationId: invitation.id,
        workspaceId: invitation.organizationId,
        userId: user.id,
        // The new memberships are not visible outside this transaction yet, so
        // the reachable projects come from what was just granted.
        projectScope: fullAccess ? null : applied.grantedProjectIds,
      });
    });
    // After the commit; a failing publish is logged and never undoes the link.
    await publishMovedAssignments({
      moves,
      userId: user.id,
      actorUserId: invitation.inviterId ?? user.id,
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
        // Known limitation: the previous active workspace is cleared, not
        // restored. The organization hooks receive no session, so the value
        // from before the acceptance is not known here; the client picks a
        // workspace again.
        await tx
          .update(schema.sessionTable)
          .set({ activeOrganizationId: null })
          .where(
            and(
              eq(schema.sessionTable.userId, user.id),
              eq(
                schema.sessionTable.activeOrganizationId,
                invitation.organizationId,
              ),
            ),
          );
      });
      // The revert takes the membership away again: end any project socket the
      // person opened in that short window instead of waiting for the
      // revalidation. Granting memberships (the normal acceptance) and the
      // purge before a fresh join revoke nothing, so nothing closes there.
      await closeUserWorkspaceConnections(
        user.id,
        invitation.organizationId,
      ).catch((closeError) => {
        console.error(
          `Closing the sockets after reverting invitation ${invitation.id} failed:`,
          closeError,
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
