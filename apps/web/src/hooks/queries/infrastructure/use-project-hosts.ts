import { useQuery } from "@tanstack/react-query";
import getProjectHosts from "@/fetchers/infrastructure/get-project-hosts";
import {
  INFRASTRUCTURE_STALE_TIME,
  infrastructureKeys,
} from "@/lib/infrastructure-keys";

function useProjectHosts(projectId: string, enabled = true) {
  return useQuery({
    queryKey: infrastructureKeys.hosts(projectId),
    queryFn: () => getProjectHosts(projectId),
    enabled: enabled && !!projectId,
    staleTime: INFRASTRUCTURE_STALE_TIME,
    refetchOnMount: "always",
  });
}

export default useProjectHosts;
