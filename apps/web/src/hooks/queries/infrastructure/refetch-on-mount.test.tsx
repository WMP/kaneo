import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import getProjectHosts from "@/fetchers/infrastructure/get-project-hosts";
import getTaskVms from "@/fetchers/infrastructure/get-task-vms";
import useProjectHosts from "./use-project-hosts";
import useTaskVms from "./use-task-vms";

vi.mock("@/fetchers/infrastructure/get-project-hosts", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/infrastructure/get-task-vms", () => ({
  default: vi.fn(),
}));

// The app's QueryClient sets refetchOnMount: false and a query keeps its data
// fresh for 30 seconds; an infrastructure view must still never open on a list
// that shows a deleted host or task.
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

beforeEach(() => vi.clearAllMocks());

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("infrastructure queries", () => {
  it("refetch project hosts on every mount", async () => {
    vi.mocked(getProjectHosts).mockResolvedValue([] as never);
    const wrapper = wrapperFor(makeClient());

    const first = renderHook(() => useProjectHosts("project-1"), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    expect(getProjectHosts).toHaveBeenCalledTimes(1);

    renderHook(() => useProjectHosts("project-1"), { wrapper });
    await waitFor(() => expect(getProjectHosts).toHaveBeenCalledTimes(2));
  });

  it("refetch task VMs on every mount", async () => {
    vi.mocked(getTaskVms).mockResolvedValue([] as never);
    const wrapper = wrapperFor(makeClient());

    const first = renderHook(() => useTaskVms("task-1"), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    expect(getTaskVms).toHaveBeenCalledTimes(1);

    renderHook(() => useTaskVms("task-1"), { wrapper });
    await waitFor(() => expect(getTaskVms).toHaveBeenCalledTimes(2));
  });
});
