import { client } from "@kaneo/libs";
import { readInfrastructureError } from "@/lib/infrastructure-error";

export type DeleteStorageClusterRequest = {
  workspaceId: string;
  clusterId: string;
};

async function deleteStorageCluster({
  workspaceId,
  clusterId,
}: DeleteStorageClusterRequest) {
  const response = await client.infrastructure.workspace[":workspaceId"][
    "storage-clusters"
  ][":clusterId"].$delete({ param: { workspaceId, clusterId } });

  if (!response.ok) throw await readInfrastructureError(response);

  return response.json();
}

export default deleteStorageCluster;
