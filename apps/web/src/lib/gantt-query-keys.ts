import type { QueryClient } from "@tanstack/react-query";

// Single source of truth for the TanStack Query keys the Gantt view reads, so
// the queries, the mutations that invalidate them and the realtime handler
// cannot drift apart.
//
// The Gantt route reads:
//   - ganttTasksKey(projectId)             the project's own tasks
//   - ganttProjectRelationsKey(projectId)  the project's relations, with the
//                                          summary (dates, estimate, status,
//                                          title) of BOTH endpoints, including
//                                          endpoints in other projects of the
//                                          workspace
//   - ganttCalendarKey(workspaceId)        working days and holidays
//   - ganttTaskRelationsKey(taskId)        per-task relations (gate warnings)
export const ganttTasksKey = (projectId: string) =>
  ["tasks", projectId] as const;

export const ganttProjectRelationsKey = (projectId: string) =>
  ["task-relations", "project", projectId] as const;

// Prefix that matches the project-scoped relations cache of EVERY project.
export const ganttAllProjectRelationsKey = () =>
  ["task-relations", "project"] as const;

export const ganttTaskRelationsKey = (taskId: string) =>
  ["task-relations", taskId] as const;

export const ganttCalendarKey = (workspaceId: string | undefined) =>
  ["calendar", workspaceId] as const;

// A task change (dates, estimate, status, title, milestone, move, delete) can
// alter how the task is drawn on ANOTHER project's Gantt, where it is a
// cross-project relation endpoint shown from the relation summary. Which
// projects relate to the task is not known on the client, so every project's
// relations cache is invalidated. Only mounted Gantt views refetch; the rest
// are marked stale and refetch on their next mount (their query sets
// refetchOnMount).
export function invalidateGanttRelations(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: ganttAllProjectRelationsKey(),
  });
}
