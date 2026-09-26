import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Proves the row virtualizer (useGanttRowVirtualizer, wired into the Gantt
// route) actually windows a large task-heavy board's rows, and that
// scrolling moves the window — rather than only unit-testing the hook in
// isolation. Every row's rail cell carries `data-gantt-rail` (see gantt.tsx,
// also used to exclude the sticky header's own rail label from drag-to-pan/
// wheel-zoom), so counting those elements — minus the one header copy — is
// an existing, stable way to count rendered rows without adding a new test
// hook.
const TASK_COUNT = 300;

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

// A generator so each test picks its own task count (a large board here, a
// small one further down) without duplicating the whole mock task shape.
function makeTasks(count: number) {
  const tasks: Record<string, unknown>[] = [];
  for (let index = 0; index < count; index++) {
    const start = new Date(2026, 0, 1 + index * 2);
    const due = new Date(2026, 0, 2 + index * 2);
    const iso = (date: Date) => date.toISOString().slice(0, 10);
    tasks.push({
      id: `task-${index}`,
      projectId: "project",
      title: `Task ${String(index).padStart(4, "0")}`,
      number: index + 1,
      status: "to-do",
      startDate: iso(start),
      dueDate: iso(due),
      description: "",
      labels: [],
      priority: "low",
      position: index,
    });
  }
  return tasks;
}

const tasksMock = vi.hoisted(() => ({
  tasks: [] as Record<string, unknown>[],
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: () => ({
    data: {
      id: "project",
      name: "Project",
      slug: "PROJ",
      columns: [{ tasks: tasksMock.tasks }],
      plannedTasks: [],
    },
  }),
}));
vi.mock("@/hooks/mutations/task/use-bulk-update-task-schedule", () => ({
  useBulkUpdateTaskSchedule: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/task-relation/use-create-task-relation", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/queries/task-relation/use-get-project-task-relations", () => ({
  default: () => ({ data: [] }),
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
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));
// Rows only need to prove they mounted (or didn't) here, not render a real
// bar's own drag/resize/link-handle wiring — same lean substitution
// gantt.test.tsx uses.
vi.mock("@/components/gantt/gantt-task-bar", () => ({
  GanttTaskBar: ({ task }: { task: { title: string } }) => (
    <div>{task.title}</div>
  ),
  toIsoDay: (date: Date) => date.toISOString().slice(0, 10),
}));

await import(
  "@/routes/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/gantt"
);

function show() {
  const Component = m.component;
  return render(<Component />);
}

// Counts only the per-ROW rail cells: the sticky header above the rows also
// carries `data-gantt-rail` (see gantt.tsx), so it's always +1 over the
// actual row count.
function renderedRowCount() {
  return document.querySelectorAll("[data-gantt-rail]").length - 1;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 1));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  // jsdom never lays anything out, so every element's clientHeight reads 0
  // unless stubbed — this gives the shared scroll container (both the task
  // rail and the timeline pane scroll together, see gantt.tsx) a realistic,
  // fixed viewport height so the row virtualizer's window is deterministic
  // rather than falling back to its generous "unmeasured" default.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  tasksMock.tasks = [];
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)
    .clientHeight;
});

describe("Gantt row virtualization", () => {
  it("mounts only a windowed subset of rows for a task-heavy board, not all of them", () => {
    tasksMock.tasks = makeTasks(TASK_COUNT);

    show();

    const rendered = renderedRowCount();
    expect(rendered).toBeGreaterThan(0);
    // A generous ceiling: at a 600px viewport plus overscan and ~44px rows,
    // well under 100 rows should ever be mounted at once — nowhere near the
    // full 300-task board.
    expect(rendered).toBeLessThan(100);
    expect(rendered).toBeLessThan(TASK_COUNT);

    // The title appears twice per mounted row (the rail's own text, plus the
    // mocked GanttTaskBar's), so "present" is a non-empty match, not
    // exactly-one.
    expect(screen.queryAllByText("Task 0000").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Task 0299")).toHaveLength(0);
  });

  it("moves the mounted window when the shared scroll container scrolls", () => {
    tasksMock.tasks = makeTasks(TASK_COUNT);

    show();

    expect(screen.queryAllByText("Task 0000").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Task 0250")).toHaveLength(0);

    const scrollContainer = screen.getByTestId("gantt-scroll-container");
    // Far enough down the (much taller than any one viewport) row list that
    // the early rows fall well outside even a generous overscan.
    scrollContainer.scrollTop = 10_000;
    fireEvent.scroll(scrollContainer);

    expect(screen.queryAllByText("Task 0000")).toHaveLength(0);
    expect(screen.queryAllByText("Task 0250").length).toBeGreaterThan(0);
  });

  it("renders every row for a small board, identically to before virtualization", () => {
    tasksMock.tasks = makeTasks(5);

    show();

    expect(renderedRowCount()).toBe(5);
    for (let index = 0; index < 5; index++) {
      expect(
        screen.queryAllByText(`Task ${String(index).padStart(4, "0")}`).length,
      ).toBeGreaterThan(0);
    }
  });
});
