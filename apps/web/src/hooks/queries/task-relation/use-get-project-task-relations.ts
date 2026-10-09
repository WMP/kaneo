import { useQuery } from "@tanstack/react-query";
import getProjectTaskRelations from "@/fetchers/task-relation/get-project-task-relations";
import { SAFETY_NET_REFETCH_INTERVAL_MS } from "@/hooks/queries/task/use-get-tasks";
import { ganttProjectRelationsKey } from "@/lib/gantt-query-keys";
import { isUnauthorizedError } from "@/lib/http-error";

function useGetProjectTaskRelations(
  projectId: string,
  // False keeps the query idle (a details sheet reads it only while open).
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ganttProjectRelationsKey(projectId),
    queryFn: () => getProjectTaskRelations({ projectId }),
    // The Gantt draws dependency lines from this cache. Realtime keeps it fresh
    // via useProjectWebSocket, but recover it on focus too — symmetrically with
    // the task query — so a tab that missed events while the socket was down
    // doesn't show updated bars over stale dependency lines. The same safety-net
    // poll as the task query backs it up, so a silently-dead socket on a focused
    // tab doesn't leave updated bars drawn over stale dependency lines.
    refetchInterval: (query) =>
      isUnauthorizedError(query.state.error)
        ? false
        : SAFETY_NET_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: (query) => !isUnauthorizedError(query.state.error),
    // The app default is refetchOnMount: false, which would show this cache
    // as it was when the Gantt was last open (relations, or the dates and
    // estimate of an endpoint, edited meanwhile on a task page or in another
    // project). Refetch a stale or invalidated cache on every mount.
    refetchOnMount: true,
    enabled: !!projectId && (options.enabled ?? true),
  });
}

export default useGetProjectTaskRelations;
