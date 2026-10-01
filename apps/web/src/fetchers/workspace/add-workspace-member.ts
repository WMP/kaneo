import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type AddWorkspaceMemberRequest = {
  workspaceId: string;
  userId: string;
  role: string;
};

// Adds an existing account to the workspace without an invitation. The answer
// says whether the person's email went out (`emailAttempted`, `emailSent`).
async function addWorkspaceMember({
  workspaceId,
  userId,
  role,
}: AddWorkspaceMemberRequest) {
  const response = await client.workspace[":workspaceId"].members.$post({
    param: { workspaceId },
    json: { userId, role },
  });

  if (!response.ok) throw await readProjectApiError(response);

  return response.json();
}

export default addWorkspaceMember;
