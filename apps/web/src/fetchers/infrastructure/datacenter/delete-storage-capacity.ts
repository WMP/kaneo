import { client } from "@kaneo/libs";
import { readInfrastructureError } from "@/lib/infrastructure-error";

export type DeleteStorageCapacityRequest = {
  workspaceId: string;
  clusterId: string;
  entryId: string;
};

async function deleteStorageCapacity({
  workspaceId,
  clusterId,
  entryId,
}: DeleteStorageCapacityRequest) {
  const response = await client.infrastructure.workspace[":workspaceId"][
    "storage-clusters"
  ][":clusterId"].capacity[":entryId"].$delete({
    param: { workspaceId, clusterId, entryId },
  });

  if (!response.ok) throw await readInfrastructureError(response);

  return response.json();
}

export default deleteStorageCapacity;
