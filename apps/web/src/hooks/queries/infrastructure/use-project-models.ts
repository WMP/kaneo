import { useQuery } from "@tanstack/react-query";
import getProjectModels from "@/fetchers/infrastructure/get-project-models";
import {
  INFRASTRUCTURE_STALE_TIME,
  infrastructureKeys,
} from "@/lib/infrastructure-keys";

function useProjectModels(projectId: string, enabled = true) {
  return useQuery({
    queryKey: infrastructureKeys.models(projectId),
    queryFn: () => getProjectModels(projectId),
    enabled: enabled && !!projectId,
    staleTime: INFRASTRUCTURE_STALE_TIME,
  });
}

export default useProjectModels;
