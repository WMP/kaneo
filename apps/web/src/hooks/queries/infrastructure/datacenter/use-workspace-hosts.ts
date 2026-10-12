import { skipToken, useQuery } from "@tanstack/react-query";
import getWorkspaceHosts from "@/fetchers/infrastructure/datacenter/get-workspace-hosts";
import { DATACENTER_STALE_TIME, datacenterHostsKey } from "./keys";

// Pass `undefined` (no workspace, or no datacenter permission) to send no request.
function useWorkspaceHosts(workspaceId: string | undefined) {
  return useQuery({
    queryKey: datacenterHostsKey(workspaceId),
    queryFn: workspaceId ? () => getWorkspaceHosts(workspaceId) : skipToken,
    staleTime: DATACENTER_STALE_TIME,
  });
}

export default useWorkspaceHosts;
