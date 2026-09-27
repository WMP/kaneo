import { skipToken, useQuery } from "@tanstack/react-query";
import getWorkspaceWorkload from "@/fetchers/workload/get-workspace-workload";

type UseWorkspaceWorkloadParams = {
  workspaceId: string | undefined;
  /** Inclusive start date (YYYY-MM-DD). */
  from: string;
  /** Inclusive end date (YYYY-MM-DD). */
  to: string;
  /** Restrict to a single project; omit/undefined for the whole workspace. */
  projectId?: string;
};

function useWorkspaceWorkload({
  workspaceId,
  from,
  to,
  projectId,
}: UseWorkspaceWorkloadParams) {
  return useQuery({
    queryKey: ["workload", workspaceId, from, to, projectId ?? null],
    queryFn: workspaceId
      ? () => getWorkspaceWorkload({ workspaceId, from, to, projectId })
      : skipToken,
    staleTime: 60 * 1000,
  });
}

export default useWorkspaceWorkload;
