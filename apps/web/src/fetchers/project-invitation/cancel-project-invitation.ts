import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type CancelProjectInvitationRequest = {
  projectId: string;
  invitationId: string;
};

// `canceled` is false when the invitation still grants other projects and
// only lost this one.
async function cancelProjectInvitation({
  projectId,
  invitationId,
}: CancelProjectInvitationRequest) {
  const response = await client.project[":projectId"].invitations[
    ":invitationId"
  ].$delete({
    param: { projectId, invitationId },
  });

  if (!response.ok) throw await readProjectApiError(response);

  return response.json();
}

export default cancelProjectInvitation;
