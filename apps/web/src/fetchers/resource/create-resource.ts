import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";
import type { ResourceKind } from "@/types/resource";

export type CreateResourceRequest = {
  workspaceId: string;
  kind: ResourceKind;
  name: string;
  email?: string;
};

async function createResource({
  workspaceId,
  kind,
  name,
  email,
}: CreateResourceRequest) {
  const response = await client.resource.workspace[":workspaceId"].$post({
    param: { workspaceId },
    json: { kind, name, email },
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default createResource;
