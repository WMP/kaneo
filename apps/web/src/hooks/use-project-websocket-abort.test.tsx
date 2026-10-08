import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CATCH_UP_STABLE_MS,
  useProjectWebSocket,
} from "./use-project-websocket";

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-a" } } }) },
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
  close = vi.fn();
  constructor(public url: string) {
    TestSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(payload: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

// The Gantt's tasks query with data in the cache and a slow fetch in flight,
// as when the project is reopened. A real QueryClient: what matters is what
// TanStack does with the invalidations the socket asks for.
function seedTasksQuery(client: QueryClient) {
  const calls: { aborted: boolean }[] = [];
  client.setQueryData(["tasks", "project-a"], { columns: [] });
  const observer = new QueryObserver(client, {
    queryKey: ["tasks", "project-a"],
    staleTime: 0,
    queryFn: ({ signal }) =>
      new Promise((_resolve, reject) => {
        const call = { aborted: false };
        signal.addEventListener("abort", () => {
          call.aborted = true;
          reject(new Error("aborted"));
        });
        calls.push(call);
      }),
  });
  const unsubscribe = observer.subscribe(() => {});
  return { calls, unsubscribe };
}

describe("project socket and a running tasks fetch", () => {
  let client: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubEnv("VITE_API_URL", "http://localhost:1337");
    TestSocket.instances = [];
    client = new QueryClient();
  });
  afterEach(() => {
    cleanup();
    client.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("a burst of task events never aborts the fetch that is running", async () => {
    const { calls, unsubscribe } = seedTasksQuery(client);
    renderHook(() => useProjectWebSocket("project-a"), { wrapper });
    const socket = TestSocket.instances[0];
    act(() => socket.open());

    for (let i = 0; i < 20; i++) {
      act(() =>
        socket.message({
          type: "TASK_UPDATED",
          projectId: "project-a",
          taskId: `task-${i}`,
        }),
      );
      await act(() => vi.advanceTimersByTimeAsync(100));
    }

    expect(calls).toHaveLength(1);
    expect(calls.some((call) => call.aborted)).toBe(false);
    unsubscribe();
  });

  it("rapid open/close cycles of a restarting server cause no catch-up refetch", async () => {
    const { calls, unsubscribe } = seedTasksQuery(client);
    renderHook(() => useProjectWebSocket("project-a"), { wrapper });
    act(() => TestSocket.instances[0].open());
    // Every later socket opens and closes within a few hundred milliseconds.
    for (let i = 0; i < 6; i++) {
      act(() => TestSocket.instances.at(-1)?.onclose?.());
      await act(() => vi.advanceTimersByTimeAsync(1000));
      act(() => TestSocket.instances.at(-1)?.open());
      await act(() => vi.advanceTimersByTimeAsync(200));
    }
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(calls).toHaveLength(1);
    expect(calls.some((call) => call.aborted)).toBe(false);
    unsubscribe();
  });

  it("a reconnection that stays open catches up once, after the running fetch", async () => {
    const { calls, unsubscribe } = seedTasksQuery(client);
    renderHook(() => useProjectWebSocket("project-a"), { wrapper });
    act(() => TestSocket.instances[0].open());
    act(() => TestSocket.instances[0].onclose?.());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    act(() => TestSocket.instances[1].open());
    await act(() => vi.advanceTimersByTimeAsync(CATCH_UP_STABLE_MS + 300));

    // Still the first request: the catch-up waits for it instead of aborting it.
    expect(calls).toHaveLength(1);
    expect(calls[0].aborted).toBe(false);
    unsubscribe();
  });
});
