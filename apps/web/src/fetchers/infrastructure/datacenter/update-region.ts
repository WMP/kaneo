import { client } from "@kaneo/libs";
import { readInfrastructureError } from "@/lib/infrastructure-error";

export type UpdateRegionRequest = {
  workspaceId: string;
  regionId: string;
  data: { name?: string; position?: number; zones?: string[] };
};

async function updateRegion({
  workspaceId,
  regionId,
  data,
}: UpdateRegionRequest) {
  const response = await client.infrastructure.workspace[
    ":workspaceId"
  ].regions[":regionId"].$put({ param: { workspaceId, regionId }, json: data });

  if (!response.ok) throw await readInfrastructureError(response);

  return response.json();
}

export default updateRegion;
