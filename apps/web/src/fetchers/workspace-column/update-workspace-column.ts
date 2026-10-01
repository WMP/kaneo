import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type UpdateWorkspaceColumnRequest = {
  workspaceId: string;
  columnId: string;
  data: {
    name?: string;
    icon?: string | null;
    color?: string | null;
    isFinal?: boolean;
  };
};

async function updateWorkspaceColumn({
  workspaceId,
  columnId,
  data,
}: UpdateWorkspaceColumnRequest) {
  const response = await client["workspace-column"][":workspaceId"][
    ":columnId"
  ].$put({
    param: { workspaceId, columnId },
    json: data,
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default updateWorkspaceColumn;
