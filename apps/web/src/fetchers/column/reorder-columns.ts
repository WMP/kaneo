import { client } from "@kaneo/libs";

import { readProjectApiError } from "@/lib/project-member-error";

async function reorderColumns(
  projectId: string,
  columns: Array<{ id: string; position: number }>,
) {
  const response = await client.column.reorder[":projectId"].$put({
    param: { projectId },
    json: { columns },
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default reorderColumns;
