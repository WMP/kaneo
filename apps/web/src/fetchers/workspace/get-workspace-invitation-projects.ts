import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

// The projects (with the project role) each pending invitation of the workspace
// grants, limited to the projects the caller can open. Empty for a caller who
// does not manage invitations.
async function getWorkspaceInvitationProjects(workspaceId: string) {
  const response = await client.workspace[":workspaceId"][
    "invitation-projects"
  ].$get({ param: { workspaceId } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getWorkspaceInvitationProjects;
