import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// End-to-end proof (mocked data layer, real route component) that the
// portfolio route renders every project's tasks on one shared timeline and
// that clicking a task bar opens its details -- see AGENTS.md's "follow a
// change through" for why this is the route-level check rather than only
// gantt-portfolio.test.ts's pure-logic coverage.
const m = vi.hoisted(() => ({
  component: (() => null) as ComponentType,
  navigate: vi.fn(),
  portfolio: {
    projects: [] as Record<string, unknown>[],
    dependencies: [] as Record<string, unknown>[],
  },
  preferencesState: {
    weekStartsOn: 1 as const,
    ganttTimelineUnit: "day" as const,
    ganttTimelineUnitTouched: true,
    setGanttTimelineUnit: (() => {}) as (unit: string) => void,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => {
    m.component = options.component;
    return { useParams: () => ({ workspaceId: "workspace-1" }) };
  },
  useNavigate: () => m.navigate,
}));
vi.mock("@/components/common/workspace-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/task/task-details-sheet", () => ({
  default: ({
    taskId,
    projectId,
  }: {
    taskId: string | undefined;
    projectId: string;
  }) =>
    taskId ? (
      <div data-testid="task-details-sheet">
        {projectId}:{taskId}
      </div>
    ) : null,
}));
vi.mock("@/hooks/queries/project/use-get-portfolio", () => ({
  default: () => ({ data: m.portfolio, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
// The "blocks" dependency-line label (TaskRelationDependencyPopover, from
// GanttDependencyOverlay) reads workspace permission via a route param this
// mocked router doesn't provide -- mocked out directly, same as the
// per-project Gantt's own dependency-line tests.
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => true }),
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    selector: (state: typeof m.preferencesState) => unknown,
  ) => selector(m.preferencesState),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

await import(
  "@/routes/_layout/_authenticated/dashboard/workspace/$workspaceId/portfolio"
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 15));
  // The route measures each task row's box (for the cross-project
  // dependency-line overlay) via a ResizeObserver, which jsdom doesn't
  // implement -- same stub the per-project Gantt's own dependency-line
  // tests use.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  m.portfolio = { projects: [], dependencies: [] };
  m.navigate.mockClear();
});

function show() {
  const Component = m.component;
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>,
  );
}

