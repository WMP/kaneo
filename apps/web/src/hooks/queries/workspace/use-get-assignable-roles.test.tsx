import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useGetAssignableRoles, {
  assignableRolesQueryKey,
  assignableRolesWorkspaceKey,
} from "./use-get-assignable-roles";

const getAssignableRoles = vi.fn();
let auth: { user: { id: string } | null | undefined; isLoading: boolean };

vi.mock("@/fetchers/workspace/get-assignable-roles", () => ({
  default: (workspaceId: string) => getAssignableRoles(workspaceId),
}));

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => auth,
}));

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  getAssignableRoles.mockReset();
  getAssignableRoles.mockResolvedValue([{ role: "viewer", isDefault: true }]);
  auth = { user: { id: "user-1" }, isLoading: false };
});

describe("useGetAssignableRoles", () => {
  it("is not loading, and never fetches, without a workspace id", () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useGetAssignableRoles(undefined), {
      wrapper,
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(getAssignableRoles).not.toHaveBeenCalled();
  });

  it("is not loading when nobody is signed in", () => {
    auth = { user: null, isLoading: false };
    const { wrapper } = setup();

    const { result } = renderHook(() => useGetAssignableRoles("ws-1"), {
      wrapper,
    });

    expect(result.current.isLoading).toBe(false);
    expect(getAssignableRoles).not.toHaveBeenCalled();
  });

  it("reports loading while the session is still resolving", () => {
    auth = { user: undefined, isLoading: true };
    const { wrapper } = setup();

    const { result } = renderHook(() => useGetAssignableRoles("ws-1"), {
      wrapper,
    });

    expect(result.current.isLoading).toBe(true);
    expect(getAssignableRoles).not.toHaveBeenCalled();
  });

  it("fetches for the requested workspace and caches it per workspace and user", async () => {
    const { queryClient, wrapper } = setup();

    const { result } = renderHook(() => useGetAssignableRoles("ws-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(getAssignableRoles).toHaveBeenCalledWith("ws-1");
    expect(
      queryClient.getQueryData(assignableRolesQueryKey("ws-1", "user-1")),
    ).toEqual([{ role: "viewer", isDefault: true }]);
  });

  it("surfaces an error and retries through refetch", async () => {
    getAssignableRoles.mockRejectedValueOnce(new Error("boom"));
    const { wrapper } = setup();

    const { result } = renderHook(() => useGetAssignableRoles("ws-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();

    await result.current.refetch();

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(getAssignableRoles).toHaveBeenCalledTimes(2);
  });

  it("keeps the previous list while a new user's list loads, but only within a workspace", async () => {
    const { wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ workspaceId }: { workspaceId: string }) =>
        useGetAssignableRoles(workspaceId),
      { wrapper, initialProps: { workspaceId: "ws-1" } },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());

    getAssignableRoles.mockReturnValue(new Promise(() => {}));
    auth = { user: { id: "user-2" }, isLoading: false };
    rerender({ workspaceId: "ws-1" });
    expect(result.current.data).toEqual([{ role: "viewer", isDefault: true }]);

    rerender({ workspaceId: "ws-2" });
    expect(result.current.data).toBeUndefined();
  });

  it("the workspace prefix key invalidates the cached entry", async () => {
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useGetAssignableRoles("ws-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBeDefined());

    const callsBefore = getAssignableRoles.mock.calls.length;
    await queryClient.invalidateQueries({
      queryKey: assignableRolesWorkspaceKey("ws-1"),
    });

    await waitFor(() =>
      expect(getAssignableRoles).toHaveBeenCalledTimes(callsBefore + 1),
    );
  });
});
