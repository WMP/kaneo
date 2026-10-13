import { skipToken, useQuery } from "@tanstack/react-query";
import getStorageClusters from "@/fetchers/infrastructure/datacenter/get-storage-clusters";
import { DATACENTER_STALE_TIME, datacenterClustersKey } from "./keys";

// Pass `undefined` (no workspace, or no datacenter permission) to send no request.
function useStorageClusters(workspaceId: string | undefined) {
  return useQuery({
    queryKey: datacenterClustersKey(workspaceId),
    queryFn: workspaceId ? () => getStorageClusters(workspaceId) : skipToken,
    staleTime: DATACENTER_STALE_TIME,
    refetchOnMount: "always",
  });
}

export default useStorageClusters;
