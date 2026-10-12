import { client } from "@kaneo/libs";
import { readInfrastructureError } from "@/lib/infrastructure-error";

export type StorageClusterInput = {
  name: string;
  region: string;
  kind: "self_managed" | "managed_service";
  /** k and m: only for `self_managed`. */
  ecDataChunks?: number | null;
  ecCodingChunks?: number | null;
  fillThresholdPercent: number;
  leadTimeDays: number;
};

export type CreateStorageClusterRequest = {
  workspaceId: string;
  data: StorageClusterInput;
};

async function createStorageCluster({
  workspaceId,
  data,
}: CreateStorageClusterRequest) {
  const response = await client.infrastructure.workspace[":workspaceId"][
    "storage-clusters"
  ].$post({ param: { workspaceId }, json: data });

  if (!response.ok) throw await readInfrastructureError(response);

  return response.json();
}

export default createStorageCluster;
