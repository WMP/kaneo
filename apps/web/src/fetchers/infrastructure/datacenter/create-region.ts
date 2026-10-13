import { client } from "@kaneo/libs";
import { readInfrastructureError } from "@/lib/infrastructure-error";

export type CreateRegionRequest = {
  workspaceId: string;
  data: { code: string; name: string; zones?: string[] };
};

async function createRegion({ workspaceId, data }: CreateRegionRequest) {
  const response = await client.infrastructure.workspace[
    ":workspaceId"
  ].regions.$post({ param: { workspaceId }, json: data });

  if (!response.ok) throw await readInfrastructureError(response);

  return response.json();
}

export default createRegion;
