import { useQuery } from "@tanstack/react-query";
import getProjectTaskRelations from "@/fetchers/task-relation/get-project-task-relations";
import { isUnauthorizedError } from "@/lib/http-error";

function useGetProjectTaskRelations(projectId: string) {
  return useQuery({
    queryKey: ["task-relations", "project", projectId],
    queryFn: () => getProjectTaskRelations({ projectId }),
    // The Gantt draws dependency lines from this cache. Realtime keeps it fresh
    // via useProjectWebSocket, but recover it on focus too — symmetrically with
    // the task query — so a tab that missed events while the socket was down
    // doesn't show updated bars over stale dependency lines.
    refetchOnWindowFocus: (query) => !isUnauthorizedError(query.state.error),
    enabled: !!projectId,
  });
}

export default useGetProjectTaskRelations;
