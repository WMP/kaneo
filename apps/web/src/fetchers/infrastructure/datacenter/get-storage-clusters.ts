import { client } from "@kaneo/libs";
import { readInfrastructureError } from "@/lib/infrastructure-error";

async function getStorageClusters(workspaceId: string) {
  const response = await client.infrastructure.workspace[":workspaceId"][
    "storage-clusters"
  ].$get({ param: { workspaceId } });

  if (!response.ok) throw await readInfrastructureError(response);

  return response.json();
}

export default getStorageClusters;
