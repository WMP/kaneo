import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { infrastructureKeys } from "@/lib/infrastructure-keys";

// Every change of the pool, the hosts or the VMs moves host totals, use and
// warnings, so the hosts and the capacity of the project are always refreshed.
export function useInfrastructureInvalidation() {
  const queryClient = useQueryClient();
  return useCallback(
    (projectId: string, extra?: { models?: boolean; taskId?: string }) => {
      void queryClient.invalidateQueries({
        queryKey: infrastructureKeys.hosts(projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: infrastructureKeys.capacity(projectId),
      });
      if (extra?.models) {
        void queryClient.invalidateQueries({
          queryKey: infrastructureKeys.models(projectId),
        });
      }
      if (extra?.taskId) {
        void queryClient.invalidateQueries({
          queryKey: infrastructureKeys.taskVms(extra.taskId),
        });
      }
    },
    [queryClient],
  );
}
