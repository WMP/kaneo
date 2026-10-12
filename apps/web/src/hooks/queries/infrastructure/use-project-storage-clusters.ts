import { useQuery } from "@tanstack/react-query";
import getProjectStorageClusters from "@/fetchers/infrastructure/get-project-storage-clusters";
import {
  INFRASTRUCTURE_STALE_TIME,
  infrastructureKeys,
} from "@/lib/infrastructure-keys";

function useProjectStorageClusters(projectId: string, enabled = true) {
  return useQuery({
    queryKey: infrastructureKeys.storageClusters(projectId),
    queryFn: () => getProjectStorageClusters(projectId),
    enabled: enabled && !!projectId,
    staleTime: INFRASTRUCTURE_STALE_TIME,
  });
}

export default useProjectStorageClusters;
