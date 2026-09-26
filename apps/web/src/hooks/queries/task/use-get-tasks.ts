import { useQuery } from "@tanstack/react-query";
import getTasks from "@/fetchers/task/get-tasks";
import { isUnauthorizedError } from "@/lib/http-error";

// Task changes reach this query via `useProjectWebSocket`, which invalidates
// ["tasks", projectId] on every TASK_* and TASK_RELATION_UPDATED event, so a
// short poll here is redundant on any view where that hook is mounted
// (Gantt, board, backlog, calendar all live under project-layout.tsx).
// This interval is only a safety net for a missed event or a socket that is
// open but silently dead; the WebSocket itself now resumes and catches up on
// focus/online (see useProjectWebSocket). refetchOnWindowFocus recovers a tab
// that was backgrounded through such a gap the moment the user returns to it.
// Both back off while the session is unauthorized so an expired cookie does not
// spin on 401s.
export const SAFETY_NET_REFETCH_INTERVAL_MS = 5 * 60 * 1000;

export function useGetTasks(projectId: string) {
  return useQuery({
    queryKey: ["tasks", projectId],
    queryFn: ({ signal }) => getTasks(projectId, signal),
    refetchOnMount: true,
    refetchInterval: (query) =>
      isUnauthorizedError(query.state.error)
        ? false
        : SAFETY_NET_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: (query) => !isUnauthorizedError(query.state.error),
    enabled: !!projectId,
  });
}
