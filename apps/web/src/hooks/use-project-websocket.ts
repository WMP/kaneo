import { applyBoardReorder } from "@/components/kanban-board/apply-reorder";
import {
  getBoardCacheVersion,
  markBoardCacheChanged,
} from "@/lib/board-cache-version";
import { windowId } from "@kaneo/libs";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { getApiUrl } from "@/fetchers/get-api-url";
import { authClient } from "@/lib/auth-client";
import { createInvalidationBatcher } from "@/lib/coalesced-invalidation";
import {
  ganttProjectRelationsKey,
  ganttTaskRelationsKey,
  ganttTasksKey,
} from "@/lib/gantt-query-keys";
import { isUnauthorizedError } from "@/lib/http-error";
import {
  isProjectAccessDenied,
  projectAccessQueryKey,
  projectAccessQueryOptions,
} from "@/lib/project-access-query";
import getTask from "@/fetchers/task/get-task";
import getLabelsByTask from "@/fetchers/label/get-labels-by-task";
import getExternalLinks from "@/fetchers/external-link/get-external-links";
import type { ResumePreview } from "@/fetchers/integration-sync/types";
import { patchBoardTask } from "@/lib/patch-board-task";
import type { ProjectWithTasks } from "@/types/project";
import {
  hasSyncTaskSample,
  patchSyncTaskTitles,
} from "@/lib/patch-sync-task-titles";

