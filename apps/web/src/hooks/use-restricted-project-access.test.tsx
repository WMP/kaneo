import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRestrictedProjectAccess } from "./use-restricted-project-access";

let user: { role?: string } | null;
let permission: {
  role: string | undefined;
  manageSettings: boolean;
  isCheckingPermissions: boolean;
};

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    role: permission.role,
    canManageSettings: () => permission.manageSettings,
    isCheckingPermissions: permission.isCheckingPermissions,
  }),
}));

beforeEach(() => {
  user = { role: "user" };
  permission = {
    role: "member",
    manageSettings: false,
    isCheckingPermissions: false,
  };
});

const restricted = () =>
  renderHook(() => useRestrictedProjectAccess()).result.current;

describe("useRestrictedProjectAccess", () => {
  it("is restricted for a member without workspace:manage_settings", () => {
    expect(restricted()).toBe(true);
  });

  it("is not restricted for a role that grants workspace:manage_settings", () => {
    permission.manageSettings = true;

    expect(restricted()).toBe(false);
  });

  it("is unknown while the capabilities are still being checked", () => {
    permission.isCheckingPermissions = true;

    expect(restricted()).toBeUndefined();
  });

  it("is never restricted for an owner", () => {
    permission = { ...permission, role: "owner", isCheckingPermissions: true };

    expect(restricted()).toBe(false);
  });

  it("is never restricted for an instance administrator", () => {
    user = { role: "admin" };

    expect(restricted()).toBe(false);
  });

  it("is unknown until the workspace role is known", () => {
    permission.role = undefined;

    expect(restricted()).toBeUndefined();
  });
});
