import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DependencyEdgeInput } from "./dependency-lines";
import {
  GanttTaskNeighborhood,
  type NeighborhoodTaskInfo,
} from "./gantt-task-neighborhood-card";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// jsdom has no layout: the card reads the width of its free-area element.
let availableWidth = 900;
let originalRect: typeof Element.prototype.getBoundingClientRect;

beforeEach(() => {
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
  Element.prototype.getBoundingClientRect = originalRect;
  vi.unstubAllGlobals();
  cleanup();
});

const day = (value: string) => new Date(`${value}T00:00:00`);

const info = new Map<string, NeighborhoodTaskInfo>([
  ["pred", { key: "AFB-35", title: "Design the schema" }],
  ["focus", { key: "AFB-36", title: "Build the API" }],
  ["succ", { key: "AFB-37", title: "Write the docs" }],
  ["undated", { key: "AFB-38", title: "Someday", isDerived: false }],
]);

const schedules = new Map([
  ["pred", { start: day("2026-03-01"), end: day("2026-03-03") }],
  ["focus", { start: day("2026-03-04"), end: day("2026-03-08") }],
  ["succ", { start: day("2026-03-09"), end: day("2026-03-12") }],
]);

const edges: DependencyEdgeInput[] = [
  {
    id: "e1",
    sourceTaskId: "pred",
    targetTaskId: "focus",
    relationType: "blocks",
  },
  {
    id: "e2",
    sourceTaskId: "focus",
    targetTaskId: "succ",
    relationType: "related",
  },
  {
    id: "e3",
    sourceTaskId: "focus",
    targetTaskId: "undated",
    relationType: "blocks",
  },
];

function renderCard(
  overrides: Partial<React.ComponentProps<typeof GanttTaskNeighborhood>> = {},
) {
  const onSelectTask = vi.fn();
  const view = render(
    <GanttTaskNeighborhood
      focusTaskId="focus"
      edges={edges}
      scheduleByTaskId={schedules}
      taskInfoById={info}
      onSelectTask={onSelectTask}
      {...overrides}
    />,
  );
  return { ...view, onSelectTask };
}

describe("GanttTaskNeighborhood", () => {
  it("shows the header with the task key and the neighbor count", () => {
    renderCard();
    expect(
      screen.getByRole("region", {
        name: 'tasks:gantt.neighborhoodTitle:{"key":"AFB-36"}',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('tasks:gantt.neighborhoodCount:{"count":3}'),
    ).toBeInTheDocument();
  });

  it("lists predecessors, the highlighted focus row and successors in order", () => {
    renderCard();
    const rows = [
      ...screen
        .getByRole("region")
        .querySelectorAll(
          "[data-testid=gantt-neighborhood-row], [data-testid=gantt-neighborhood-focus-row]",
        ),
    ].map((row) => row.getAttribute("data-testid"));
    expect(rows).toEqual([
      "gantt-neighborhood-row",
      "gantt-neighborhood-focus-row",
      "gantt-neighborhood-row",
      "gantt-neighborhood-row",
    ]);

    const focusRow = screen.getByTestId("gantt-neighborhood-focus-row");
    expect(focusRow).toHaveAttribute("aria-current", "true");
    expect(focusRow).toHaveTextContent("AFB-36");
    expect(focusRow).toHaveTextContent("Build the API");
    // The focus row is not a button: there is nothing to switch to.
    expect(focusRow.querySelector("button")).toBeNull();

    const bars = screen.getAllByTestId("gantt-neighborhood-bar");
    expect(bars.filter((bar) => bar.dataset.focus === "true")).toHaveLength(1);
    expect(bars).toHaveLength(3);
  });

  it("labels the predecessor and successor groups", () => {
    renderCard();
    const predecessors = screen.getByRole("list", {
      name: "tasks:gantt.neighborhoodPredecessors",
    });
    const successors = screen.getByRole("list", {
      name: "tasks:gantt.neighborhoodSuccessors",
    });
    expect(predecessors).toHaveTextContent("AFB-35");
    expect(successors).toHaveTextContent("AFB-37");
    expect(successors).toHaveTextContent("AFB-38");
  });

  it("switches to a neighbor when its row is clicked", () => {
    const { onSelectTask } = renderCard();
    fireEvent.click(
      screen.getByRole("button", {
        name: 'tasks:gantt.neighborhoodOpenTask:{"key":"AFB-35"}',
      }),
    );
    expect(onSelectTask).toHaveBeenCalledWith("pred");
    fireEvent.click(
      screen.getByRole("button", {
        name: 'tasks:gantt.neighborhoodOpenTask:{"key":"AFB-37"}',
      }),
    );
    expect(onSelectTask).toHaveBeenLastCalledWith("succ");
  });

  it("lists an undated neighbor with a no-dates hint and no bar", () => {
    renderCard();
    const row = screen.getByRole("button", {
      name: 'tasks:gantt.neighborhoodOpenTask:{"key":"AFB-38"}',
    });
    expect(row).toHaveTextContent("tasks:gantt.neighborhoodNoDates");
    expect(
      row.querySelector("[data-testid=gantt-neighborhood-bar]"),
    ).toBeNull();
  });

  it("draws the edges between rows with blocks solid and related dashed", () => {
    const { container } = renderCard();
    const blocks = container.querySelectorAll('[data-edge-kind="blocks"]');
    const related = container.querySelectorAll('[data-edge-kind="related"]');
    // e1 (pred -> focus) and e2 (focus -> succ); e3 ends at an undated task.
    expect(blocks).toHaveLength(1);
    expect(related).toHaveLength(1);
    expect(related[0]).toHaveAttribute("stroke-dasharray");
    expect(blocks[0]).not.toHaveAttribute("stroke-dasharray");
  });

  it("draws a violated edge red", () => {
    const { container } = renderCard({ violatedEdgeIds: new Set(["e1"]) });
    expect(
      container.querySelector('[data-edge-kind="violated"]'),
    ).toHaveAttribute("stroke", "var(--destructive)");
  });

  it("does not render the editable dependency type labels", () => {
    const { container } = renderCard();
    expect(container.querySelector("foreignObject")).toBeNull();
  });

  it("shows an empty state for a task with no relations", () => {
    renderCard({ edges: [] });
    expect(screen.getByTestId("gantt-neighborhood-empty")).toHaveTextContent(
      "tasks:gantt.neighborhoodEmpty",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is hidden when the free area is narrower than the minimum", () => {
    availableWidth = 479;
    renderCard();
    expect(screen.queryByTestId("gantt-neighborhood-card")).toBeNull();
    cleanup();

    availableWidth = 480;
    renderCard();
    expect(screen.getByTestId("gantt-neighborhood-card")).toBeInTheDocument();
  });

  it("fits the card into the free area with margins", () => {
    availableWidth = 600;
    renderCard();
    expect(screen.getByTestId("gantt-neighborhood-card")).toHaveStyle({
      width: "552px",
    });
  });

  it("only animates its appearance when motion is allowed", () => {
    renderCard();
    const className = screen.getByTestId("gantt-neighborhood-card").className;
    expect(className).toContain("motion-safe:animate-");
    expect(className).not.toMatch(/(^|\s)animate-/);
  });
});
