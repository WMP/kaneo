import { getUserPendingInvitations as getUserPendingInvitationsUtil } from "../../utils/check-registration-allowed";
import { getInvitationProjects } from "./get-invitation-projects";

export default async function getUserPendingInvitations(userEmail: string) {
  const invitations = await getUserPendingInvitationsUtil(userEmail);
  const projects = await getInvitationProjects(
    invitations.map((invitation) => invitation.id),
  );
  return invitations.map((invitation) => ({
    ...invitation,
    projects: projects.get(invitation.id) ?? [],
  }));
}
