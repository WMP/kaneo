import { client } from "@kaneo/libs";
import { readInfrastructureError } from "@/lib/infrastructure-error";

async function getWorkspaceCapacity(workspaceId: string) {
  const response = await client.infrastructure.workspace[
    ":workspaceId"
  ].capacity.$get({ param: { workspaceId } });

  if (!response.ok) throw await readInfrastructureError(response);

  return response.json();
}

export default getWorkspaceCapacity;
