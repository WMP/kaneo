import { client } from "@kaneo/libs";
import { readInfrastructureError } from "@/lib/infrastructure-error";
import type { StorageClusterInput } from "./create-storage-cluster";

export type UpdateStorageClusterRequest = {
  workspaceId: string;
  clusterId: string;
  data: Partial<StorageClusterInput>;
};

async function updateStorageCluster({
  workspaceId,
  clusterId,
  data,
}: UpdateStorageClusterRequest) {
  const response = await client.infrastructure.workspace[":workspaceId"][
    "storage-clusters"
  ][":clusterId"].$put({ param: { workspaceId, clusterId }, json: data });

  if (!response.ok) throw await readInfrastructureError(response);

  return response.json();
}

export default updateStorageCluster;
