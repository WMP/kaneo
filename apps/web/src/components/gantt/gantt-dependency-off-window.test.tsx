import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Off-window dependency endpoints, end to end through the Gantt route: a task
// whose row exists but whose dates lie outside the visible time window must
// not draw a long connector to the overlay edge. The on-screen end gets a
// short stub and a chip naming the far task, and clicking the chip pages the
// window to it (the route's existing showDate paging) and scrolls to it.
const m = vi.hoisted(() => ({
  component: (() => null) as ComponentType,
  relations: [] as Record<string, unknown>[],
  tasks: [] as Record<string, unknown>[],
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
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: () => ({
    data: {
      id: "project",
      name: "Project",
      slug: "PROJ",
      columns: [{ tasks: m.tasks }],
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
vi.mock("@/hooks/mutations/task-relation/use-update-task-relation", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: () => ({ canUpdateTasks: () => true }),
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

await import(
  "@/routes/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/gantt"
);

function task(id: string, number: number, startDate: string, dueDate: string) {
  return {
    id,
    projectId: "project",
    title: `Task ${number}`,
    number,
    status: "to-do",
    startDate,
    dueDate,
    description: "",
    labels: [],
    priority: "low",
    position: number,
  };
}

function relatedTask(
  id: string,
  number: number,
  startDate: string,
  dueDate: string,
) {
  return {
    id,
    title: `Task ${number}`,
    status: "to-do",
    priority: "low",
    number,
    projectId: "project",
    projectName: "Project",
    projectSlug: "PROJ",
    userId: null,
    assigneeName: null,
    startDate,
    dueDate,
  };
}

function relation(
  source: ReturnType<typeof relatedTask>,
  target: ReturnType<typeof relatedTask>,
) {
  return {
    id: `relation-${source.id}-${target.id}`,
    sourceTaskId: source.id,
    targetTaskId: target.id,
    relationType: "blocks",
    createdAt: "2026-08-01T00:00:00.000Z",
    sourceTask: source,
    targetTask: target,
  };
}

const scrollLeftWrites: number[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 24));
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
  scrollLeftWrites.length = 0;
  Object.defineProperty(HTMLElement.prototype, "scrollLeft", {
    configurable: true,
    get: () => 0,
    set: (value: number) => {
      scrollLeftWrites.push(value);
    },
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
    "scrollLeft",
  ] as const) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
  m.relations = [];
  m.tasks = [];
});

function show() {
  const Component = m.component;
  return render(<Component />);
}

// Extent of a connector path's x coordinates (corners included).
function extentX(path: string) {
  const xs = [...path.matchAll(/(?:[MLQ]|,) ([\d.-]+) ([\d.-]+)/g)].map((m) =>
    Number(m[1]),
  );
  return Math.max(...xs) - Math.min(...xs);
}

describe("Gantt off-window dependency endpoints", () => {
  const near = relatedTask("task-near", 1, "2026-08-20", "2026-08-25");
  const far = relatedTask("task-far", 3, "2027-02-01", "2027-02-05");
  const old = relatedTask("task-old", 4, "2026-01-05", "2026-01-09");

  function setup(edge: ReturnType<typeof relation>) {
    m.tasks = [
      task("task-near", 1, "2026-08-20", "2026-08-25"),
      task("task-far", 3, "2027-02-01", "2027-02-05"),
      task("task-old", 4, "2026-01-05", "2026-01-09"),
    ];
    m.relations = [edge];
    return show();
  }

  const connectors = (container: HTMLElement) =>
    container.querySelectorAll("svg path[data-edge-kind]");
  const chips = (container: HTMLElement) =>
    container.querySelectorAll("[data-testid=gantt-dependency-chip] button");

  it("draws a short stub and a chip for a target after the window instead of a long line", () => {
    const { container } = setup(relation(near, far));

    const lines = connectors(container);
    expect(lines).toHaveLength(1);
    // Only the stub: no run across the chart to the window edge.
    expect(extentX(lines[0].getAttribute("d") ?? "")).toBe(24);
    const found = chips(container);
    expect(found).toHaveLength(1);
    expect(found[0].textContent).toMatch(/^PROJ-3 · .* →$/);
    expect(found[0].getAttribute("aria-label")).toContain("PROJ-3");
  });

  it("draws a short stub into the target and a chip for a source before the window", () => {
    const { container } = setup(relation(old, near));

    const lines = connectors(container);
    expect(lines).toHaveLength(1);
    expect(extentX(lines[0].getAttribute("d") ?? "")).toBe(24);
    const found = chips(container);
    expect(found).toHaveLength(1);
    expect(found[0].textContent).toMatch(/^← PROJ-4 · /);
  });

  it("pages the window to the other task and scrolls to it when the chip is clicked", () => {
    const { container, getByLabelText } = setup(relation(near, far));
    const periodStart = getByLabelText(
      "tasks:gantt.periodStart",
    ) as HTMLInputElement;
    const before = periodStart.value;
    scrollLeftWrites.length = 0;

    fireEvent.click(chips(container)[0]);

    // The same paging the rail's "show task dates" button uses
    // (showDate(date - 7 days)): the window moves forward, clamped to the
    // latest start the project's bounds allow, so task 3 (Feb 1) is inside.
    expect(periodStart.value > before).toBe(true);
    expect(periodStart.value).toBe("2026-12-07");
    expect(scrollLeftWrites.length).toBeGreaterThan(0);
    expect(scrollLeftWrites.every((value) => value >= 0)).toBe(true);
    // The window moved, so the first task is now the off-window one.
    const found = chips(container);
    expect(found).toHaveLength(1);
    expect(found[0].textContent).toMatch(/^← PROJ-1 · /);
  });

  it("keeps the chip keyboard focusable with an accessible name", () => {
    const { container } = setup(relation(near, far));
    const button = chips(container)[0] as HTMLButtonElement;
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-label")).toBeTruthy();
  });
});
