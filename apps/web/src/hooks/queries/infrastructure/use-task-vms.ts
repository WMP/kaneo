import { useQuery } from "@tanstack/react-query";
import getTaskVms from "@/fetchers/infrastructure/get-task-vms";
import {
  INFRASTRUCTURE_STALE_TIME,
  infrastructureKeys,
} from "@/lib/infrastructure-keys";

function useTaskVms(taskId: string, enabled = true) {
  return useQuery({
    queryKey: infrastructureKeys.taskVms(taskId),
    queryFn: () => getTaskVms(taskId),
    enabled: enabled && !!taskId,
    staleTime: INFRASTRUCTURE_STALE_TIME,
    refetchOnMount: "always",
  });
}

export default useTaskVms;
