import type { QueryObserverOptions } from "@tanstack/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import queryClientSingleton from "@/query-client";
import useGetPublicProject from "../project/use-get-public-project";
import { useGetTasks } from "./use-get-tasks";

// The query cache stores an internal `QueryOptions` shape that doesn't carry
// observer-only fields like `refetchInterval`/`refetchOnWindowFocus`, even
// though `useQuery` accepts and forwards them. Read the query back through
// this wider type to assert on them.
type ObserverOptions = QueryObserverOptions<unknown, Error, unknown, unknown>;

const getTasks = vi.hoisted(() => vi.fn());
const getPublicProject = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/task/get-tasks", () => ({ default: getTasks }));
vi.mock("@/fetchers/project/get-public-project", () => ({
  default: getPublicProject,
}));

afterEach(() => {
  cleanup();
  getTasks.mockReset();
  getPublicProject.mockReset();
});

describe("useGetTasks polling", () => {
  let client: QueryClient;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    client.clear();
  });

  it("polls only as a long safety net, relying on the WebSocket for realtime updates", async () => {
    getTasks.mockResolvedValue({ columns: [] } as never);
    renderHook(() => useGetTasks("project"), { wrapper: Wrapper });

    await waitFor(() =>
      expect(client.getQueryState(["tasks", "project"])?.status).toBe(
        "success",
      ),
    );

    const query = client
      .getQueryCache()
      .find({ queryKey: ["tasks", "project"] });
    expect(query).toBeDefined();

    const options = query?.options as ObserverOptions;
    const interval = options.refetchInterval;
    const resolvedInterval =
      typeof interval === "function" ? interval(query as never) : interval;

    // Not the old ~30s blanket poll: WS invalidation covers realtime updates,
    // this is only a safety net for a missed event or an exhausted reconnect.
    expect(resolvedInterval).toBe(5 * 60 * 1000);

    const focus = options.refetchOnWindowFocus;
    const resolvedFocus =
      typeof focus === "function" ? focus(query as never) : focus;
    expect(resolvedFocus).toBe(true);
  });

  it("stops the safety-net poll once the query is unauthorized", async () => {
    getTasks.mockRejectedValue(new HttpError(401, "unauthorized"));
    renderHook(() => useGetTasks("project"), { wrapper: Wrapper });

    await waitFor(() =>
      expect(client.getQueryState(["tasks", "project"])?.status).toBe("error"),
    );

    const query = client
      .getQueryCache()
      .find({ queryKey: ["tasks", "project"] });
    const options = query?.options as ObserverOptions;
    const interval = options.refetchInterval;
    const resolvedInterval =
      typeof interval === "function" ? interval(query as never) : interval;

    expect(resolvedInterval).toBe(false);

    const focus = options.refetchOnWindowFocus;
    const resolvedFocus =
      typeof focus === "function" ? focus(query as never) : focus;
    expect(resolvedFocus).toBe(false);
  });
});

describe("useGetTasks cache refresh", () => {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClientSingleton}>
        {children}
      </QueryClientProvider>
    );
  }

  afterEach(() => {
    queryClientSingleton.clear();
  });

  it("refreshes a cached public board when revisited", async () => {
    queryClientSingleton.setQueryData(["public-project", "public-parent"], {
      columns: [{ tasks: [{ subtaskCounts: { completed: 0, total: 1 } }] }],
    });
    const updated = {
      columns: [{ tasks: [{ subtaskCounts: { completed: 1, total: 1 } }] }],
    };
    getPublicProject.mockResolvedValue(updated);
    const { result } = renderHook(() => useGetPublicProject("public-parent"), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.data).toEqual(updated));
    expect(getPublicProject).toHaveBeenCalledWith(
      { id: "public-parent" },
      expect.any(AbortSignal),
    );
  });

  it("refreshes cached parent progress on return without a parent socket", async () => {
    const parent = {
      id: "parent-project",
      columns: [
        {
          tasks: [{ id: "parent", subtaskCounts: { completed: 0, total: 1 } }],
        },
      ],
    };
    getTasks.mockResolvedValue(parent);
    const firstVisit = renderHook(() => useGetTasks("parent-project"), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(firstVisit.result.current.data).toEqual(parent));
    firstVisit.unmount();

    // Deleting the child project changes the server while the parent is inactive.
    // No socket event or local invalidation reaches this cached board.
    const updatedParent = {
      ...parent,
      columns: [
        {
          tasks: [{ id: "parent", subtaskCounts: { completed: 0, total: 0 } }],
        },
      ],
    };
    getTasks.mockResolvedValue(updatedParent);
    expect(
      queryClientSingleton.getQueryData(["tasks", "parent-project"]),
    ).toEqual(parent);
    const returnVisit = renderHook(() => useGetTasks("parent-project"), {
      wrapper: Wrapper,
    });
    await waitFor(() =>
      expect(returnVisit.result.current.data).toEqual(updatedParent),
    );
    expect(getTasks).toHaveBeenCalledTimes(2);
  });
});
