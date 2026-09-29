import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type CreateProjectInvitationRequest = {
  projectId: string;
  email: string;
  workspaceRole: string;
  projectRole: string;
};

// `created` is false when a live invitation for the same email and workspace
// role already existed and this project was added to it (200, no new email).
async function createProjectInvitation({
  projectId,
  email,
  workspaceRole,
  projectRole,
}: CreateProjectInvitationRequest) {
  const response = await client.project[":projectId"].invitations.$post({
    param: { projectId },
    json: { email, workspaceRole, projectRole },
  });

  if (!response.ok) throw await readProjectApiError(response);

  const invitation = await response.json();
  return { created: response.status === 201, invitation };
}

export default createProjectInvitation;
