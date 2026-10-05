import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Coverage for this project's OWN dateless tasks: one that is the successor of
// a "blocks" relation is drawn as a read-only derived row (position from the
// dependency, length from its effort estimate; see gantt-derived-schedule.ts
// and the externalRelatedTasks memo in the Gantt route), while a dateless task
// with no placed predecessor stays off the chart.
const m = vi.hoisted(() => ({
  component: (() => null) as ComponentType,
  preferencesState: {
    weekStartsOn: 1 as const,
    ganttTimelineUnit: "day" as const,
    setGanttTimelineUnit: (() => {}) as (unit: string) => void,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => {
    m.component = options.component;
    return {
      useParams: () => ({ projectId: "project", workspaceId: "workspace" }),
      useSearch: () => ({}),
    };
  },
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/common/project-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/task/task-details-sheet", () => ({
  default: () => null,
}));
// This project has ONE dated task of its own — the predecessor that anchors
// the derived successor below.
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: () => ({
    data: {
      id: "project",
      name: "Project",
      slug: "PROJ",
      columns: [
        {
          id: "col-todo",
          tasks: [
            {
              id: "own-pred",
              title: "Own predecessor",
              number: 1,
              status: "to-do",
              priority: "medium",
              startDate: "2026-08-10",
              dueDate: "2026-08-14",
              progress: 0,
              isMilestone: false,
              labels: [],
              userId: null,
              assignees: [],
              baselineStartDate: null,
              baselineDueDate: null,
              constraintType: null,
              constraintDate: null,
              projectId: "project",
              position: 1,
            },
            {
              id: "own-undated",
              title: "Write the migration guide",
              number: 2,
              status: "to-do",
              priority: "medium",
              startDate: null,
              dueDate: null,
              progress: 0,
              estimateMinutes: 960,
              estimateUnit: "days",
              isMilestone: false,
              labels: [],
              userId: null,
              assignees: [],
              baselineStartDate: null,
              baselineDueDate: null,
              constraintType: null,
              constraintDate: null,
              projectId: "project",
              position: 2,
            },
            {
              id: "own-orphan",
              title: "Unconnected idea",
              number: 3,
              status: "to-do",
              priority: "medium",
              startDate: null,
              dueDate: null,
              progress: 0,
              estimateMinutes: 480,
              estimateUnit: "hours",
              isMilestone: false,
              labels: [],
              userId: null,
              assignees: [],
              baselineStartDate: null,
              baselineDueDate: null,
              constraintType: null,
              constraintDate: null,
              projectId: "project",
              position: 3,
            },
          ],
        },
      ],
      plannedTasks: [],
    },
  }),
}));
vi.mock("@/hooks/mutations/task/use-bulk-update-task-schedule", () => ({
  useBulkUpdateTaskSchedule: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/task-relation/use-create-task-relation", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
// own-pred BLOCKS (FS) own-undated, which has no dates but a 2-day estimate.
vi.mock("@/hooks/queries/task-relation/use-get-project-task-relations", () => {
  const summary = (overrides: Record<string, unknown>) => ({
    status: "to-do",
    priority: "medium",
    projectId: "project",
    projectName: "Project",
    projectSlug: "PROJ",
    userId: null,
    assigneeName: null,
    isMilestone: false,
    estimateMinutes: null,
    estimateUnit: "hours",
    ...overrides,
  });
  return {
    default: () => ({
      data: [
        {
          id: "relation-1",
          sourceTaskId: "own-pred",
          targetTaskId: "own-undated",
          relationType: "blocks",
          dependencyType: "fs",
          lagDays: 0,
          createdAt: "2026-08-01T00:00:00.000Z",
          sourceTask: summary({
            id: "own-pred",
            title: "Own predecessor",
            number: 1,
            startDate: "2026-08-10",
            dueDate: "2026-08-14",
          }),
          targetTask: summary({
            id: "own-undated",
            title: "Write the migration guide",
            number: 2,
            startDate: null,
            dueDate: null,
            estimateMinutes: 960,
            estimateUnit: "days",
          }),
        },
      ],
    }),
  };
});
vi.mock("@/hooks/queries/calendar/use-get-calendar", () => ({
  default: () => ({ data: undefined }),
}));
vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-fields-by-project",
  () => ({
    default: () => ({ data: [] }),
  }),
);
vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-field-values-by-project",
  () => ({
    default: () => ({ data: [] }),
  }),
);
vi.mock("@/hooks/queries/task-relation/use-gantt-gate-warnings", () => ({
  useGanttGateWarnings: () => new Map(),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    selector: (state: typeof m.preferencesState) => unknown,
  ) => selector(m.preferencesState),
}));
vi.mock("@/lib/i18n/domain", () => ({
  getStatusLabel: (status: string) => status,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));
// A "blocks" edge draws an editable dependency-type popover on its line; stub
// the mutation and permission hooks it reaches so it renders without a live
// query client.
vi.mock("@/hooks/mutations/task-relation/use-update-task-relation", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: () => ({
    canUpdateTasks: () => true,
    canUpdateProjects: () => true,
  }),
}));

await import(
  "@/routes/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/gantt"
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 12));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 910,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
    configurable: true,
    get: () => 320,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get: () => 0,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 44,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const prop of [
    "clientWidth",
    "offsetLeft",
    "offsetTop",
    "offsetHeight",
  ] as const) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
});

function show() {
  const Component = m.component;
  return render(<Component />);
}

describe("Gantt derives a dateless own task from its blocks predecessor", () => {
  it("draws the task as a read-only derived row sized by its estimate", () => {
    const { container } = show();

    // Own dateless task with a placed predecessor gets a row...
    expect(
      screen.getAllByText("Write the migration guide").length,
    ).toBeGreaterThan(0);
    // ...with the own-project derived tooltip that shows the estimate.
    const bar = container.querySelector(
      '[data-gantt-external-bar][title^="tasks:gantt.derivedTaskEstimateTitle"]',
    );
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute("title")).toContain("Write the migration guide");
    expect(bar?.getAttribute("title")).toContain("tasks:estimate.valueDays");
  });

  it("starts the bar on the predecessor's end day and spans two working days", () => {
    const { container } = show();
    const bar = container.querySelector(
      '[data-gantt-external-bar][title^="tasks:gantt.derivedTaskEstimateTitle"]',
    ) as HTMLElement;

    // Predecessor ends Friday 2026-08-14; two working days are Friday and
    // Monday, i.e. four calendar day columns.
    const [from, to] = bar.style.gridColumn
      .split("/")
      .map((part) => Number.parseInt(part, 10));
    expect((to as number) - (from as number)).toBe(4);
  });

  it("offers the rail entry as a button that is not labelled as another project", () => {
    show();

    expect(
      screen.getByRole("button", { name: /Write the migration guide/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/tasks:gantt.externalProjectBadge/)).toBeNull();
    expect(
      screen.getByText(/tasks:gantt.derivedEstimateRailNote/),
    ).toBeInTheDocument();
  });

  it("leaves a dateless task with no predecessor off the chart", () => {
    show();

    expect(screen.queryByText("Unconnected idea")).toBeNull();
  });
});
