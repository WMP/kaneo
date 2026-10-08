import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";

// Realtime events arrive in bursts (a bulk update publishes one event per
// task) and a reconnect asks for a catch-up refresh on top of that. Calling
// `invalidateQueries` for each of them is harmful for two reasons:
//
// 1. Its default `cancelRefetch: true` aborts a fetch that is already running
//    for a query that holds data and starts the same request again. A burst
//    turns one 500-task page load into a stream of aborted and restarted
//    requests, and the result may never be stored.
// 2. Every invalidation is a refetch, so N events cost N requests.
//
// This batcher collects the keys for one short window, invalidates each key
// once, and never cancels a running fetch. A query that is fetching when the
// window closes cannot simply be invalidated: the flag is cleared when that
// fetch succeeds, and the fetch may have started before the change that
// caused the event. Such a query is invalidated once, as soon as its fetch has
// settled, so a change made mid-fetch is still picked up, with one extra
// request at most.
export const INVALIDATION_COALESCE_MS = 250;

export type InvalidationBatcher = {
  invalidate: (queryKey: QueryKey) => void;
  /** Applies what is pending now and stops all timers and subscriptions. */
  dispose: () => void;
};

export function createInvalidationBatcher(
  queryClient: QueryClient,
  delayMs: number = INVALIDATION_COALESCE_MS,
): InvalidationBatcher {
  const pending = new Map<string, QueryKey>();
  const waiting = new Set<Query>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let disposed = false;

  function invalidateIdle(queryKey: QueryKey) {
    // `fetchStatus: "idle"` leaves a running fetch alone; `cancelRefetch:
    // false` keeps the one this call may start from replacing another.
    void queryClient.invalidateQueries(
      { queryKey, fetchStatus: "idle" },
      { cancelRefetch: false },
    );
  }

  function settleWaiting() {
    for (const query of waiting) {
      if (query.state.fetchStatus === "idle") {
        waiting.delete(query);
        invalidateIdle(query.queryKey);
      }
    }
    if (waiting.size === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  }

  function waitUntilIdle(query: Query) {
    waiting.add(query);
    unsubscribe ??= queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "removed") waiting.delete(event.query);
      settleWaiting();
    });
  }

  function apply(queryKey: QueryKey) {
    invalidateIdle(queryKey);
    if (disposed) return;
    for (const query of queryClient.getQueryCache().findAll({ queryKey })) {
      if (query.state.fetchStatus !== "idle") waitUntilIdle(query);
    }
  }

  function flush() {
    timer = null;
    const keys = [...pending.values()];
    pending.clear();
    for (const queryKey of keys) apply(queryKey);
  }

  return {
    invalidate(queryKey) {
      if (disposed) return;
      pending.set(JSON.stringify(queryKey), queryKey);
      timer ??= setTimeout(flush, delayMs);
    },
    dispose() {
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        flush();
      }
      waiting.clear();
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
