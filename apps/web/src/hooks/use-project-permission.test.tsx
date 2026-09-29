import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import {
  projectAccessQueryKey,
  useProjectPermission,
} from "./use-project-permission";

const { getProjectAccess, auth } = vi.hoisted(() => ({
  getProjectAccess: vi.fn(),
  auth: { user: { id: "user-1" } as { id: string } | null },
}));

vi.mock("@/fetchers/project/get-project-access", () => ({
  default: getProjectAccess,
}));

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: auth.user }),
}));

const capabilities = {
  createTasks: true,
  updateTasks: true,
  deleteTasks: false,
  assignTasks: true,
  createLabels: false,
  attachLabels: false,
  manageWorkspaceLabels: false,
  updateProject: false,
  deleteProject: false,
  shareProject: false,
  manageMembers: false,
  addMembers: false,
  inviteToProject: false,
  cancelProjectInvitations: false,
  manageIntegrations: false,
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useProjectPermission", () => {
  beforeEach(() => {
    getProjectAccess.mockReset();
    auth.user = { id: "user-1" };
  });

  it("denies everything until the API answers, then follows the capabilities", async () => {
    getProjectAccess.mockResolvedValue({
      mode: "member",
      role: "member",
      capabilities,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useProjectPermission("project-1"), {
      wrapper,
    });

    expect(result.current.isCheckingPermissions).toBe(true);
    expect(result.current.canUpdateTasks()).toBe(false);

    await waitFor(() =>
      expect(result.current.isCheckingPermissions).toBe(false),
    );
    expect(getProjectAccess).toHaveBeenCalledWith("project-1");
    expect(result.current.mode).toBe("member");
    expect(result.current.role).toBe("member");
    expect(result.current.canCreateTasks()).toBe(true);
    expect(result.current.canAssignTasks()).toBe(true);
    expect(result.current.canDeleteTasks()).toBe(false);
    expect(result.current.canUpdateProject()).toBe(false);
  });

  it("does not ask without a project", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useProjectPermission(undefined), {
      wrapper,
    });
    expect(getProjectAccess).not.toHaveBeenCalled();
    expect(result.current.isCheckingPermissions).toBe(false);
    expect(result.current.canUpdateTasks()).toBe(false);
  });

  it("keeps the cache per signed-in user and invalidates through the exported key", async () => {
    getProjectAccess.mockResolvedValue({
      mode: "member",
      role: "member",
      capabilities,
    });
    const { queryClient, wrapper } = setup();
    const { result, rerender } = renderHook(
      () => useProjectPermission("project-1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.canUpdateTasks()).toBe(true));

    expect(
      queryClient.getQueryCache().find({
        queryKey: ["project-access", "project-1", "user-1"],
      }),
    ).toBeDefined();

    getProjectAccess.mockResolvedValue({
      mode: "member",
      role: "viewer",
      capabilities: { ...capabilities, updateTasks: false },
    });
    await queryClient.invalidateQueries({
      queryKey: projectAccessQueryKey("project-1"),
    });
    await waitFor(() => expect(result.current.canUpdateTasks()).toBe(false));
    expect(result.current.role).toBe("viewer");

    // Another user in the same tab does not see the previous answer.
    auth.user = { id: "user-2" };
    rerender();
    expect(result.current.canUpdateTasks()).toBe(false);
    await waitFor(() => expect(getProjectAccess).toHaveBeenCalledTimes(3));
  });

  it("does not grant anything when the API refuses", async () => {
    getProjectAccess.mockRejectedValue(new HttpError(403, "no access"));
    const { wrapper } = setup();
    const { result } = renderHook(() => useProjectPermission("project-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.canCreateTasks()).toBe(false);
    expect(result.current.mode).toBeNull();
  });
});
