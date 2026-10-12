import { useQuery } from "@tanstack/react-query";
import getProjectCapacity from "@/fetchers/infrastructure/get-project-capacity";
import {
  INFRASTRUCTURE_STALE_TIME,
  infrastructureKeys,
} from "@/lib/infrastructure-keys";

function useProjectCapacity(projectId: string, enabled = true) {
  return useQuery({
    queryKey: infrastructureKeys.capacity(projectId),
    queryFn: () => getProjectCapacity(projectId),
    enabled: enabled && !!projectId,
    staleTime: INFRASTRUCTURE_STALE_TIME,
  });
}

export default useProjectCapacity;