export function getWsUrl(projectId: string) {
  const base = getApiUrl("ws");
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}/${encodeURIComponent(projectId)}?windowId=${encodeURIComponent(windowId)}`;
}

const MAX_RETRIES = 5;
const BASE_DELAY = 1000; // 1 second

// A reconnection refreshes the caches only after the socket stayed open this
// long. A server that is restarting can accept the upgrade and close it again
// at once; every such open used to start a catch-up refetch of the whole task
// list. The refresh is not lost: the open that lasts runs it.
export const CATCH_UP_STABLE_MS = 1000;

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
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  // Read through a ref so a new callback identity never reconnects the socket.
  const onAccessRevokedRef = useRef(options?.onAccessRevoked);
  onAccessRevokedRef.current = options?.onAccessRevoked;

  useEffect(() => {
    if (!projectId || !session?.user?.id) return;

    // Each effect owns its sockets and timers. Late events from an old project
    // or session must not alter the next effect's connection or reconnect it.
    let disposed = false;
    let needsReconcile = false;
    let flushQueued = false;
    const taskVersions = new Map<string, number>();
    const titleVersions = new Map<string, number>();
    const refreshingTasks = new Set<string>();
    let burstReconcileTimer: ReturnType<typeof setTimeout> | null = null;
    function reconcileBurst() {
      if (burstReconcileTimer !== null) clearTimeout(burstReconcileTimer);
      else markBoardCacheChanged(queryClient, projectId);
      burstReconcileTimer = setTimeout(() => {
        burstReconcileTimer = null;
        if (disposed) return;
        needsReconcile = true;
        flushPending();
      }, 200);
    }
    const pendingMessages = new Map<string, string>();
    let activeSocket: WebSocket | null = null;
    let retries = 0;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let healthyTimeout: ReturnType<typeof setTimeout> | null = null;
    let requestSequence = 0;
    const parentCountVersions = new Map<string, number>();
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let hasConnected = false;
    let catchUpTimeout: ReturnType<typeof setTimeout> | null = null;
    // Every cache refresh driven by a socket message or a reconnection goes
    // through this batcher: one refetch per key per window, and never an abort
    // of a fetch that is already running (see coalesced-invalidation.ts).
    const batcher = createInvalidationBatcher(queryClient);
    const invalidate = (queryKey: readonly unknown[]) =>
      batcher.invalidate(queryKey);

    function clearCatchUp() {
      if (catchUpTimeout !== null) {
        clearTimeout(catchUpTimeout);
        catchUpTimeout = null;
      }
    }
    // What the last "access revoked" close decided. While a check is running,
    // or after it ended in a refusal (or a signed-out caller), nothing may open
    // another socket: not the backoff, not a focus or online signal.
    let revocation: "none" | "checking" | "denied" = "none";
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;

    function invalidateDetails(message: {
      type: string;
      taskId?: string;
      sourceTaskId?: string;
      targetTaskId?: string;
      linksChanged?: boolean;
    }) {
      if (["PROJECT_UPDATED", "TASK_LABEL_UPDATED"].includes(message.type)) {
        invalidate(["integration-sync", projectId]);
        invalidate(["integration-sync-preview", projectId]);
      }
      if (message.type === "PROJECT_UPDATED") {
        invalidate(["projects"]);
        invalidate(["labels"]);
        // Workspace column enforcement (and any project column change)
        // publishes it: the project's columns and the enforced flag.
        invalidate(["columns", projectId]);
        invalidate(["workspace-columns"]);
        if (message.linksChanged) invalidate(["external-links"]);
        return;
      }

      if (message.type === "TASK_RELATION_UPDATED") {
        if (message.sourceTaskId) {
          invalidate(["task", message.sourceTaskId]);
          invalidate(ganttTaskRelationsKey(message.sourceTaskId));
        }
        if (message.targetTaskId) {
          invalidate(["task", message.targetTaskId]);
          invalidate(ganttTaskRelationsKey(message.targetTaskId));
        }
        if (!message.sourceTaskId && !message.targetTaskId) {
          invalidate(["task-relations"]);
        }
        // The Gantt chart's dependency lines read a project-scoped cache
        // (["task-relations", "project", projectId]) that the per-task
        // keys above don't reach: a relation can be created or deleted
        // from a task in this project without either endpoint's task
        // being the one currently open on the Gantt view.
        invalidate(ganttProjectRelationsKey(projectId));
      } else {
        if (
          message.type === "TASK_UPDATED" ||
          message.type === "TASK_CREATED" ||
          message.type === "TASK_DELETED" ||
          message.type === "TASK_MOVED"
        ) {
          // The Gantt's relation summaries carry each endpoint's dates,
          // estimate, status and title, and the same cache holds this
          // project's own tasks as endpoints, so a change to one of them
          // (made elsewhere) must refresh it as well as the task list.
          // For a task of ANOTHER project that is an endpoint here, the
          // API sends this project a TASK_RELATION_UPDATED without ids
          // (handled above); nothing about that task is sent or read here.
          invalidate(ganttProjectRelationsKey(projectId));
        }
        invalidate(["task", message.taskId]);
      }

      if (message.type === "TASK_LABEL_UPDATED") {
        invalidate(["labels", message.taskId]);
      }

      if (
        (message.type === "TASK_UPDATED" || message.type === "TASK_MOVED") &&
        message.taskId
      ) {
        invalidate(["external-links", message.taskId]);
      }

      if (message.type === "TASK_UPDATED" && message.taskId) {
        // jira.* events (a status seen in Jira, a link, a resolved
        // proposal) arrive as TASK_UPDATED. Only a mounted query is
        // refetched, so this costs nothing for a task without Jira. The
        // activity feed gets the entry the change wrote.
        invalidate(["jira-task", message.taskId]);
        invalidate(["activities", message.taskId]);
      }

      if (message.type === "COMMENT_UPDATED") {
        invalidate(["activities", message.taskId]);
        invalidate(["comments", message.taskId]);
      }
    }

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
        // The first open reconciles the board once, for changes made between
        // the initial fetch and the socket becoming ready. A reconnection may
        // have missed events while the socket was down, so it refreshes this
        // project's task and relation caches to catch up, but only once the
        // socket stayed open for a while (a restarting server accepts the
        // upgrade and closes it again at once). This is what lets the realtime
        // path, rather than a short poll, keep the board fresh after a dropped
        // connection.
        if (!hasConnected) {
          needsReconcile = true;
        } else {
          clearCatchUp();
          catchUpTimeout = setTimeout(() => {
            catchUpTimeout = null;
            if (disposed || activeSocket !== ws) return;
            needsReconcile = true;
            flushPending();
            invalidate(ganttProjectRelationsKey(projectId));
          }, CATCH_UP_STABLE_MS);
        }
        hasConnected = true;
        flushPending();
        // The backoff resets only after the connection proved healthy: a
        // server that accepts and drops sockets must not restart it.
        if (healthyTimeout !== null) clearTimeout(healthyTimeout);
        healthyTimeout = setTimeout(() => {
          healthyTimeout = null;
          if (disposed || activeSocket !== ws) return;
          retries = 0;
          if (fallbackInterval !== null) {
            clearInterval(fallbackInterval);
            fallbackInterval = null;
          }
        }, WS_PING_INTERVAL_MS);
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
          if (message.type === "PROJECT_MEMBERS_UPDATED") {
            void queryClient.invalidateQueries({
              predicate: (query) =>
                query.queryKey[0] === "workspace-users" &&
                query.queryKey[2] === "project" &&
                query.queryKey[3] === projectId,
            });
            return;
          }
          if (
            message.taskId &&
            [
              "TASK_UPDATED",
              "TASK_LABEL_UPDATED",
              "TASK_MOVED",
              "TASK_DELETED",
            ].includes(message.type)
          )
            // An open comparison needs a fresh token; other tasks and closed
            // dialogs must not cause provider reads during routine edits.
            for (const query of queryClient.getQueryCache().findAll({
              queryKey: ["integration-sync-review", projectId],
              type: "active",
            })) {
              const review = query.state.data as ResumePreview | undefined;
              if ((review?.task.id ?? query.meta?.taskId) !== message.taskId)
                continue;
              const filters = { queryKey: query.queryKey, exact: true };
              // Invalidation reuses an initial fetch with no data. Reset it so
              // a pre-edit snapshot cannot become the first displayed token.
              if (!review) void queryClient.resetQueries(filters);
              else void queryClient.invalidateQueries(filters);
            }
          let titleTaskRequest: ReturnType<typeof getTask> | undefined;
          if (
            message.taskId &&
            message.taskTitleChanged &&
            hasSyncTaskSample(queryClient, projectId, message.taskId)
          ) {
            const taskId = message.taskId as string;
            const version = (titleVersions.get(taskId) ?? 0) + 1;
            titleVersions.set(taskId, version);
            // Read titles through the task API, which enforces task-read permission.
            titleTaskRequest = getTask(taskId, "board");
            void titleTaskRequest
              .then((task) => {
                if (
                  !disposed &&
                  activeSocket === ws &&
                  titleVersions.get(taskId) === version &&
                  task.projectId === projectId
                )
                  patchSyncTaskTitles(
                    queryClient,
                    projectId,
                    taskId,
                    task.title,
                  );
              })
              .catch(() => {});
          }
          if (
            ["TASK_CREATED", "TASK_DELETED", "TASK_MOVED"].includes(
              message.type,
            )
          ) {
            invalidate(["integration-sync", projectId]);
            invalidate(["integration-sync-preview", projectId]);
          }
          if (message.type === "PROJECT_MOVED") {
            markBoardCacheChanged(queryClient, projectId);
            for (const queryKey of [
              ["projects"],
              ["project", projectId],
              ["tasks", projectId],
              ["task"],
              ["task-relations"],
              ["external-links"],
            ]) {
              invalidate(queryKey);
            }
            return;
          }
          const boardIsLoading =
            queryClient.getQueryState(["tasks", projectId])?.fetchStatus ===
            "fetching";
          if (boardIsLoading) {
            if (
              [
                "TASK_CREATED",
                "TASK_DELETED",
                "TASK_MOVED",
                "TASKS_REORDERED",
              ].includes(message.type)
            ) {
              // Offset pages can skip unrelated boundary tasks when membership
              // or positions change. Reconcile after this fetch completes.
              needsReconcile = true;
              markBoardCacheChanged(queryClient, projectId);
              const ids =
                message.type === "TASKS_REORDERED"
                  ? Array.isArray(message.tasks)
                    ? message.tasks.map((task: { id: string }) => task.id)
                    : []
                  : message.taskId
                    ? [message.taskId]
                    : [];
              for (const id of ids) {
                invalidate(["task", id]);
                if (message.type === "TASK_MOVED")
                  invalidate(["external-links", id]);
              }
              return;
            }
            pendingMessages.set(
              `${message.type}:${message.taskId ?? ""}:${message.sourceTaskId ?? ""}:${message.targetTaskId ?? ""}`,
              event.data,
            );
            return;
          }
          if (message.type === "TASKS_REORDERED") {
            for (const change of Array.isArray(message.tasks)
              ? message.tasks
              : []) {
              invalidate(["task", change.id]);
              taskVersions.set(
                change.id,
                (taskVersions.get(change.id) ?? 0) + 1,
              );
              markBoardCacheChanged(queryClient, projectId, change.id);
            }
            const board = queryClient.getQueryData<ProjectWithTasks>([
              "tasks",
              projectId,
            ]);
            if (!board || !Array.isArray(message.tasks)) {
              invalidate(ganttTasksKey(projectId));
              return;
            }
            const knownTasks = new Set([
              ...board.columns.flatMap((column) =>
                column.tasks.map((task) => task.id),
              ),
              ...board.plannedTasks.map((task) => task.id),
              ...board.archivedTasks.map((task) => task.id),
            ]);
            const statuses = new Set([
              "planned",
              "archived",
              ...board.columns.map((column) => column.slug),
            ]);
            if (
              message.tasks.some(
                (change: { id: string; status?: string }) =>
                  !knownTasks.has(change.id) ||
                  (change.status && !statuses.has(change.status)),
              )
            ) {
              markBoardCacheChanged(queryClient, projectId);
              invalidate(ganttTasksKey(projectId));
            }
            queryClient.setQueryData(
              ["tasks", projectId],
              applyBoardReorder(board, message.tasks),
            );
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
            if (
              message.type === "PROJECT_UPDATED" ||
              message.type === "TASK_RELATION_UPDATED"
            ) {
              markBoardCacheChanged(queryClient, projectId);
              invalidate(ganttTasksKey(projectId));
            } else if (!message.taskId && message.type !== "COMMENT_UPDATED") {
              markBoardCacheChanged(queryClient, projectId);
              invalidate(ganttTasksKey(projectId));
            } else if (message.taskId && message.type !== "COMMENT_UPDATED") {
              const taskId = message.taskId as string;
              const sequence = ++requestSequence;
              const version = (taskVersions.get(taskId) ?? 0) + 1;
              taskVersions.set(taskId, version);
              markBoardCacheChanged(queryClient, projectId, taskId);
              const boardVersion = getBoardCacheVersion(
                queryClient,
                projectId,
                taskId,
              );
              if (message.type === "TASK_DELETED") {
                queryClient.setQueryData<ProjectWithTasks>(
                  ["tasks", projectId],
                  (board) =>
                    board ? (patchBoardTask(board, taskId) ?? board) : board,
                );
              } else if (!queryClient.getQueryData(["tasks", projectId])) {
                // Calendar, backlog and detail-only views have no board to
                // patch. Their active detail queries are invalidated below.
              } else if (
                refreshingTasks.size >= 4 ||
                refreshingTasks.has(taskId) ||
                burstReconcileTimer !== null
              ) {
                reconcileBurst();
              } else {
                refreshingTasks.add(taskId);
                void Promise.all([
                  titleTaskRequest ?? getTask(taskId, "board"),
                  getLabelsByTask({ taskId }),
                  getExternalLinks(taskId),
                ])
                  .then(([task, labels, externalLinks]) => {
                    if (
                      disposed ||
                      activeSocket !== ws ||
                      taskVersions.get(taskId) !== version
                    )
                      return;
                    if (
                      getBoardCacheVersion(queryClient, projectId, taskId) !==
                      boardVersion
                    ) {
                      invalidate(ganttTasksKey(projectId));
                      return;
                    }
                    const staleOwnCounts =
                      (parentCountVersions.get(taskId) ?? 0) > sequence;
                    if (task.projectId === projectId)
                      patchSyncTaskTitles(
                        queryClient,
                        projectId,
                        taskId,
                        task.title,
                      );
                    const { subtaskCounts, ...taskFields } = task;
                    if (staleOwnCounts) invalidate(ganttTasksKey(projectId));
                    else parentCountVersions.set(taskId, sequence);
                    queryClient.setQueryData<ProjectWithTasks>(
                      ["tasks", projectId],
                      (board) =>
                        board
                          ? (patchBoardTask(board, taskId, {
                              ...taskFields,
                              ...(!staleOwnCounts ? { subtaskCounts } : {}),
                              labels,
                              externalLinks: externalLinks.map((link) => ({
                                ...link,
                                metadata:
                                  link.metadata &&
                                  typeof link.metadata === "object" &&
                                  !Array.isArray(link.metadata)
                                    ? link.metadata
                                    : null,
                              })),
                            }) ?? board)
                          : board,
                    );
                    for (const progress of task.parentSubtaskCounts ?? []) {
                      if (
                        (parentCountVersions.get(progress.taskId) ?? 0) >
                        sequence
                      ) {
                        invalidate(ganttTasksKey(projectId));
                        continue;
                      }
                      parentCountVersions.set(progress.taskId, sequence);
                      queryClient.setQueryData<ProjectWithTasks>(
                        ["tasks", projectId],
                        (board) =>
                          board
                            ? (patchBoardTask(board, progress.taskId, {
                                projectId,
                                subtaskCounts: {
                                  completed: progress.completed,
                                  total: progress.total,
                                },
                              }) ?? board)
                            : board,
                      );
                    }
                  })
                  .catch(() => {
                    if (
                      !disposed &&
                      activeSocket === ws &&
                      taskVersions.get(taskId) === version
                    )
                      invalidate(ganttTasksKey(projectId));
                  })
                  .finally(() => refreshingTasks.delete(taskId));
              }
            }

            invalidateDetails(message);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = (event) => {
        if (disposed || activeSocket !== ws) return;
        clearPing();
        clearCatchUp();
        if (healthyTimeout !== null) {
          clearTimeout(healthyTimeout);
          healthyTimeout = null;
        }
        activeSocket = null;

        if (
          event?.code === 1008 &&
          event.reason === "Workspace access revoked"
        ) {
          disposed = true;
          void queryClient.cancelQueries();
          queryClient.clear();
          void navigate({ to: "/dashboard" });
          return;
        }

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
      if (disposed || revocation !== "none") return;
      if (retries < MAX_RETRIES) {
        const delay = BASE_DELAY * 2 ** retries; // 1s, 2s, 4s, 8s, 16s
        retries += 1;
        retryTimeout = setTimeout(connect, delay);
      } else if (fallbackInterval === null) {
        // Refresh only when realtime delivery could not reconnect.
        fallbackInterval = setInterval(() => {
          invalidate(ganttTasksKey(projectId));
        }, 30_000);
        flushPending();
      }
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
    function flushPending() {
      if (
        disposed ||
        flushQueued ||
        queryClient.getQueryState(["tasks", projectId])?.fetchStatus ===
          "fetching"
      )
        return;
      flushQueued = true;
      queueMicrotask(() => {
        flushQueued = false;
        if (
          disposed ||
          (!activeSocket && fallbackInterval === null) ||
          queryClient.getQueryState(["tasks", projectId])?.fetchStatus ===
            "fetching"
        )
          return;
        if (needsReconcile) {
          needsReconcile = false;
          markBoardCacheChanged(queryClient, projectId);
          invalidate(ganttTasksKey(projectId));
        }
        const messages = Array.from(pendingMessages.values());
        pendingMessages.clear();
        for (const data of messages) {
          if (activeSocket)
            activeSocket.onmessage?.(new MessageEvent("message", { data }));
          else {
            // Fallback polling repairs the board; queued detail events still
            // need to refresh their own caches after pagination finishes.
            try {
              invalidateDetails(JSON.parse(data));
            } catch {
              /* Malformed message. */
            }
          }
        }
      });
    }
    const unsubscribe = queryClient.getQueryCache().subscribe(({ query }) => {
      if (
        query.queryKey[0] === "tasks" &&
        query.queryKey[1] === projectId &&
        query.state.fetchStatus === "idle"
      )
        flushPending();
    });

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
      unsubscribe();
      if (healthyTimeout !== null) clearTimeout(healthyTimeout);
      pendingMessages.clear();
      if (burstReconcileTimer !== null) clearTimeout(burstReconcileTimer);
      disposed = true;
      clearPing();
      clearCatchUp();
      batcher.dispose();
      if (fallbackInterval !== null) clearInterval(fallbackInterval);
      if (retryTimeout !== null) {
        clearTimeout(retryTimeout);
      }
      window.removeEventListener("online", resumeIfDropped);
      window.removeEventListener("focus", resumeIfDropped);
      document.removeEventListener("visibilitychange", handleVisibility);
      activeSocket?.close();
    };
  }, [projectId, session?.user?.id, queryClient, navigate]);
}
