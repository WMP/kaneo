import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";
import type { Resource, ResourceKind } from "@/types/resource";

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
}: CreateResourceRequest): Promise<Resource> {
  const response = await client.resource.workspace[":workspaceId"].$post({
    param: { workspaceId },
    json: { kind, name, email },
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  // The API response schema types `kind` as a plain string; narrow it to the
  // Resource shape once here (as getWorkspaceResources does), so the created
  // resource can be handed on, e.g. to the invite dialog.
  return (await response.json()) as Resource;
}

export default createResource;
