import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectAccessRevoked } from "./use-project-access-revoked";

const { navigate, toast } = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({ toast }));

describe("useProjectAccessRevoked", () => {
  beforeEach(() => {
    navigate.mockReset();
    toast.info.mockReset();
    toast.error.mockReset();
  });

  it("tells the person their permissions changed and stays in the project", () => {
    const { result } = renderHook(() => useProjectAccessRevoked("workspace-1"));
    result.current({ accessible: true });

    expect(toast.info).toHaveBeenCalledWith("common:projectAccess.changed");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("tells the person access is gone and opens the workspace dashboard", () => {
    const { result } = renderHook(() => useProjectAccessRevoked("workspace-1"));
    result.current({ accessible: false });

    expect(toast.error).toHaveBeenCalledWith("common:projectAccess.lost");
    expect(navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId",
      params: { workspaceId: "workspace-1" },
      replace: true,
    });
  });
});
