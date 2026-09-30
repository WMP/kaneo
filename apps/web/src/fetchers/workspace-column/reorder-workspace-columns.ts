import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type ReorderWorkspaceColumnsRequest = {
  workspaceId: string;
  columns: Array<{ id: string; position: number }>;
};

async function reorderWorkspaceColumns({
  workspaceId,
  columns,
}: ReorderWorkspaceColumnsRequest) {
  const response = await client["workspace-column"][
    ":workspaceId"
  ].reorder.$put({
    param: { workspaceId },
    json: { columns },
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default reorderWorkspaceColumns;
