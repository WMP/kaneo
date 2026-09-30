import { client } from "@kaneo/libs";

import { readProjectApiError } from "@/lib/project-member-error";

async function createColumn(
  projectId: string,
  data: { name: string; icon?: string; color?: string; isFinal?: boolean },
) {
  const response = await client.column[":projectId"].$post({
    param: { projectId },
    json: data,
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default createColumn;
