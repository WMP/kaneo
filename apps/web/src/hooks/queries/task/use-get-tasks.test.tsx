import type { QueryObserverOptions } from "@tanstack/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import getTasks from "@/fetchers/task/get-tasks";
import { HttpError } from "@/lib/http-error";
import { useGetTasks } from "./use-get-tasks";

// The query cache stores an internal `QueryOptions` shape that doesn't carry
// observer-only fields like `refetchInterval`/`refetchOnWindowFocus`, even
// though `useQuery` accepts and forwards them. Read the query back through
// this wider type to assert on them.
type ObserverOptions = QueryObserverOptions<unknown, Error, unknown, unknown>;

vi.mock("@/fetchers/task/get-tasks", () => ({
  default: vi.fn(),
}));

let client: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe("useGetTasks", () => {
  it("polls only as a long safety net, relying on the WebSocket for realtime updates", async () => {
    vi.mocked(getTasks).mockResolvedValue({ columns: [] } as never);
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
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it("stops the safety-net poll once the query is unauthorized", async () => {
    vi.mocked(getTasks).mockRejectedValue(new HttpError(401, "unauthorized"));
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
  });
});
