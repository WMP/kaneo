import type { QueryClient } from "@tanstack/react-query";

// The workload views of a workspace: linking or unlinking a resource changes
// whose row a person resource counts in.
export function invalidateWorkloadCaches(
  queryClient: QueryClient,
  workspaceId: string,
) {
  for (const queryKey of [
    ["workload", workspaceId],
    ["workload-tasks", workspaceId],
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

// Everything a link can change, scoped to the workspace and to the projects
// whose tasks moved (`movedProjectIds` of the link response), not to every
// cached list: those projects' task lists and task details (matched by the
// project of the cached task), their relations, and the workspace's project
// list (task counts), calendar, portfolio, search results and workload. Open
// project views also get an assignee event per task over the WebSocket, and
// activity feeds refetch when they are opened again, so they are not swept here.
export function invalidateAssigneeCaches(
  queryClient: QueryClient,
  workspaceId: string,
  movedProjectIds: string[],
) {
  const moved = new Set(movedProjectIds);
  for (const queryKey of [
    ["workspace-resources", workspaceId],
    ["projects", workspaceId],
    ["calendar", workspaceId],
    ["portfolio", workspaceId],
    ...movedProjectIds.flatMap((projectId) => [
      ["tasks", projectId],
      ["task-relations", "project", projectId],
    ]),
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
  void queryClient.invalidateQueries({
    predicate: ({ queryKey, state }) =>
      queryKey[0] === "task" &&
      moved.has(
        (state.data as { projectId?: string } | undefined)?.projectId ?? "",
      ),
  });
  void queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === "search" &&
      (queryKey[1] as { workspaceId?: string } | undefined)?.workspaceId ===
        workspaceId,
  });
  invalidateWorkloadCaches(queryClient, workspaceId);
}
