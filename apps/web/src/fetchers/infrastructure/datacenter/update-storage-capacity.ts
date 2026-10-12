import { client } from "@kaneo/libs";
import { readInfrastructureError } from "@/lib/infrastructure-error";
import type { HostStatus } from "./set-host-status";

export type UpdateStorageCapacityRequest = {
  workspaceId: string;
  clusterId: string;
  entryId: string;
  data: {
    label?: string;
    modelName?: string | null;
    capacityGb?: number;
    status?: HostStatus;
    /** Date-only (YYYY-MM-DD); required by the API for `ordered`. */
    availableFrom?: string | null;
    hostname?: string | null;
  };
};

async function updateStorageCapacity({
  workspaceId,
  clusterId,
  entryId,
  data,
}: UpdateStorageCapacityRequest) {
  const response = await client.infrastructure.workspace[":workspaceId"][
    "storage-clusters"
  ][":clusterId"].capacity[":entryId"].$put({
    param: { workspaceId, clusterId, entryId },
    json: data,
  });

  if (!response.ok) throw await readInfrastructureError(response);

  return response.json();
}

export default updateStorageCapacity;
