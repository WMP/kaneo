import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type DeleteWorkspaceColumnRequest = {
  workspaceId: string;
  columnId: string;
  /** Workspace column that receives the tasks of the deleted column. */
  moveTasksTo?: string;
};

async function deleteWorkspaceColumn({
  workspaceId,
  columnId,
  moveTasksTo,
}: DeleteWorkspaceColumnRequest) {
  const response = await client["workspace-column"][":workspaceId"][
    ":columnId"
  ].$delete({
    param: { workspaceId, columnId },
    query: moveTasksTo ? { moveTasksTo } : {},
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default deleteWorkspaceColumn;
