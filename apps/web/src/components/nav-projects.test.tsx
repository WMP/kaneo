import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavProjects } from "./nav-projects";
import { SidebarProvider } from "./ui/sidebar";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));

let projects: { id: string; name: string }[] | undefined;
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: projects }),
}));

vi.mock("@/hooks/mutations/project/use-delete-project", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/project/use-reorder-projects", () => ({
  default: () => vi.fn(),
}));

let canCreate = false;
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateProjects: () => canCreate,
    canDeleteProjects: () => false,
    canUpdateProjects: () => false,
  }),
}));

let restricted: boolean | undefined;
vi.mock("@/hooks/use-restricted-project-access", () => ({
  useRestrictedProjectAccess: () => restricted,
}));

vi.mock("./shared/modals/create-project-modal", () => ({
  default: () => null,
}));

function renderNav() {
  return render(
    <SidebarProvider>
      <NavProjects />
    </SidebarProvider>,
  );
}

beforeEach(() => {
  projects = [];
  canCreate = false;
  restricted = true;
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

describe("NavProjects empty state", () => {
  it("tells a member without full access and without projects to ask for access", () => {
    renderNav();

    const notice = screen.getByText("projectMembers:noProjects.description");
    expect(notice).toBeVisible();
    expect(notice).toHaveAttribute("role", "status");
  });

  it("says nothing while the project list is still loading", () => {
    projects = undefined;
    renderNav();

    expect(
      screen.queryByText("projectMembers:noProjects.description"),
    ).toBeNull();
  });

  it("says nothing to someone with full access, whose empty list means no projects yet", () => {
    restricted = false;
    renderNav();

    expect(
      screen.queryByText("projectMembers:noProjects.description"),
    ).toBeNull();
  });

  it("says nothing while it is unknown whether access is restricted", () => {
    restricted = undefined;
    renderNav();

    expect(
      screen.queryByText("projectMembers:noProjects.description"),
    ).toBeNull();
  });

  it("does not show it once the person has a project", () => {
    projects = [{ id: "p-1", name: "Apollo" }];
    renderNav();

    expect(screen.getByText("Apollo")).toBeVisible();
    expect(
      screen.queryByText("projectMembers:noProjects.description"),
    ).toBeNull();
  });
});
