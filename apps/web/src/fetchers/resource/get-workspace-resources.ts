import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";
import type { Resource, ResourceKind } from "@/types/resource";

export type GetWorkspaceResourcesRequest = {
  workspaceId: string;
  kind?: ResourceKind;
};

async function getWorkspaceResources({
  workspaceId,
  kind,
}: GetWorkspaceResourcesRequest): Promise<Resource[]> {
  const response = await client.resource.workspace[":workspaceId"].$get({
    param: { workspaceId },
    query: kind ? { kind } : {},
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  // The API response schema types `kind` as a plain string; narrow it to the
  // Resource shape once here, at the boundary, so consumers get typed data
  // instead of each casting the query result themselves.
  return (await response.json()) as Resource[];
}

export default getWorkspaceResources;
