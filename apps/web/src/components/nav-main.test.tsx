import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavMain } from "./nav-main";
import { SidebarProvider } from "./ui/sidebar";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));

vi.mock("@/hooks/queries/invitation/use-pending-invitations", () => ({
  usePendingInvitations: () => ({ data: [] }),
}));

let canReadDatacenter = false;
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canReadDatacenter: () => canReadDatacenter,
  }),
}));

function renderNav() {
  return render(
    <SidebarProvider>
      <NavMain />
    </SidebarProvider>,
  );
}

beforeEach(() => {
  canReadDatacenter = false;
  window.matchMedia =
    window.matchMedia ||
    ((query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList);
});

afterEach(cleanup);

describe("NavMain datacenter item", () => {
  it("is hidden without the datacenter read permission", () => {
    renderNav();

    expect(screen.getByText("navigation:sidebar.workload")).toBeInTheDocument();
    expect(
      screen.queryByText("navigation:sidebar.datacenter"),
    ).not.toBeInTheDocument();
  });

  it("is shown with the datacenter read permission", () => {
    canReadDatacenter = true;
    renderNav();

    expect(
      screen.getByText("navigation:sidebar.datacenter"),
    ).toBeInTheDocument();
  });
});
