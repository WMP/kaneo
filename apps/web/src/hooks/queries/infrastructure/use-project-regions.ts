import { useQuery } from "@tanstack/react-query";
import getProjectRegions from "@/fetchers/infrastructure/get-project-regions";
import {
  INFRASTRUCTURE_STALE_TIME,
  infrastructureKeys,
} from "@/lib/infrastructure-keys";

function useProjectRegions(projectId: string, enabled = true) {
  return useQuery({
    queryKey: infrastructureKeys.regions(projectId),
    queryFn: () => getProjectRegions(projectId),
    enabled: enabled && !!projectId,
    staleTime: INFRASTRUCTURE_STALE_TIME,
    refetchOnMount: "always",
  });
}

export default useProjectRegions;
