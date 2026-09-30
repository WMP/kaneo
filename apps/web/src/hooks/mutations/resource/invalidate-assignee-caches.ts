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
// cached list: those projects' task lists, task details and activity feeds
// (matched through the project of the cached task), every cached relation list
// (per task and per project; their keys carry no workspace, and an entry only
// exists for something opened), and the workspace's project list (task counts),
// calendar, portfolio, search results and workload. Notifications are not
// touched: the person is not notified.
export function invalidateAssigneeCaches(
  queryClient: QueryClient,
  workspaceId: string,
  movedProjectIds: string[],
) {
  const moved = new Set(movedProjectIds);
  // The project of a task the client has a detail for; unknown when it has none.
  const projectOfTask = (taskId: unknown): string | undefined =>
    typeof taskId === "string"
      ? (
          queryClient.getQueryData(["task", taskId]) as
            | { projectId?: string }
            | undefined
        )?.projectId
      : undefined;

  for (const queryKey of [
    ["workspace-resources", workspaceId],
    ["projects", workspaceId],
    ["calendar", workspaceId],
    ["portfolio", workspaceId],
    ["task-relations"],
    ...movedProjectIds.map((projectId) => ["tasks", projectId]),
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
  // An activity feed is refreshed when its task is in a moved project, or when
  // the task's project is not known (then it is refreshed to be safe).
  void queryClient.invalidateQueries({
    predicate: ({ queryKey }) => {
      if (queryKey[0] !== "activities") return false;
      const project = projectOfTask(queryKey[1]);
      return project === undefined || moved.has(project);
    },
  });
  void queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === "search" &&
      (queryKey[1] as { workspaceId?: string } | undefined)?.workspaceId ===
        workspaceId,
  });
  invalidateWorkloadCaches(queryClient, workspaceId);
}
