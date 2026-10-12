import { skipToken, useQuery } from "@tanstack/react-query";
import getWorkspaceCapacity from "@/fetchers/infrastructure/datacenter/get-workspace-capacity";
import { DATACENTER_STALE_TIME, datacenterCapacityKey } from "./keys";

// Pass `undefined` (no workspace, or no datacenter permission) to send no request.
function useWorkspaceCapacity(workspaceId: string | undefined) {
  return useQuery({
    queryKey: datacenterCapacityKey(workspaceId),
    queryFn: workspaceId ? () => getWorkspaceCapacity(workspaceId) : skipToken,
    staleTime: DATACENTER_STALE_TIME,
  });
}

export default useWorkspaceCapacity;
