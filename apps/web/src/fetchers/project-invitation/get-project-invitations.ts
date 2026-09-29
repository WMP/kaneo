import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { readProjectApiError } from "@/lib/project-member-error";

export type ProjectInvitationListItem = InferResponseType<
  (typeof client)["project"][":projectId"]["invitations"]["$get"],
  200
>[number];

// Answers 403 for a caller who may neither invite nor cancel invitations.
async function getProjectInvitations(
  projectId: string,
): Promise<ProjectInvitationListItem[]> {
  const response = await client.project[":projectId"].invitations.$get({
    param: { projectId },
  });

  if (!response.ok) throw await readProjectApiError(response);

  return response.json();
}

export default getProjectInvitations;
