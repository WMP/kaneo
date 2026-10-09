import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { Route as BacklogRoute } from "./backlog";
import { Route as BoardRoute } from "./board";
import { Route as CalendarRoute } from "./calendar";

// Opening a task from the Calendar, the Board, the List or the Backlog shows the
// dependency neighborhood card in the details sheet. The sheet, the card and
// the data hook are real; the views' data hooks and heavy children are stubbed.

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const navigate = vi.fn();
const routeParams = { workspaceId: "workspace-1", projectId: "project-1" };
const routeSearch: { taskId: string | undefined } = { taskId: "task-1" };

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as Record<string, unknown>),
    useParams: () => routeParams,
    useSearch: () => routeSearch,
  }),
  useNavigate: () => navigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));

// Server state: the same hook modules the views and the sheet's data hook use.
const useGetTasks: Mock = vi.fn();
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: (projectId: string, options?: unknown) =>
    useGetTasks(projectId, options),
}));
const projectRelations: { data: unknown } = { data: undefined };
const useGetProjectTaskRelations: Mock = vi.fn(() => projectRelations);
vi.mock("@/hooks/queries/task-relation/use-get-project-task-relations", () => ({
  default: (projectId: string, options?: unknown) =>
    useGetProjectTaskRelations(projectId, options),
}));
vi.mock("@/hooks/queries/calendar/use-get-calendar", () => ({
  default: () => ({ data: undefined }),
}));

// The sheet's own content.
vi.mock("@/hooks/queries/task/use-get-task", () => ({
  default: () => ({ data: { number: 1 } }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: { slug: "AFB" } }),
}));
vi.mock("@/components/jira/send-to-jira-button", () => ({
  SendToJiraButton: () => null,
}));
vi.mock("@/components/task/task-delete-button", () => ({
  default: () => null,
}));
vi.mock("@/components/task/task-details-content", () => ({
  default: () => null,
}));
vi.mock("@/components/task/task-properties-sidebar", () => ({
  default: () => null,
}));

// The views' chrome and data.
vi.mock("@/components/common/project-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/shared/modals/create-task-modal", () => ({
  default: () => null,
}));
vi.mock("@/components/calendar/calendar-toolbar", () => ({
  default: () => null,
}));
vi.mock("@/components/calendar/month-grid", () => ({ default: () => null }));
vi.mock("@/components/board/board-toolbar", () => ({ default: () => null }));
vi.mock("@/components/kanban-board", () => ({ default: () => null }));
vi.mock("@/components/list-view", () => ({ default: () => null }));
vi.mock("@/components/backlog-list-view", () => ({ default: () => null }));
vi.mock("@/hooks/use-keyboard-shortcuts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-keyboard-shortcuts")>()),
  useRegisterShortcuts: () => undefined,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-board-sort", () => ({
  useBoardSort: () => ({
    sort: { field: "position", direction: "asc" },
    setSort: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/task/use-description-matches", () => ({
  useDescriptionMatches: () => ({
    isLoading: false,
    isError: false,
    ids: undefined,
    retry: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-task-filters-with-labels-support", () => ({
  useTaskFiltersWithLabelsSupport: (project: unknown) => ({
    filters: {},
    updateFilter: vi.fn(),
    updateLabelFilter: vi.fn(),
    updateCustomFieldFilter: vi.fn(),
    filteredProject: project,
    hasActiveFilters: false,
    clearFilters: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/project-member/use-project-members", () => ({
  useProjectMembers: () => ({ data: undefined }),
}));
vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: () => ({ data: [] }),
}));
vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-fields-by-project",
  () => ({
    default: () => ({ data: [] }),
  }),
);
vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-field-filter-values",
  () => ({ default: () => ({ data: [] }) }),
);
vi.mock(
  "@/hooks/queries/custom-field/use-get-all-custom-field-values-by-project",
  () => ({ default: () => ({ getValuesForTask: () => [] }) }),
);
vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutate: vi.fn() }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));

function task(id: string, number: number, startDate: string, dueDate: string) {
  return {
    id,
    title: `Task ${number}`,
    number,
    description: null,
    status: "to-do",
    priority: "medium",
    startDate,
    dueDate,
    progress: 0,
    isMilestone: false,
    estimateMinutes: null,
    estimateUnit: "hours",
    position: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "project-1",
    labels: [],
  };
}

function endpoint(
  id: string,
  number: number,
  projectId: string,
  projectSlug: string,
  startDate: string,
  dueDate: string,
) {
  return {
    id,
    title: `Task ${number}`,
    number,
    status: "to-do",
    priority: "medium",
    projectId,
    projectName: projectSlug,
    projectSlug,
    userId: null,
    assigneeName: null,
    startDate,
    dueDate,
    isMilestone: false,
    estimateMinutes: null,
    estimateUnit: "hours",
  };
}

