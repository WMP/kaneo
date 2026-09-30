import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

async function getWorkspaceColumns(workspaceId: string) {
  const response = await client["workspace-column"][":workspaceId"].$get({
    param: { workspaceId },
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default getWorkspaceColumns;
