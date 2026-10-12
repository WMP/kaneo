import { client } from "@kaneo/libs";
import { readInfrastructureError } from "@/lib/infrastructure-error";

export type HostStatus = "planned" | "ordered" | "installed";

export type SetHostStatusRequest = {
  workspaceId: string;
  hostId: string;
  status: HostStatus;
  /** Date-only (YYYY-MM-DD); required by the API for `ordered`. */
  availableFrom?: string | null;
  hostname?: string | null;
};

async function setHostStatus({
  workspaceId,
  hostId,
  ...json
}: SetHostStatusRequest) {
  const response = await client.infrastructure.workspace[":workspaceId"].hosts[
    ":hostId"
  ].status.$put({ param: { workspaceId, hostId }, json });

  if (!response.ok) throw await readInfrastructureError(response);

  return response.json();
}

export default setHostStatus;
