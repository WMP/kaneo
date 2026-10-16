import { client } from "@kaneo/libs";
import { readInfrastructureError } from "@/lib/infrastructure-error";

export type DeleteRegionRequest = {
  workspaceId: string;
  regionId: string;
};

async function deleteRegion({ workspaceId, regionId }: DeleteRegionRequest) {
  const response = await client.infrastructure.workspace[
    ":workspaceId"
  ].regions[":regionId"].$delete({ param: { workspaceId, regionId } });

  if (!response.ok) throw await readInfrastructureError(response);

  return response.json();
}

export default deleteRegion;
