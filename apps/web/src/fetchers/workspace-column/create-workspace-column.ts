import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type CreateWorkspaceColumnRequest = {
  workspaceId: string;
  data: { name: string; icon?: string; color?: string; isFinal?: boolean };
};

async function createWorkspaceColumn({
  workspaceId,
  data,
}: CreateWorkspaceColumnRequest) {
  const response = await client["workspace-column"][":workspaceId"].$post({
    param: { workspaceId },
    json: data,
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default createWorkspaceColumn;
