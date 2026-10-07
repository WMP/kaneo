import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { useProjectWebSocket } from "./use-project-websocket";

const { client, auth, getProjectAccess } = vi.hoisted(() => ({
  client: {
    invalidateQueries: vi.fn(),
    // Runs the query function like TanStack's fetchQuery would.
    fetchQuery: vi.fn(({ queryFn }: { queryFn: () => Promise<unknown> }) =>
      queryFn(),
    ),
  },
  auth: { userId: "user-a" as string | null },
  getProjectAccess: vi.fn(),
}));
vi.mock("@/fetchers/project/get-project-access", () => ({
  default: getProjectAccess,
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => client }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: auth.userId ? { user: { id: auth.userId } } : null,
    }),
  },
}));
vi.mock("@kaneo/libs", () => ({ windowId: "local-test" }));

class TestSocket {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event?: { code: number; reason?: string }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  // Deliberately delay close events to reproduce the project-switch race.
  close = vi.fn(() => {
    this.readyState = 3;
  });
  constructor(public url: string) {
    TestSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

const REVOKED = { code: 1008, reason: "Project access revoked" };

describe("project WebSocket lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubEnv("VITE_API_URL", "http://localhost:1337");
    TestSocket.instances = [];
    auth.userId = "user-a";
    client.invalidateQueries.mockClear();
    client.fetchQuery.mockClear();
    getProjectAccess.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("ignores late old-project events without stopping the new project's keepalive", () => {
    const { rerender, unmount } = renderHook(
      ({ id }) => useProjectWebSocket(id),
      { initialProps: { id: "project-a" } },
    );
    const old = TestSocket.instances[0];
    act(() => old.open());
    rerender({ id: "project-b" });
    const current = TestSocket.instances[1];
    act(() => {
      current.open();
      old.onclose?.();
      old.onopen?.();
      old.onmessage?.({
        data: JSON.stringify({
          type: "TASK_UPDATED",
          projectId: "project-a",
          taskId: "old-task",
        }),
      });
      vi.advanceTimersByTime(30_000);
    });
    expect(
      TestSocket.instances.map((socket) => new URL(socket.url).pathname),
    ).toEqual(["/api/ws/project-a", "/api/ws/project-b"]);
    expect(old.close).toHaveBeenCalledOnce();
    expect(old.send).not.toHaveBeenCalled();
    expect(current.send).toHaveBeenCalledWith('{"type":"ping"}');
    expect(client.invalidateQueries).not.toHaveBeenCalled();
    unmount();
    act(() => current.onclose?.());
    expect(current.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels scheduled reconnects on logout and starts a fresh connection on login", () => {
    const { rerender, unmount } = renderHook(() =>
      useProjectWebSocket("project-a"),
    );
    act(() => TestSocket.instances[0].onclose?.());
    expect(vi.getTimerCount()).toBe(1);
    auth.userId = null;
    rerender();
    act(() => vi.advanceTimersByTime(60_000));
    expect(TestSocket.instances).toHaveLength(1);
    auth.userId = "user-b";
    rerender();
    expect(TestSocket.instances).toHaveLength(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops reconnecting and reports a lost project when the socket closes with 1008 and access is refused", async () => {
    getProjectAccess.mockRejectedValue(new HttpError(403, "no access"));
    const onAccessRevoked = vi.fn();
    const { unmount } = renderHook(() =>
      useProjectWebSocket("project-a", { onAccessRevoked }),
    );
    await act(async () => {
      TestSocket.instances[0].onclose?.(REVOKED);
    });

    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["project-access", "project-a"],
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects"],
    });
    expect(getProjectAccess).toHaveBeenCalledWith("project-a");
    expect(onAccessRevoked).toHaveBeenCalledExactlyOnceWith({
      accessible: false,
    });
    // Reconnecting would only be refused again.
    act(() => vi.advanceTimersByTime(60_000));
    expect(TestSocket.instances).toHaveLength(1);
    unmount();
  });

  it("reconnects and reports a change when 1008 arrives but the project is still accessible", async () => {
    getProjectAccess.mockResolvedValue({
      mode: "member",
      role: "viewer",
      capabilities: {},
    });
    const onAccessRevoked = vi.fn();
    const { unmount } = renderHook(() =>
      useProjectWebSocket("project-a", { onAccessRevoked }),
    );
    await act(async () => {
      TestSocket.instances[0].onclose?.(REVOKED);
    });

    expect(onAccessRevoked).toHaveBeenCalledExactlyOnceWith({
      accessible: true,
    });
    act(() => vi.advanceTimersByTime(1_000));
    expect(TestSocket.instances).toHaveLength(2);
    unmount();
  });

  it("treats a failed access check as unknown and keeps the project open", async () => {
    getProjectAccess.mockRejectedValue(new HttpError(500, "boom"));
    const onAccessRevoked = vi.fn();
    const { unmount } = renderHook(() =>
      useProjectWebSocket("project-a", { onAccessRevoked }),
    );
    await act(async () => {
      TestSocket.instances[0].onclose?.(REVOKED);
    });
    expect(onAccessRevoked).toHaveBeenCalledExactlyOnceWith({
      accessible: true,
    });
    unmount();
  });

  it("does not report a revoked access after the hook unmounted", async () => {
    let finish: (value: unknown) => void = () => {};
    getProjectAccess.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onAccessRevoked = vi.fn();
    const { unmount } = renderHook(() =>
      useProjectWebSocket("project-a", { onAccessRevoked }),
    );
    act(() => {
      TestSocket.instances[0].onclose?.(REVOKED);
    });
    unmount();
    await act(async () => finish({}));
    expect(onAccessRevoked).not.toHaveBeenCalled();
  });

  it("keeps the ordinary backoff for another 1008 reason (credential revoked, project moved)", () => {
    const onAccessRevoked = vi.fn();
    const { unmount } = renderHook(() =>
      useProjectWebSocket("project-a", { onAccessRevoked }),
    );
    act(() =>
      TestSocket.instances[0].onclose?.({
        code: 1008,
        reason: "Project workspace changed",
      }),
    );
    act(() => vi.advanceTimersByTime(1_000));
    expect(TestSocket.instances).toHaveLength(2);
    expect(onAccessRevoked).not.toHaveBeenCalled();
    expect(getProjectAccess).not.toHaveBeenCalled();
    unmount();
  });

  it("leaves a signed-out caller to the auth flow: no toast, no reconnect", async () => {
    getProjectAccess.mockRejectedValue(new HttpError(401, "Unauthorized"));
    const onAccessRevoked = vi.fn();
    const { unmount } = renderHook(() =>
      useProjectWebSocket("project-a", { onAccessRevoked }),
    );
    await act(async () => {
      TestSocket.instances[0].onclose?.(REVOKED);
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(onAccessRevoked).not.toHaveBeenCalled();
    expect(TestSocket.instances).toHaveLength(1);
    unmount();
  });

  it("opens no socket from a focus or online signal while the access check is running", async () => {
    let finish: (value: unknown) => void = () => {};
    getProjectAccess.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { unmount } = renderHook(() =>
      useProjectWebSocket("project-a", { onAccessRevoked: vi.fn() }),
    );
    act(() => {
      TestSocket.instances[0].onclose?.(REVOKED);
    });
    act(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(TestSocket.instances).toHaveLength(1);

    // The check ends with access still there: a single reconnect follows.
    await act(async () =>
      finish({ mode: "member", role: "viewer", capabilities: {} }),
    );
    act(() => vi.advanceTimersByTime(1_000));
    expect(TestSocket.instances).toHaveLength(2);
    unmount();
  });

  it("does not reconnect from a focus signal after access was refused", async () => {
    getProjectAccess.mockRejectedValue(new HttpError(403, "no access"));
    const { unmount } = renderHook(() =>
      useProjectWebSocket("project-a", { onAccessRevoked: vi.fn() }),
    );
    await act(async () => {
      TestSocket.instances[0].onclose?.(REVOKED);
    });
    act(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(60_000);
    });
    expect(TestSocket.instances).toHaveLength(1);
    unmount();
  });

  it("keeps the ordinary backoff for a normal close code", () => {
    const onAccessRevoked = vi.fn();
    const { unmount } = renderHook(() =>
      useProjectWebSocket("project-a", { onAccessRevoked }),
    );
    act(() => TestSocket.instances[0].onclose?.({ code: 1006 }));
    act(() => vi.advanceTimersByTime(1_000));
    expect(TestSocket.instances).toHaveLength(2);
    expect(onAccessRevoked).not.toHaveBeenCalled();
    expect(getProjectAccess).not.toHaveBeenCalled();
    unmount();
  });

  it("refreshes project and task caches when the workspace changes", () => {
    renderHook(() => useProjectWebSocket("project-a"));
    act(() =>
      TestSocket.instances[0].onmessage?.({
        data: JSON.stringify({ type: "PROJECT_MOVED", projectId: "project-a" }),
      }),
    );
    for (const queryKey of [
      ["projects"],
      ["project", "project-a"],
      ["tasks", "project-a"],
      ["task"],
      ["task-relations"],
    ]) {
      expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey });
    }
  });

  it("preserves bounded exponential reconnects and active message invalidation", () => {
    const { unmount } = renderHook(() => useProjectWebSocket("project-a"));
    for (let retry = 0; retry < 5; retry++) {
      act(() => {
        TestSocket.instances.at(-1)?.onclose?.();
        vi.advanceTimersByTime(1000 * 2 ** retry);
      });
      expect(TestSocket.instances).toHaveLength(retry + 2);
    }
    const last = TestSocket.instances.at(-1);
    act(() => {
      last?.onmessage?.({
        data: JSON.stringify({
          type: "TASK_UPDATED",
          projectId: "project-a",
          taskId: "task-a",
        }),
      });
      last?.onclose?.();
      vi.advanceTimersByTime(60_000);
    });
    expect(TestSocket.instances).toHaveLength(6);
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["tasks", "project-a"],
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["task", "task-a"],
    });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("invalidates the project-scoped Gantt relations cache on TASK_RELATION_UPDATED", () => {
    renderHook(() => useProjectWebSocket("project-a"));
    act(() => TestSocket.instances[0].open());
    act(() => {
      TestSocket.instances[0].onmessage?.({
        data: JSON.stringify({
          type: "TASK_RELATION_UPDATED",
          projectId: "project-a",
          sourceTaskId: "task-1",
          targetTaskId: "task-2",
        }),
      });
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["task-relations", "project", "project-a"],
    });
    // The per-task keys the handler already covered must still fire too.
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["task-relations", "task-1"],
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["task-relations", "task-2"],
    });
  });
  it.each(["TASK_UPDATED", "TASK_CREATED", "TASK_DELETED", "TASK_MOVED"])(
    "invalidates the Gantt relations cache of the project on %s",
    (type) => {
      renderHook(() => useProjectWebSocket("project-a"));
      act(() => TestSocket.instances[0].open());
      act(() =>
        TestSocket.instances[0].onmessage?.({
          data: JSON.stringify({ type, projectId: "project-a", taskId: "t1" }),
        }),
      );
      expect(client.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["task-relations", "project", "project-a"],
      });
      expect(client.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["tasks", "project-a"],
      });
    },
  );

  it("does not refetch the Gantt relations cache for a comment", () => {
    renderHook(() => useProjectWebSocket("project-a"));
    act(() => TestSocket.instances[0].open());
    act(() =>
      TestSocket.instances[0].onmessage?.({
        data: JSON.stringify({
          type: "COMMENT_UPDATED",
          projectId: "project-a",
          taskId: "t1",
        }),
      }),
    );
    expect(client.invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ["task-relations", "project", "project-a"],
    });
  });

  it("refreshes every task-relations cache for an id-free relation event (a task of another project changed)", () => {
    renderHook(() => useProjectWebSocket("project-a"));
    act(() => TestSocket.instances[0].open());
    act(() =>
      TestSocket.instances[0].onmessage?.({
        data: JSON.stringify({
          type: "TASK_RELATION_UPDATED",
          projectId: "project-a",
          taskId: "",
        }),
      }),
    );
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["task-relations"],
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["task-relations", "project", "project-a"],
    });
  });
});
