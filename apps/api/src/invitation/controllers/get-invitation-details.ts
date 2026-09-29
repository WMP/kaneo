import { getInvitationDetails } from "../../utils/check-registration-allowed";
import { getInvitationProjects } from "./get-invitation-projects";

export default async function getInvitationDetailsController(
  invitationId: string,
) {
  const result = await getInvitationDetails(invitationId);
  // Project names only for an invitation that can still be accepted: the
  // public route answers to anyone holding the link, and nothing of a used,
  // canceled or expired invitation needs to be revealed.
  if (!result.valid || !result.invitation) return result;

  const projects =
    (await getInvitationProjects([invitationId])).get(invitationId) ?? [];
  return { ...result, invitation: { ...result.invitation, projects } };
}
