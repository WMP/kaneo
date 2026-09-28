import { client } from "@kaneo/libs";

import { HttpError } from "@/lib/http-error";

async function reorderWorkspaceCustomFields(
  workspaceId: string,
  fields: Array<{ id: string; position: number }>,
) {
  const response = await client["custom-field"].workspace[
    ":workspaceId"
  ].reorder.$put({
    param: { workspaceId },
    json: { fields },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default reorderWorkspaceCustomFields;
