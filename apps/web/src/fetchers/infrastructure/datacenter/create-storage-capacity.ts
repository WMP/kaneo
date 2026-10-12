import { client } from "@kaneo/libs";
import { readInfrastructureError } from "@/lib/infrastructure-error";

export type CreateStorageCapacityRequest = {
  workspaceId: string;
  clusterId: string;
  data: {
    label?: string;
    modelName?: string | null;
    capacityGb: number;
  };
};

async function createStorageCapacity({
  workspaceId,
  clusterId,
  data,
}: CreateStorageCapacityRequest) {
  const response = await client.infrastructure.workspace[":workspaceId"][
    "storage-clusters"
  ][":clusterId"].capacity.$post({
    param: { workspaceId, clusterId },
    json: data,
  });

  if (!response.ok) throw await readInfrastructureError(response);

  return response.json();
}

export default createStorageCapacity;
