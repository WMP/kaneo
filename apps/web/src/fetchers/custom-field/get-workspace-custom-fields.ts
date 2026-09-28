import { client } from "@kaneo/libs";

import { HttpError } from "@/lib/http-error";

async function getWorkspaceCustomFields({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const response = await client["custom-field"].workspace[":workspaceId"].$get({
    param: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getWorkspaceCustomFields;
