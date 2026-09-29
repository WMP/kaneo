import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MobileProjectNav from "./mobile-project-nav";
import ProjectCrumbSelect from "./project-crumb-select";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    data: [{ id: "project-1", name: "Alpha", icon: "Layout" }],
  }),
}));

// The header components must not check permissions themselves: the parent
// decides by passing (or omitting) `onAddProject`.
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => {
    throw new Error("header components must not read permissions");
  },
}));

afterEach(cleanup);

describe("ProjectCrumbSelect add-project item", () => {
  const renderSelect = (onAddProject?: () => void) =>
    render(
      <ProjectCrumbSelect
        workspaceId="workspace-1"
        projectId="project-1"
        projectName="Alpha"
        onSelectProject={vi.fn()}
        onAddProject={onAddProject}
      />,
    );

  it("renders the item and calls the handler when one is passed", async () => {
    const onAddProject = vi.fn();
    renderSelect(onAddProject);

    fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "navigation:projectList.addProject",
      }),
    );

    expect(onAddProject).toHaveBeenCalledTimes(1);
  });

  it("omits the item when no handler is passed", async () => {
    renderSelect();

    fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));

    await screen.findAllByRole("menuitem");
    expect(
      screen.queryByRole("menuitem", {
        name: "navigation:projectList.addProject",
      }),
    ).toBeNull();
  });
});

describe("MobileProjectNav add-project item", () => {
  const renderNav = (onAddProject?: () => void) =>
    render(
      <MobileProjectNav
        workspaceId="workspace-1"
        projectId="project-1"
        activeView="board"
        onSelectBoard={vi.fn()}
        onSelectBacklog={vi.fn()}
        onSelectCalendar={vi.fn()}
        onSelectGantt={vi.fn()}
        onSelectProject={vi.fn()}
        onAddProject={onAddProject}
      />,
    );

  it("renders the item and calls the handler when one is passed", async () => {
    const onAddProject = vi.fn();
    renderNav(onAddProject);

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "navigation:projectList.addProject",
      }),
    );

    expect(onAddProject).toHaveBeenCalledTimes(1);
  });

  it("omits the item when no handler is passed", async () => {
    renderNav();

    fireEvent.click(screen.getByRole("button"));

    await screen.findByText("navigation:mobileProjectNav.projects");
    expect(
      screen.queryByRole("button", {
        name: "navigation:projectList.addProject",
      }),
    ).toBeNull();
  });
});
