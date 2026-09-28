import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for the FS-successor rule: a "blocks" relation whose
// cross-project far end has NO dates of its own must still render on the Gantt,
// positioned from its dated predecessor (see gantt-derived-schedule.ts and
// the externalRelatedTasks memo in the Gantt route), rather than vanishing
// together with its dependency line the way a dateless far end used to.
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
// own-pred BLOCKS (FS) a task in another project that has NO dates of its own.
vi.mock("@/hooks/queries/task-relation/use-get-project-task-relations", () => ({
  default: () => ({
    data: [
      {
        id: "relation-1",
        sourceTaskId: "own-pred",
        targetTaskId: "task-external-undated",
        relationType: "blocks",
        dependencyType: "fs",
        lagDays: 0,
        createdAt: "2026-08-01T00:00:00.000Z",
        sourceTask: {
          id: "own-pred",
          title: "Own predecessor",
          status: "to-do",
          priority: "medium",
          number: 1,
          projectId: "project",
          projectName: "Project",
          projectSlug: "PROJ",
          userId: null,
          assigneeName: null,
          startDate: "2026-08-10",
          dueDate: "2026-08-14",
          isMilestone: false,
        },
        targetTask: {
          id: "task-external-undated",
          title: "Sign the OVH contract",
          status: "to-do",
          priority: "low",
          number: 9,
          projectId: "other-project",
          projectName: "Other Project",
          projectSlug: "OTHER",
          userId: null,
          assigneeName: null,
          startDate: null,
          dueDate: null,
          isMilestone: false,
        },
      },
    ],
  }),
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
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
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

describe("Gantt derives a dateless cross-project FS successor's position", () => {
  it("renders the undated cross-project successor as a derived external row", () => {
    show();

    // The successor has no dates of its own, but is shown anyway...
    expect(screen.getAllByText("Sign the OVH contract").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByText(
        'tasks:gantt.externalProjectBadge:{"projectName":"Other Project"}',
      ),
    ).toBeInTheDocument();
    // ...with the DERIVED tooltip, not the plain dated-external one, so it
    // never reads as a real dated bar.
    expect(
      screen.getByTitle(
        'tasks:gantt.externalTaskDerivedTitle:{"title":"Sign the OVH contract","projectName":"Other Project"}',
      ),
    ).toBeInTheDocument();
  });
});
