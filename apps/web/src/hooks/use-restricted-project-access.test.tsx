import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRestrictedProjectAccess } from "./use-restricted-project-access";

let user: { role?: string } | null;
let permission: {
  workspace: { id: string } | undefined;
  role: string | undefined;
};
const hasPermission = vi.fn();

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ ...permission, hasPermission }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  user = { role: "user" };
  permission = { workspace: { id: "workspace-1" }, role: "member" };
  hasPermission.mockReset();
});

describe("useRestrictedProjectAccess", () => {
  it("is restricted for a member without workspace:manage_settings", async () => {
    hasPermission.mockResolvedValue(false);
    const { result } = renderHook(() => useRestrictedProjectAccess(), {
      wrapper,
    });

    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe(true));
    expect(hasPermission).toHaveBeenCalledWith({
      workspace: ["manage_settings"],
    });
  });

  it("is not restricted for a role that grants workspace:manage_settings", async () => {
    hasPermission.mockResolvedValue(true);
    const { result } = renderHook(() => useRestrictedProjectAccess(), {
      wrapper,
    });

    await waitFor(() => expect(result.current).toBe(false));
  });

  it("is never restricted for an owner, without asking", () => {
    permission = { workspace: { id: "workspace-1" }, role: "owner" };
    const { result } = renderHook(() => useRestrictedProjectAccess(), {
      wrapper,
    });

    expect(result.current).toBe(false);
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it("is never restricted for an instance administrator, without asking", () => {
    user = { role: "admin" };
    const { result } = renderHook(() => useRestrictedProjectAccess(), {
      wrapper,
    });

    expect(result.current).toBe(false);
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it("stays unknown until the workspace role is known", () => {
    permission = { workspace: { id: "workspace-1" }, role: undefined };
    const { result } = renderHook(() => useRestrictedProjectAccess(), {
      wrapper,
    });

    expect(result.current).toBeUndefined();
  });
});
