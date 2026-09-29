import type { QueryClient } from "@tanstack/react-query";

// Everything an assignee change can show up in. Linking a resource moves task
// assignments in many projects at once (and the API publishes an assignee event
// per task), so the caches an ordinary assignee change refreshes for one task
// are refreshed by prefix for the workspace: task lists and details, projects
// (task counts), activity feeds, relations, the calendar, the portfolio, the
// search results and the workload.
export function invalidateAssigneeCaches(
  queryClient: QueryClient,
  workspaceId: string,
) {
  for (const queryKey of [
    ["workspace-resources", workspaceId],
    ["tasks"],
    ["task"],
    ["projects"],
    ["activities"],
    ["task-relations"],
    ["calendar", workspaceId],
    ["portfolio", workspaceId],
    ["search"],
    ["workload"],
    ["notifications"],
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
