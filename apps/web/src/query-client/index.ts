import * as Sentry from "@sentry/react";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import {
  indicatesServerUnreachable,
  isConnectivityError,
} from "@/lib/connectivity";
import {
  HttpError,
  handleUnauthorized,
  isUnauthorizedError,
} from "@/lib/http-error";
import { useConnectivityStore } from "@/store/connectivity";

// A request that got no HTTP response (offline, server down, or a CORS
// rejection — the browser reports all three the same way). Used both to skip
// auto-retry and to tag the captured event so offline-tab reloads don't drown
// the queue. Matched on the browser's exact messages (see isConnectivityError):
// a substring check also caught API errors like HttpError(500, "Failed to fetch
// tasks"), where the server DID answer, and wrongly disabled their retries.
const isNetworkError = isConnectivityError;

// Feeds the connection banner (ConnectionStatusBanner) from every settled
// request: no response / a gateway error means the API is unreachable; any
// other HTTP answer (even an error status) proves it is reachable again.
function trackReachability(error: unknown) {
  const store = useConnectivityStore.getState();
  if (indicatesServerUnreachable(error)) {
    store.markServerUnreachable();
  } else if (error instanceof HttpError || isUnauthorizedError(error)) {
    store.markServerReachable();
  }
}

function markReachable() {
  useConnectivityStore.getState().markServerReachable();
}

// Cancellation surfaces as AbortError from the fetch signal and from TanStack's
// own query cancellation. Treat both as expected control flow, not a failure.
function isCancellationError(error: Error): boolean {
  return (
    error.name === "AbortError" ||
    error.message.toLowerCase().includes("aborted")
  );
}

// In-module cooldown so an offline tab doesn't fire one Sentry event per cache
// entry on every retry tick. Network-class only; API errors are not rate-limited.
const NETWORK_REPORT_COOLDOWN_MS = 60_000;
const networkErrorCooldowns = new Map<string, number>();

function captureCacheError(error: unknown, context: "query" | "mutation") {
  if (!(error instanceof Error)) return;
  if (isCancellationError(error)) return;

  const isNetwork = isNetworkError(error);
  const area = `${isNetwork ? "network" : "api"}.${context}`;

  if (isNetwork) {
    const dedupeKey = `${context}:${error.message}`;
    const lastSent = networkErrorCooldowns.get(dedupeKey);
    const now = Date.now();
    if (lastSent !== undefined && now - lastSent < NETWORK_REPORT_COOLDOWN_MS) {
      return;
    }
    networkErrorCooldowns.set(dedupeKey, now);
    // ponytail: hard cap with full clear; entries older than the cooldown are
    // useless to keep, and `error.message` can vary across fetchers/CORS
    // failures so the keyspace is unbounded in practice.
    if (networkErrorCooldowns.size > 50) networkErrorCooldowns.clear();
  }

  Sentry.captureException(error, { tags: { area } });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onSuccess: markReachable,
    onError: (error) => {
      trackReachability(error);
      if (isUnauthorizedError(error)) {
        // Keep the 401 in query state so polling guards stay stopped while
        // navigation completes. Better Auth's session is a separate store.
        handleUnauthorized();
        return;
      }
      captureCacheError(error, "query");
    },
  }),
  mutationCache: new MutationCache({
    onSuccess: markReachable,
    onError: (error) => {
      trackReachability(error);
      if (isUnauthorizedError(error)) {
        handleUnauthorized();
        return;
      }
      captureCacheError(error, "mutation");
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: (failureCount, error) =>
        isNetworkError(error) || isUnauthorizedError(error)
          ? false
          : failureCount < 2,
    },
    mutations: {
      retry: false,
    },
  },
});

export default queryClient;
