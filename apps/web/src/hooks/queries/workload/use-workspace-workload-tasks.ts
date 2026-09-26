import { skipToken, useQuery } from "@tanstack/react-query";
import getWorkspaceWorkloadTasks from "@/fetchers/workload/get-workspace-workload-tasks";

type UseWorkspaceWorkloadTasksParams = {
  workspaceId: string | undefined;
  /** Inclusive start date (YYYY-MM-DD). */
  from: string;
  /** Inclusive end date (YYYY-MM-DD). */
  to: string;
  /** A user id, or the unassigned sentinel. Omit to skip the query. */
  assigneeId: string | undefined;
};

function useWorkspaceWorkloadTasks({
  workspaceId,
  from,
  to,
  assigneeId,
}: UseWorkspaceWorkloadTasksParams) {
  return useQuery({
    queryKey: ["workload-tasks", workspaceId, from, to, assigneeId],
    queryFn:
      workspaceId && assigneeId
        ? () => getWorkspaceWorkloadTasks({ workspaceId, from, to, assigneeId })
        : skipToken,
    staleTime: 60 * 1000,
  });
}

export default useWorkspaceWorkloadTasks;
