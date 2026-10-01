import { client } from "@kaneo/libs";

import { readProjectApiError } from "@/lib/project-member-error";

async function getColumns(projectId: string) {
  const response = await client.column[":projectId"].$get({
    param: { projectId },
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default getColumns;
