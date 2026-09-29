import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type InviteResourceRequest = {
  id: string;
  workspaceRole: string;
  projects: { projectId: string; role: string }[];
};

// Sends the invitation of a person resource: one invitation to its email
// address, for the chosen projects. A failure is thrown with the API's `code`
// (`readProjectApiError`); see `getResourceErrorMessage`.
async function inviteResource({
  id,
  workspaceRole,
  projects,
}: InviteResourceRequest) {
  const response = await client.resource[":id"].invite.$post({
    param: { id },
    json: { workspaceRole, projects },
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default inviteResource;
