import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import createProjectHost from "@/fetchers/infrastructure/create-project-host";
import deleteProjectHost from "@/fetchers/infrastructure/delete-project-host";
import { infrastructureKeys } from "@/lib/infrastructure-keys";
import useCreateProjectHost from "./use-create-project-host";
import useDeleteProjectHost from "./use-delete-project-host";

vi.mock("@/fetchers/infrastructure/delete-project-host", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/infrastructure/create-project-host", () => ({
  default: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let queryClient: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const stateOf = (queryKey: readonly unknown[]) =>
  queryClient.getQueryState(queryKey)?.isInvalidated;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(infrastructureKeys.taskVms("task-1"), []);
  queryClient.setQueryData(infrastructureKeys.hosts("project-1"), []);
  queryClient.setQueryData(infrastructureKeys.capacity("project-1"), {});
  queryClient.setQueryData(infrastructureKeys.regions("project-1"), []);
  queryClient.setQueryData(infrastructureKeys.hosts("project-2"), []);
});

describe("infrastructure mutations refresh the whole infrastructure cache", () => {
  it("deleting a host also invalidates the VM list of every task", async () => {
    vi.mocked(deleteProjectHost).mockResolvedValue({ id: "host-1" });
    const { result } = renderHook(() => useDeleteProjectHost(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "project-1",
        hostId: "host-1",
      });
    });

    expect(stateOf(infrastructureKeys.taskVms("task-1"))).toBe(true);
    expect(stateOf(infrastructureKeys.hosts("project-1"))).toBe(true);
    expect(stateOf(infrastructureKeys.capacity("project-1"))).toBe(true);
    expect(stateOf(infrastructureKeys.regions("project-1"))).toBe(true);
    expect(stateOf(infrastructureKeys.hosts("project-2"))).toBe(true);
  });

  it("adding hosts invalidates the VM lists too", async () => {
    vi.mocked(createProjectHost).mockResolvedValue({ hosts: [] } as never);
    const { result } = renderHook(() => useCreateProjectHost(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "project-1",
        modelId: "model-1",
        region: "GRA",
        quantity: 2,
      });
    });

    expect(stateOf(infrastructureKeys.taskVms("task-1"))).toBe(true);
  });
});
