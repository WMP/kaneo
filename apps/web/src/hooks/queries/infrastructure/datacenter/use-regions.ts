import { skipToken, useQuery } from "@tanstack/react-query";
import getRegions from "@/fetchers/infrastructure/datacenter/get-regions";
import { DATACENTER_STALE_TIME, datacenterRegionsKey } from "./keys";

// Pass `undefined` (no workspace, or no datacenter permission) to send no request.
function useRegions(workspaceId: string | undefined) {
  return useQuery({
    queryKey: datacenterRegionsKey(workspaceId),
    queryFn: workspaceId ? () => getRegions(workspaceId) : skipToken,
    staleTime: DATACENTER_STALE_TIME,
    refetchOnMount: "always",
  });
}

export default useRegions;
