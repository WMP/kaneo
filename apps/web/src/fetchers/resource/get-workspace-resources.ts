import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";
import type { ResourceKind } from "@/types/resource";

export type GetWorkspaceResourcesRequest = {
  workspaceId: string;
  kind?: ResourceKind;
};

async function getWorkspaceResources({
  workspaceId,
  kind,
}: GetWorkspaceResourcesRequest) {
  const response = await client.resource.workspace[":workspaceId"].$get({
    param: { workspaceId },
    query: kind ? { kind } : {},
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getWorkspaceResources;
