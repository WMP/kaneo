import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskNeighborhoodDataState } from "@/components/gantt/use-task-neighborhood-data";
import { useUserPreferencesStore } from "@/store/user-preferences";
import TaskDetailsSheet from "./task-details-sheet";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/hooks/queries/task/use-get-task", () => ({
  default: () => ({ data: { number: 7 } }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: { slug: "AFB" } }),
}));
vi.mock("@/components/jira/send-to-jira-button", () => ({
  SendToJiraButton: () => null,
}));
vi.mock("./task-delete-button", () => ({ default: () => null }));
vi.mock("./task-details-content", () => ({ default: () => null }));
vi.mock("./task-properties-sidebar", () => ({ default: () => null }));

let neighborhoodState: TaskNeighborhoodDataState = { status: "idle" };
const useTaskNeighborhoodData = vi.fn((_input: unknown) => neighborhoodState);
vi.mock("@/components/gantt/use-task-neighborhood-data", () => ({
  useTaskNeighborhoodData: (input: unknown) => useTaskNeighborhoodData(input),
}));

const day = (month: number, date: number) => new Date(2026, month - 1, date);

function readyState(): TaskNeighborhoodDataState {
  return {
    status: "ready",
    data: {
      edges: [
        {
          id: "r1",
          sourceTaskId: "task-1",
          targetTaskId: "task-2",
          relationType: "blocks",
          dependencyType: "fs",
          lagDays: 0,
        },
        {
          id: "r2",
          sourceTaskId: "foreign",
          targetTaskId: "task-1",
          relationType: "blocks",
          dependencyType: "fs",
          lagDays: 0,
        },
      ],
      scheduleByTaskId: new Map([
        ["task-1", { start: day(8, 10), end: day(8, 14) }],
        ["task-2", { start: day(8, 17), end: day(8, 19) }],
        ["foreign", { start: day(8, 3), end: day(8, 7) }],
      ]),
      taskInfoById: new Map([
        ["task-1", { key: "AFB-1", title: "One" }],
        ["task-2", { key: "AFB-2", title: "Two" }],
        ["foreign", { key: "OTH-7", title: "Foreign" }],
      ]),
      violatedEdgeIds: new Set<string>(),
      projectIdByTaskId: new Map([
        ["task-1", "project-1"],
        ["task-2", "project-1"],
        ["foreign", "project-2"],
      ]),
    },
  };
}

let originalRect: typeof Element.prototype.getBoundingClientRect;

beforeEach(() => {
  navigate.mockReset();
  useTaskNeighborhoodData.mockClear();
  neighborhoodState = readyState();
  localStorage.clear();
  useUserPreferencesStore.setState({
    ganttNeighborhoodZoom: "fit",
    weekStartsOn: 0,
  });
  // jsdom has no layout: the card reads the width of its free-area element.
  originalRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function getRect() {
    return {
      width: 900,
      height: 600,
      top: 0,
      left: 0,
      right: 900,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = originalRect;
});

function renderSheet(
  props: Partial<Parameters<typeof TaskDetailsSheet>[0]> = {},
) {
  const onClose = vi.fn();
  render(
    <TaskDetailsSheet
      taskId="task-1"
      projectId="project-1"
      workspaceId="workspace-1"
      onClose={onClose}
      {...props}
    />,
  );
  return onClose;
}

describe("TaskDetailsSheet dependency neighborhood", () => {
  it("renders the card inside the sheet popup so it shares the focus trap", () => {
    renderSheet();
    const popup = document.querySelector("[data-slot=sheet-popup]");
    expect(popup).not.toBeNull();
    expect(popup).toContainElement(
      screen.getByTestId("gantt-neighborhood-card"),
    );
    expect(useTaskNeighborhoodData).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      projectId: "project-1",
      taskId: "task-1",
    });
  });

  it("does not close the sheet when the card is pressed", () => {
    const onClose = renderSheet();
    const button = screen.getByRole("button", { name: /AFB-2/ });
    fireEvent.pointerDown(button);
    fireEvent.mouseDown(button);
    fireEvent.click(button);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still closes the sheet when the blurred area outside the card is pressed", () => {
    const onClose = renderSheet();
    const viewport = document.querySelector("[data-slot=sheet-viewport]");
    expect(viewport).not.toBeNull();
    fireEvent.pointerDown(viewport as Element);
    fireEvent.mouseDown(viewport as Element);
    fireEvent.click(viewport as Element);
    expect(onClose).toHaveBeenCalled();
  });

  it("draws nothing when showNeighborhood is false", () => {
    renderSheet({ showNeighborhood: false });
    expect(screen.queryByTestId("gantt-neighborhood-aside")).toBeNull();
  });

  it("draws nothing while the data hook is idle", () => {
    neighborhoodState = { status: "idle" };
    renderSheet();
    expect(screen.queryByTestId("gantt-neighborhood-card")).toBeNull();
  });

  it("shows a loading state while the data loads", () => {
    neighborhoodState = { status: "loading" };
    renderSheet();
    expect(screen.getByTestId("gantt-neighborhood-loading")).toBeTruthy();
    expect(screen.queryByTestId("gantt-neighborhood-card")).toBeNull();
  });

  it("shows a compact error with a retry when the data failed", () => {
    const retry = vi.fn();
    neighborhoodState = { status: "error", retry };
    renderSheet();
    expect(screen.getByTestId("gantt-neighborhood-error")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:loadState.retry" }),
    );
    expect(retry).toHaveBeenCalledTimes(1);
    // The sheet itself is unaffected.
    expect(document.querySelector("[data-slot=sheet-popup]")).not.toBeNull();
  });

  it("switches a same-project neighbor through the taskId search param", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /AFB-2/ }));
    expect(navigate).toHaveBeenCalledWith({
      to: ".",
      search: { taskId: "task-2" },
      replace: true,
    });
  });

  it("opens a cross-project neighbor on its own task route", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /OTH-7/ }));
    expect(navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: {
        workspaceId: "workspace-1",
        projectId: "project-2",
        taskId: "foreign",
      },
    });
  });

  it("lets a view take over the neighbor selection", () => {
    const onSelectNeighborTask = vi.fn();
    renderSheet({ onSelectNeighborTask });
    fireEvent.click(screen.getByRole("button", { name: /OTH-7/ }));
    expect(onSelectNeighborTask).toHaveBeenCalledWith("foreign", "project-2");
    expect(navigate).not.toHaveBeenCalled();
  });
});
