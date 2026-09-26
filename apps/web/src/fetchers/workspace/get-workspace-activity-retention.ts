import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

async function getWorkspaceActivityRetention(workspaceId: string) {
  const response = await client.workspace[":workspaceId"][
    "activity-retention"
  ].$get({
    param: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getWorkspaceActivityRetention;
