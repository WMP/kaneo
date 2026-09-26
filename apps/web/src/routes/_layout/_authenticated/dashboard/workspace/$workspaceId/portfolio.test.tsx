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
  portfolio: [] as Record<string, unknown>[],
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
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  m.portfolio = [];
  m.navigate.mockClear();
});

function show() {
  const Component = m.component;
  return render(<Component />);
}

describe("Portfolio route", () => {
  it("shows the empty state when the workspace has no projects", () => {
    m.portfolio = [];
    show();
    expect(screen.getByText("portfolio:noProjectsTitle")).toBeInTheDocument();
  });

  it("shows the no-scheduled-tasks state when projects have nothing dated", () => {
    m.portfolio = [
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
    ];
    show();
    expect(
      screen.getByText("portfolio:noScheduledTasksTitle"),
    ).toBeInTheDocument();
  });

  it("renders every project's scheduled tasks on the shared timeline and opens a task on click", () => {
    m.portfolio = [
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
    ];
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

  it("collapses a project's rows without removing the group header", () => {
    m.portfolio = [
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
    ];
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