const t1 = task("task-1", 1, "2026-08-10", "2026-08-14");
const t2 = task("task-2", 2, "2026-08-17", "2026-08-19");
const foreign = endpoint(
  "foreign-1",
  7,
  "project-2",
  "OTH",
  "2026-08-03",
  "2026-08-07",
);

function relation(
  id: string,
  source: ReturnType<typeof endpoint>,
  target: ReturnType<typeof endpoint>,
) {
  return {
    id,
    sourceTaskId: source.id,
    targetTaskId: target.id,
    relationType: "blocks",
    dependencyType: "fs",
    lagDays: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    sourceTask: source,
    targetTask: target,
  };
}

let availableWidth = 900;
let originalRect: typeof Element.prototype.getBoundingClientRect;

beforeEach(() => {
  localStorage.clear();
  navigate.mockReset();
  routeSearch.taskId = "task-1";
  availableWidth = 900;
  originalRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function getRect() {
    return {
      width: availableWidth,
      height: 600,
      top: 0,
      left: 0,
      right: availableWidth,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  };
  useUserPreferencesStore.setState({
    ganttNeighborhoodZoom: "fit",
    weekStartsOn: 0,
    viewMode: "board",
  });
  useGetTasks.mockReturnValue({
    data: {
      id: "project-1",
      name: "Roadmap",
      slug: "AFB",
      columns: [{ id: "col-1", name: "To do", tasks: [t1, t2] }],
      plannedTasks: [],
      archivedTasks: [],
    },
  });
  useGetProjectTaskRelations.mockClear();
  projectRelations.data = [
    relation(
      "r-cross",
      foreign,
      endpoint("task-1", 1, "project-1", "AFB", t1.startDate, t1.dueDate),
    ),
    relation(
      "r-same",
      endpoint("task-1", 1, "project-1", "AFB", t1.startDate, t1.dueDate),
      endpoint("task-2", 2, "project-1", "AFB", t2.startDate, t2.dueDate),
    ),
  ];
});

afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = originalRect;
});

const views: [string, { component?: ComponentType }, () => void][] = [
  ["Calendar", CalendarRoute as never, () => {}],
  [
    "Board",
    BoardRoute as never,
    () => useUserPreferencesStore.setState({ viewMode: "board" }),
  ],
  [
    "List",
    BoardRoute as never,
    () => useUserPreferencesStore.setState({ viewMode: "list" }),
  ],
  ["Backlog", BacklogRoute as never, () => {}],
];

describe.each(views)("%s opens a task", (_name, route, prepare) => {
  const View = route.component as ComponentType;

  it("shows the dependency neighborhood card in the details sheet", () => {
    prepare();
    render(<View />);
    const popup = document.querySelector("[data-slot=sheet-popup]");
    expect(popup).not.toBeNull();
    expect(popup).toContainElement(
      screen.getByTestId("gantt-neighborhood-card"),
    );
    expect(screen.getByRole("button", { name: /AFB-2/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /OTH-7/ })).toBeTruthy();
    // The queries are enabled for the open task only.
    expect(useGetProjectTaskRelations).toHaveBeenCalledWith("project-1", {
      enabled: true,
    });
  });

  it("switches to a neighbor of the same project through the taskId search param", () => {
    prepare();
    render(<View />);
    fireEvent.click(screen.getByRole("button", { name: /AFB-2/ }));
    expect(navigate).toHaveBeenCalledWith({
      to: ".",
      search: { taskId: "task-2" },
      replace: true,
    });
  });

  it("opens a neighbor of another project on its own task route", () => {
    prepare();
    render(<View />);
    fireEvent.click(screen.getByRole("button", { name: /OTH-7/ }));
    expect(navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: {
        workspaceId: "workspace-1",
        projectId: "project-2",
        taskId: "foreign-1",
      },
    });
  });

  it("draws no card and requests no relations while no task is open", () => {
    prepare();
    routeSearch.taskId = undefined;
    render(<View />);
    expect(screen.queryByTestId("gantt-neighborhood-card")).toBeNull();
    // A closed sheet mounts no content, so nothing is requested for it.
    expect(useGetProjectTaskRelations).not.toHaveBeenCalledWith("project-1", {
      enabled: true,
    });
  });
});

describe("neighborhood while the relations load", () => {
  it("shows a loading state in the card", () => {
    projectRelations.data = undefined;
    const View = (CalendarRoute as unknown as { component: ComponentType })
      .component;
    render(<View />);
    expect(screen.getByTestId("gantt-neighborhood-loading")).toBeTruthy();
    expect(screen.queryByTestId("gantt-neighborhood-card")).toBeNull();
  });
});
