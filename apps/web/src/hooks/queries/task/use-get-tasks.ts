import { useState } from "react";
import { markBoardCacheChanged } from "@/lib/board-cache-version";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import getTasks from "@/fetchers/task/get-tasks";
import { ganttTasksKey } from "@/lib/gantt-query-keys";
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

export function useGetTasks(
  projectId: string,
  { refetchOnMount = true }: { refetchOnMount?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const [progress, setProgress] =
    useState<Awaited<ReturnType<typeof getTasks>>>();
  const query = useQuery({
    queryKey: ganttTasksKey(projectId),
    // The abort signal is deliberately not read or forwarded. TanStack Query
    // aborts a fetch whose signal was read when its last observer unmounts, so
    // a view that remounts while the first load of a large project is running
    // would abort it and start it again, over and over, and the cache would
    // stay empty. Left alone, the load finishes and fills the cache for
    // whichever view mounts next; a remount reuses the request that is already
    // running.
    queryFn: async () => {
      setProgress(undefined);
      markBoardCacheChanged(queryClient, projectId);
      const hasCachedBoard = !!queryClient.getQueryData(["tasks", projectId]);
      let invalidated = false;
      const unsubscribe = hasCachedBoard
        ? () => {}
        : queryClient.getQueryCache().subscribe((event) => {
            if (
              event.query.queryKey[0] !== "tasks" ||
              event.query.queryKey[1] !== projectId
            )
              return;
            if (event.type === "updated" && event.action.type === "invalidate")
              invalidated = true;
            if (
              event.type === "removed" ||
              (event.type === "updated" &&
                event.query.state.fetchStatus === "idle")
            ) {
              unsubscribe();
              if (
                invalidated &&
                event.type === "updated" &&
                event.action.type === "success"
              ) {
                queueMicrotask(() => {
                  if (!queryClient.getQueryData(["tasks", projectId])) return;
                  void queryClient.invalidateQueries({
                    queryKey: ["tasks", projectId],
                  });
                });
              }
            }
          });
      try {
        return await getTasks(projectId, undefined, (board) => {
          if (!hasCachedBoard) setProgress(board);
        });
      } catch (error) {
        unsubscribe();
        throw error;
      } finally {
        setProgress(undefined);
      }
    },
    refetchOnMount,
    refetchInterval: (query) =>
      isUnauthorizedError(query.state.error)
        ? false
        : SAFETY_NET_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: (query) => !isUnauthorizedError(query.state.error),
    enabled: !!projectId,
  });
  return {
    ...query,
    data: query.data ?? (query.isFetching ? progress : undefined),
  };
}
