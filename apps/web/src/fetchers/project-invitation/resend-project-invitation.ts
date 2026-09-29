import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type ResendProjectInvitationRequest = {
  projectId: string;
  invitationId: string;
};

async function resendProjectInvitation({
  projectId,
  invitationId,
}: ResendProjectInvitationRequest) {
  const response = await client.project[":projectId"].invitations[
    ":invitationId"
  ].resend.$post({
    param: { projectId, invitationId },
  });

  if (!response.ok) throw await readProjectApiError(response);

  return response.json();
}

export default resendProjectInvitation;
