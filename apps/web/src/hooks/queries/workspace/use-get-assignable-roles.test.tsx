import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useGetAssignableRoles, {
  assignableRolesQueryKey,
  assignableRolesWorkspaceKey,
} from "./use-get-assignable-roles";

const getAssignableRoles = vi.fn();
let activeMember: {
  data: { role: string } | null | undefined;
  isLoading: boolean;
};

vi.mock("@/fetchers/workspace/get-assignable-roles", () => ({
  default: (workspaceId: string) => getAssignableRoles(workspaceId),
}));

vi.mock("@/hooks/queries/workspace-users/use-active-workspace-user", () => ({
  useGetActiveWorkspaceUser: () => activeMember,
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
  activeMember = { data: { role: "admin" }, isLoading: false };
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

  it("stays loading while the caller's own role is still being resolved", () => {
    activeMember = { data: undefined, isLoading: true };
    const { wrapper } = setup();

    const { result } = renderHook(() => useGetAssignableRoles("ws-1"), {
      wrapper,
    });

    expect(result.current.isLoading).toBe(true);
    expect(getAssignableRoles).not.toHaveBeenCalled();
  });

  it("fetches once the role is known and caches it under a key that includes the role", async () => {
    const { queryClient, wrapper } = setup();

    const { result } = renderHook(() => useGetAssignableRoles("ws-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(getAssignableRoles).toHaveBeenCalledWith("ws-1");
    expect(
      queryClient.getQueryData(assignableRolesQueryKey("ws-1", "admin")),
    ).toEqual([{ role: "viewer", isDefault: true }]);
  });

  it("refetches when the caller's role changes", async () => {
    const { wrapper } = setup();
    const { result, rerender } = renderHook(
      () => useGetAssignableRoles("ws-1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(getAssignableRoles).toHaveBeenCalledTimes(1);

    activeMember = { data: { role: "member" }, isLoading: false };
    rerender();

    await waitFor(() => expect(getAssignableRoles).toHaveBeenCalledTimes(2));
  });

  it("the workspace prefix key matches every role-specific entry", async () => {
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
