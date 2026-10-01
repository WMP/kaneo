import { client } from "@kaneo/libs";

import { readProjectApiError } from "@/lib/project-member-error";

async function deleteColumn(id: string) {
  const response = await client.column[":id"].$delete({
    param: { id },
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default deleteColumn;
