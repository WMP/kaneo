import { windowId } from "@kaneo/libs";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getApiUrl } from "@/fetchers/get-api-url";
import { authClient } from "@/lib/auth-client";
import { isUnauthorizedError } from "@/lib/http-error";
import {
  isProjectAccessDenied,
  projectAccessQueryKey,
  projectAccessQueryOptions,
} from "@/lib/project-access-query";

export function getWsUrl(projectId: string) {
  const base = getApiUrl("ws");
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}/${encodeURIComponent(projectId)}?windowId=${encodeURIComponent(windowId)}`;
}

const MAX_RETRIES = 5;
const BASE_DELAY = 1000; // 1 second

// Cloudflare closes idle WebSocket connections after 100 seconds of no traffic.
// We send a lightweight ping every 30 seconds to keep the connection alive.
const WS_PING_INTERVAL_MS = 30_000;

// The API closes a project socket with 1008 and this reason when the caller's
// access to the project ended or changed (`ACCESS_REVOKED_CLOSE_REASON` in
// `apps/api/src/ws/index.ts`). Other 1008 closes (the session or API key is no
// longer valid, the project moved to another workspace) are not this event and
// keep the ordinary reconnect.
export const PROJECT_ACCESS_REVOKED_CLOSE_CODE = 1008;
export const PROJECT_ACCESS_REVOKED_CLOSE_REASON = "Project access revoked";

export type ProjectAccessRevoked = {
  // False when the project can no longer be opened (403 on a fresh check).
  accessible: boolean;
};

export function useProjectWebSocket(
  projectId: string,
  options?: { onAccessRevoked?: (event: ProjectAccessRevoked) => void },
) {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  // Read through a ref so a new callback identity never reconnects the socket.
  const onAccessRevokedRef = useRef(options?.onAccessRevoked);
  onAccessRevokedRef.current = options?.onAccessRevoked;

  useEffect(() => {
    if (!projectId || !session?.user?.id) return;

    // Each effect owns its sockets and timers. Late events from an old project
    // or session must not alter the next effect's connection or reconnect it.
    let disposed = false;
    let activeSocket: WebSocket | null = null;
    let retries = 0;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let hasConnected = false;
    // What the last "access revoked" close decided. While a check is running,
    // or after it ended in a refusal (or a signed-out caller), nothing may open
    // another socket: not the backoff, not a focus or online signal.
    let revocation: "none" | "checking" | "denied" = "none";

    function clearPing() {
      if (pingInterval !== null) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
    }

    function connect() {
      if (disposed) return;
      retryTimeout = null;
      const url = getWsUrl(projectId);
      const ws = new WebSocket(url);
      activeSocket = ws;

      ws.onopen = () => {
        if (disposed || activeSocket !== ws) return;
        retries = 0; // Reset retries on successful connection
        // A reconnection (not the first open) may have missed events while the
        // socket was down, so refresh this project's task and relation caches to
        // catch up. The initial connect needs no refresh — the queries fetch on
        // mount — and this is what lets the realtime path, rather than a short
        // poll, keep the board fresh after a dropped connection.
        if (hasConnected) {
          queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
          queryClient.invalidateQueries({
            queryKey: ["task-relations", "project", projectId],
          });
        }
        hasConnected = true;
        // Start keepalive pings to prevent Cloudflare idle timeout (100s)
        clearPing();
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, WS_PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        if (disposed || activeSocket !== ws) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "PROJECT_MOVED") {
            for (const queryKey of [
              ["projects"],
              ["project", projectId],
              ["tasks", projectId],
              ["task"],
              ["task-relations"],
            ]) {
              queryClient.invalidateQueries({ queryKey });
            }
            return;
          }
          if (
            message.type === "TASK_UPDATED" ||
            message.type === "TASK_CREATED" ||
            message.type === "TASK_DELETED" ||
            message.type === "TASK_LABEL_UPDATED" ||
            message.type === "TASK_MOVED" ||
            message.type === "TASK_RELATION_UPDATED" ||
            message.type === "COMMENT_UPDATED" ||
            message.type === "PROJECT_UPDATED"
          ) {
            queryClient.invalidateQueries({
              queryKey: ["tasks", message.projectId],
            });

            if (message.type === "PROJECT_UPDATED") {
              queryClient.invalidateQueries({ queryKey: ["projects"] });
              // Workspace column enforcement (and any project column change)
              // publishes it: the project's columns and the enforced flag.
              queryClient.invalidateQueries({
                queryKey: ["columns", message.projectId],
              });
              queryClient.invalidateQueries({
                queryKey: ["workspace-columns"],
              });
              return;
            }

            if (message.type === "TASK_RELATION_UPDATED") {
              if (message.sourceTaskId) {
                queryClient.invalidateQueries({
                  queryKey: ["task", message.sourceTaskId],
                });
                queryClient.invalidateQueries({
                  queryKey: ["task-relations", message.sourceTaskId],
                });
              }
              if (message.targetTaskId) {
                queryClient.invalidateQueries({
                  queryKey: ["task", message.targetTaskId],
                });
                queryClient.invalidateQueries({
                  queryKey: ["task-relations", message.targetTaskId],
                });
              }
              if (!message.sourceTaskId && !message.targetTaskId) {
                queryClient.invalidateQueries({
                  queryKey: ["task-relations"],
                });
              }
              // The Gantt chart's dependency lines read a project-scoped cache
              // (["task-relations", "project", projectId]) that the per-task
              // keys above don't reach — a relation can be created or deleted
              // from a task in this project without either endpoint's task
              // being the one currently open on the Gantt view.
              queryClient.invalidateQueries({
                queryKey: ["task-relations", "project", message.projectId],
              });
            } else {
              queryClient.invalidateQueries({
                queryKey: ["task", message.taskId],
              });
            }

            if (message.type === "TASK_LABEL_UPDATED") {
              queryClient.invalidateQueries({
                queryKey: ["labels", message.taskId],
              });
            }

            if (message.type === "TASK_UPDATED" && message.taskId) {
              queryClient.invalidateQueries({
                queryKey: ["external-links", message.taskId],
              });
            }

            if (message.type === "COMMENT_UPDATED") {
              queryClient.invalidateQueries({
                queryKey: ["activities", message.taskId],
              });
              queryClient.invalidateQueries({
                queryKey: ["comments", message.taskId],
              });
            }
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = (event) => {
        if (disposed || activeSocket !== ws) return;
        clearPing();
        activeSocket = null;

        if (
          event?.code === PROJECT_ACCESS_REVOKED_CLOSE_CODE &&
          event.reason === PROJECT_ACCESS_REVOKED_CLOSE_REASON
        ) {
          void handleAccessRevoked();
          return;
        }
        scheduleReconnect();
      };
    }

    function scheduleReconnect() {
      if (disposed || revocation !== "none" || retries >= MAX_RETRIES) return;
      const delay = BASE_DELAY * 2 ** retries; // 1s, 2s, 4s, 8s, 16s
      retries += 1;
      retryTimeout = setTimeout(connect, delay);
    }

    // Access changed: drop the cached capabilities and project list, then ask
    // the API where the caller stands now. Still 200: the role changed, so
    // reconnect with the new access. 403: stop reconnecting (it would only be
    // refused again) and let the page leave the project.
    async function handleAccessRevoked() {
      revocation = "checking";
      queryClient.invalidateQueries({
        queryKey: projectAccessQueryKey(projectId),
      });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      let accessible = true;
      try {
        await queryClient.fetchQuery({
          ...projectAccessQueryOptions(projectId, session?.user?.id),
          staleTime: 0,
        });
      } catch (error) {
        if (isUnauthorizedError(error)) {
          // Signed out: the auth flow takes over. No toast, no reconnect loop.
          revocation = "denied";
          return;
        }
        // Anything but a refusal (network, 5xx) says nothing about access:
        // keep the project open and reconnect.
        accessible = !isProjectAccessDenied(error);
      }
      if (disposed) return;
      revocation = accessible ? "none" : "denied";
      onAccessRevokedRef.current?.({ accessible });
      if (accessible) scheduleReconnect();
    }
    connect();

    // A long outage (sleep, lost network) can exhaust the retry budget and leave
    // the socket permanently closed, which would strand the board on the poll's
    // safety-net interval. When the tab regains focus or the network returns,
    // reconnect if the socket has dropped. A focus/online signal is a stronger
    // cue that connectivity is back than the current backoff timer, so cancel a
    // pending retry and reconnect now rather than waiting out the backoff (which
    // can be up to ~16s away); clearing the timer keeps it from later firing a
    // second, duplicate connect.
    function resumeIfDropped() {
      const live =
        activeSocket !== null &&
        (activeSocket.readyState === WebSocket.OPEN ||
          activeSocket.readyState === WebSocket.CONNECTING);
      if (disposed || live || revocation !== "none") return;
      if (retryTimeout !== null) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
      retries = 0;
      connect();
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") resumeIfDropped();
    }
    window.addEventListener("online", resumeIfDropped);
    window.addEventListener("focus", resumeIfDropped);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      clearPing();
      if (retryTimeout !== null) {
        clearTimeout(retryTimeout);
      }
      window.removeEventListener("online", resumeIfDropped);
      window.removeEventListener("focus", resumeIfDropped);
      document.removeEventListener("visibilitychange", handleVisibility);
      activeSocket?.close();
    };
  }, [projectId, session?.user?.id, queryClient]);
}
