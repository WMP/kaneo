import { skipToken, useQuery } from "@tanstack/react-query";
import getWorkspaceWorkload from "@/fetchers/workload/get-workspace-workload";

type UseWorkspaceWorkloadParams = {
  workspaceId: string | undefined;
  /** Inclusive start date (YYYY-MM-DD). */
  from: string;
  /** Inclusive end date (YYYY-MM-DD). */
  to: string;
};

function useWorkspaceWorkload({
  workspaceId,
  from,
  to,
}: UseWorkspaceWorkloadParams) {
  return useQuery({
    queryKey: ["workload", workspaceId, from, to],
    queryFn: workspaceId
      ? () => getWorkspaceWorkload({ workspaceId, from, to })
      : skipToken,
    staleTime: 60 * 1000,
  });
}

export default useWorkspaceWorkload;
