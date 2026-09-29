import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./index";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ workspaceId: "workspace-1" }),
  }),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/common/workspace-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/shared/modals/create-project-modal", () => ({
  default: () => null,
}));

let projectsState: {
  data: { id: string }[] | undefined;
  isLoading: boolean;
};
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => projectsState,
}));
vi.mock("@/hooks/mutations/project/use-reorder-projects", () => ({
  default: () => vi.fn(),
}));
vi.mock("@/hooks/use-keyboard-shortcuts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-keyboard-shortcuts")>()),
  useRegisterShortcuts: vi.fn(),
}));

let canCreate = false;
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateProjects: () => canCreate,
    canUpdateProjects: () => false,
  }),
}));

let restricted: boolean | undefined;
vi.mock("@/hooks/use-restricted-project-access", () => ({
  useRestrictedProjectAccess: () => restricted,
}));

const ProjectsPage = (Route as unknown as { component: ComponentType })
  .component;

beforeEach(() => {
  projectsState = { data: [], isLoading: false };
  canCreate = false;
  restricted = true;
});

afterEach(cleanup);

describe("workspace projects page without projects", () => {
  it("tells a member without full access to ask for access to a project", () => {
    render(<ProjectsPage />);

    expect(screen.getByText("projectMembers:noProjects.title")).toBeVisible();
    expect(
      screen.getByText("projectMembers:noProjects.description"),
    ).toBeVisible();
    expect(screen.queryByText("workspace:projects.emptyTitle")).toBeNull();
  });

  it("still offers to create a project to a member who may", () => {
    canCreate = true;
    render(<ProjectsPage />);

    expect(
      screen.getByText("projectMembers:noProjects.description"),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", {
        name: "workspace:projects.createProject",
      }).length,
    ).toBeGreaterThan(0);
  });

  it("keeps the plain empty state for somebody with full access", () => {
    restricted = false;
    render(<ProjectsPage />);

    expect(screen.getByText("workspace:projects.emptyTitle")).toBeVisible();
    expect(
      screen.queryByText("projectMembers:noProjects.description"),
    ).toBeNull();
  });

  it("keeps the plain empty state while access is still being checked", () => {
    restricted = undefined;
    render(<ProjectsPage />);

    expect(screen.getByText("workspace:projects.emptyTitle")).toBeVisible();
  });
});