describe("Portfolio route", () => {
  it("shows the empty state when the workspace has no projects", () => {
    m.portfolio = { projects: [], dependencies: [] };
    show();
    expect(screen.getByText("portfolio:noProjectsTitle")).toBeInTheDocument();
  });

  it("shows the no-scheduled-tasks state when projects have nothing dated", () => {
    m.portfolio = {
      projects: [
        {
          id: "project-1",
          name: "Alpha",
          slug: "alpha",
          icon: null,
          tasks: [
            {
              id: "task-1",
              title: "Backlog item",
              startDate: null,
              dueDate: null,
              progress: 0,
              isMilestone: false,
              status: "to-do",
            },
          ],
        },
      ],
      dependencies: [],
    };
    show();
    expect(
      screen.getByText("portfolio:noScheduledTasksTitle"),
    ).toBeInTheDocument();
  });

  it("renders every project's scheduled tasks on the shared timeline and opens a task on click", () => {
    m.portfolio = {
      projects: [
        {
          id: "project-1",
          name: "Alpha",
          slug: "alpha",
          icon: null,
          tasks: [
            {
              id: "task-1",
              title: "Migrate schema",
              startDate: "2026-01-10",
              dueDate: "2026-01-14",
              progress: 40,
              isMilestone: false,
              status: "to-do",
            },
          ],
        },
        {
          id: "project-2",
          name: "Beta",
          slug: "beta",
          icon: null,
          tasks: [
            {
              id: "task-2",
              title: "Ship v1",
              startDate: "2026-01-16",
              dueDate: "2026-01-16",
              progress: 0,
              isMilestone: true,
              status: "to-do",
            },
          ],
        },
      ],
      dependencies: [],
    };
    show();

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    // The task's title appears twice: once in the sticky rail, once on the
    // bar itself (same convention as the per-project Gantt).
    expect(screen.getAllByText("Migrate schema").length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", {
        name: 'portfolio:gantt.taskAriaLabel:{"title":"Migrate schema"}',
      }),
    );
    expect(screen.getByTestId("task-details-sheet")).toHaveTextContent(
      "project-1:task-1",
    );
  });

  it("draws a cross-project dependency line between two projects' task bars", () => {
    m.portfolio = {
      projects: [
        {
          id: "project-1",
          name: "Alpha",
          slug: "alpha",
          icon: null,
          tasks: [
            {
              id: "task-1",
              title: "Client sign-off",
              startDate: "2026-01-10",
              dueDate: "2026-01-14",
              progress: 40,
              isMilestone: false,
              status: "to-do",
            },
          ],
        },
        {
          id: "project-2",
          name: "Beta",
          slug: "beta",
          icon: null,
          tasks: [
            {
              id: "task-2",
              title: "Cutover",
              startDate: "2026-01-16",
              dueDate: "2026-01-16",
              progress: 0,
              isMilestone: true,
              status: "to-do",
            },
          ],
        },
      ],
      dependencies: [
        {
          id: "relation-1",
          sourceTaskId: "task-1",
          sourceProjectId: "project-1",
          targetTaskId: "task-2",
          targetProjectId: "project-2",
          dependencyType: "fs",
          lagDays: 0,
        },
      ],
    };
    const { container } = show();

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(container.querySelector("svg path")).not.toBeNull();
  });

  it("widens the day columns on a wheel-zoom over the timeline (fine adjustment on top of the unit switch)", () => {
    m.portfolio = {
      projects: [
        {
          id: "project-1",
          name: "Alpha",
          slug: "alpha",
          icon: null,
          tasks: [
            {
              id: "task-1",
              title: "Migrate schema",
              startDate: "2026-01-10",
              dueDate: "2026-01-14",
              progress: 40,
              isMilestone: false,
              status: "to-do",
            },
          ],
        },
      ],
      dependencies: [],
    };
    const { container } = show();
    const grid = container.querySelector<HTMLElement>(
      '[style*="grid-template-columns: repeat"]',
    );
    expect(grid).toBeTruthy();
    const before = grid?.style.gridTemplateColumns;

    const viewport = screen.getByTestId("portfolio-scroll-container");
    fireEvent.wheel(viewport, { deltaY: -200, clientX: 500, clientY: 40 });

    // The effective column width is baseDayColumnWidthRem * zoom -- a
    // widened gridTemplateColumns proves the wheel-driven zoom factor
    // actually reaches the rendered grid, on top of whatever the Day-unit
    // base width already was.
    expect(grid?.style.gridTemplateColumns).not.toBe(before);
    const widthMatch =
      grid?.style.gridTemplateColumns.match(/minmax\(([\d.]+)rem/);
    const beforeMatch = before?.match(/minmax\(([\d.]+)rem/);
    expect(Number(widthMatch?.[1])).toBeGreaterThan(Number(beforeMatch?.[1]));
  });

  it("drag-pans the scroll viewport across empty timeline background", () => {
    m.portfolio = {
      projects: [
        {
          id: "project-1",
          name: "Alpha",
          slug: "alpha",
          icon: null,
          tasks: [
            {
              id: "task-1",
              title: "Migrate schema",
              startDate: "2026-01-10",
              dueDate: "2026-01-14",
              progress: 40,
              isMilestone: false,
              status: "to-do",
            },
          ],
        },
      ],
      dependencies: [],
    };
    const { container } = show();
    const viewport = screen.getByTestId("portfolio-scroll-container");
    viewport.scrollLeft = 200;
    viewport.scrollTop = 30;

    const content = container.querySelector(
      ".touch-pan-x.touch-pan-y",
    ) as HTMLElement;
    expect(content).toBeTruthy();

    fireEvent.pointerDown(content, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 500,
      clientY: 100,
    });
    fireEvent.pointerMove(content, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 420,
      clientY: 70,
    });

    // Dragging left (clientX decreased by 80) pulls the content left, i.e.
    // increases scrollLeft by the same amount -- same "grab and pull"
    // convention as the per-project Gantt.
    expect(viewport.scrollLeft).toBe(280);
    expect(viewport.scrollTop).toBe(60);

    fireEvent.pointerUp(content, { pointerId: 1, pointerType: "mouse" });

    // A click on the task bar still opens the task after the drag ends --
    // the pan never hijacked the bar's own button.
    fireEvent.click(
      screen.getByRole("button", {
        name: 'portfolio:gantt.taskAriaLabel:{"title":"Migrate schema"}',
      }),
    );
    expect(screen.getByTestId("task-details-sheet")).toHaveTextContent(
      "project-1:task-1",
    );
  });

  it("collapses a project's rows without removing the group header", () => {
    m.portfolio = {
      projects: [
        {
          id: "project-1",
          name: "Alpha",
          slug: "alpha",
          icon: null,
          tasks: [
            {
              id: "task-1",
              title: "Migrate schema",
              startDate: "2026-01-10",
              dueDate: "2026-01-14",
              progress: 40,
              isMilestone: false,
              status: "to-do",
            },
          ],
        },
      ],
      dependencies: [],
    };
    show();

    expect(screen.getAllByText("Migrate schema").length).toBeGreaterThan(0);
    fireEvent.click(
      screen.getByRole("button", {
        name: 'portfolio:toggleProjectAriaLabel:{"name":"Alpha"}',
      }),
    );
    expect(screen.queryByText("Migrate schema")).not.toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});
