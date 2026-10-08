import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Critical-path PROJECTION on the Gantt route: dateless tasks placed from their
// predecessors plus estimate (derived rows, see gantt-derived-schedule.ts)
// take part in the critical path, so a chain dated A -> derived B -> derived C
// is outlined end to end, the "N skipped deps" warning counts only edges whose
// endpoint cannot be placed at all, and a "partly projected" note shows only
// when a derived row is on the path.
const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  component: (() => null) as ComponentType,
  tasks: [] as Record<string, unknown>[],
  relations: [] as Record<string, unknown>[],
  preferencesState: {
    ganttShowCriticalPath: true,
    setGanttShowCriticalPath: (() => {}) as (value: boolean) => void,
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
  useNavigate: () => m.navigate,
}));
vi.mock("@/components/common/project-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/task/task-details-sheet", () => ({
  default: () => null,
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: () => ({
    data: {
      id: "project",
      name: "Project",
      slug: "PROJ",
      columns: [{ id: "col-todo", tasks: m.tasks }],
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
vi.mock("@/hooks/queries/task-relation/use-get-project-task-relations", () => ({
  default: () => ({ data: m.relations }),
}));
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
  m.navigate.mockClear();
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

function ownTask(id: string, number: number, overrides: object = {}) {
  return {
    id,
    title: `Task ${id}`,
    number,
    status: "to-do",
    priority: "medium",
    startDate: null,
    dueDate: null,
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
    position: number,
    ...overrides,
  };
}

function summary(task: ReturnType<typeof ownTask>) {
  return {
    id: task.id,
    title: task.title,
    number: task.number,
    status: "to-do",
    priority: "medium",
    projectId: "project",
    projectName: "Project",
    projectSlug: "PROJ",
    userId: null,
    assigneeName: null,
    isMilestone: false,
    startDate: task.startDate,
    dueDate: task.dueDate,
    estimateMinutes:
      (task as { estimateMinutes?: number | null }).estimateMinutes ?? null,
    estimateUnit: "hours",
  };
}

function relation(
  id: string,
  source: ReturnType<typeof ownTask>,
  target: ReturnType<typeof ownTask>,
) {
  return {
    id,
    sourceTaskId: source.id,
    targetTaskId: target.id,
    relationType: "blocks",
    dependencyType: "fs",
    lagDays: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    sourceTask: summary(source),
    targetTask: summary(target),
  };
}

// Dated A (Mon-Fri) -> derived B (2 working days) -> derived C (1 working day).
const A = ownTask("a", 1, { startDate: "2026-08-10", dueDate: "2026-08-14" });
const B = ownTask("b", 2, { estimateMinutes: 960 });
const C = ownTask("c", 3, { estimateMinutes: 480 });
// No dates and no predecessor: cannot be placed on the timeline at all.
const U = ownTask("u", 4, { estimateMinutes: 480 });

function bars(container: HTMLElement) {
  return [
    ...container.querySelectorAll("[data-gantt-external-bar]"),
  ] as HTMLElement[];
}

describe("Gantt critical path projected through derived rows", () => {
  it("outlines a derived chain end to end and counts only unplaceable edges as skipped", () => {
    m.tasks = [A, B, C, U];
    m.relations = [
      relation("a-b", A, B),
      relation("b-c", B, C),
      relation("u-a", U, A),
    ];
    const { container } = show();

    const derivedBars = bars(container);
    expect(derivedBars).toHaveLength(2);
    for (const bar of derivedBars) {
      expect(bar.className).toContain("outline-warning");
      expect(bar.className).toContain("outline-dashed");
    }

    // Only the edge from the unplaceable task is skipped, not the 2 derived ones.
    expect(
      screen.getByText('tasks:gantt.criticalPathDroppedEdges:{"count":1}'),
    ).toBeInTheDocument();
    expect(
      screen.getByText("tasks:gantt.criticalPathProjectedNote"),
    ).toBeInTheDocument();
  });

  it("shows no skipped-dependency warning when every endpoint can be placed", () => {
    m.tasks = [A, B, C];
    m.relations = [relation("a-b", A, B), relation("b-c", B, C)];
    show();

    expect(
      screen.queryByText(/tasks:gantt.criticalPathDroppedEdges:/),
    ).toBeNull();
    expect(
      screen.getByText("tasks:gantt.criticalPathProjectedNote"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "tasks:gantt.criticalPathToggleAriaLabel",
      }),
    ).toHaveAttribute("title", "tasks:gantt.criticalPathProjectedNote");
  });

  it("does not show the projected note when the critical path has only dated tasks", () => {
    const D1 = ownTask("d1", 5, {
      startDate: "2026-08-10",
      dueDate: "2026-08-14",
    });
    const D2 = ownTask("d2", 6, {
      startDate: "2026-08-17",
      dueDate: "2026-08-18",
    });
    m.tasks = [D1, D2];
    m.relations = [relation("d1-d2", D1, D2)];
    const { container } = show();

    expect(
      screen.getByText("tasks:gantt.legendCriticalPath"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("tasks:gantt.criticalPathProjectedNote"),
    ).toBeNull();
    expect(bars(container)).toHaveLength(0);
    expect(
      screen.getByRole("button", {
        name: "tasks:gantt.criticalPathToggleAriaLabel",
      }),
    ).not.toHaveAttribute("title");
  });
});
