import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  localStorage.clear();
  useUserPreferencesStore.setState({
    ganttNeighborhoodZoom: "fit",
    weekStartsOn: 0,
  });
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

  describe("scrolling", () => {
    const scrollContainer = () =>
      screen.getByTestId("gantt-neighborhood-scroll");

    it("has one focusable, labelled container that scrolls on both axes", () => {
      renderCard();
      const container = scrollContainer();
      expect(container).toHaveAttribute("tabindex", "0");
      expect(container).toHaveAttribute(
        "aria-label",
        "tasks:gantt.neighborhoodScrollLabel",
      );
      expect(container.className).toContain("overflow-auto");
      expect(container.className).toContain("overscroll-contain");
      expect(container.className).toContain("cursor-grab");
      // The title bar is outside the scroll container and stays fixed.
      expect(container.contains(screen.getByRole("heading"))).toBe(false);
    });

    it("keeps the date header and the task-name column sticky and opaque", () => {
      const { container } = renderCard();
      const header = container.querySelector(".sticky.top-0");
      expect(header?.className).toContain("bg-popover");
      const rails = container.querySelectorAll(
        "[data-testid=gantt-neighborhood-row] > .sticky, [data-testid=gantt-neighborhood-focus-row] > .sticky",
      );
      expect(rails).toHaveLength(4);
      for (const rail of rails) {
        expect(rail.className).toContain("left-0");
        expect(rail.className).toContain("bg-popover");
      }
    });

    it("makes the chart wider than the viewport for a long range", () => {
      renderCard({
        scheduleByTaskId: new Map([
          ["pred", { start: day("2026-01-01"), end: day("2026-01-05") }],
          ["focus", { start: day("2026-06-01"), end: day("2026-06-08") }],
          ["succ", { start: day("2026-12-01"), end: day("2026-12-12") }],
        ]),
      });
      const inner = scrollContainer().firstElementChild as HTMLElement;
      expect(Number.parseFloat(inner.style.width)).toBeGreaterThan(900);
    });

    describe("with scroll positions", () => {
      let scrollLeft = 0;
      let scrollTop = 0;
      let leftSetter: Mock<(value: number) => void>;
      beforeEach(() => {
        scrollLeft = 0;
        scrollTop = 0;
        leftSetter = vi.fn((value: number) => {
          scrollLeft = value;
        });
        // jsdom has no layout; make scroll offsets writable and record them.
        Object.defineProperty(HTMLElement.prototype, "scrollLeft", {
          configurable: true,
          get: () => scrollLeft,
          set: leftSetter,
        });
        Object.defineProperty(HTMLElement.prototype, "scrollTop", {
          configurable: true,
          get: () => scrollTop,
          set: (value: number) => {
            scrollTop = value;
          },
        });
      });
      afterEach(() => {
        delete (HTMLElement.prototype as { scrollLeft?: number }).scrollLeft;
        delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop;
      });

      it("scrolls the chart to the focus bar when it opens", () => {
        const longRange = new Map([
          ["pred", { start: day("2026-01-01"), end: day("2026-01-05") }],
          ["focus", { start: day("2026-06-01"), end: day("2026-06-08") }],
          ["succ", { start: day("2026-12-01"), end: day("2026-12-12") }],
        ]);
        renderCard({ scheduleByTaskId: longRange });
        // 2026-05-31 is the day before the bar's first day: 14px/day from
        // 2025-12-31 (the padded start) minus the margin.
        expect(leftSetter).toHaveBeenCalled();
        expect(scrollLeft).toBeGreaterThan(1000);
        const bar = screen
          .getAllByTestId("gantt-neighborhood-bar")
          .find((element) => element.dataset.focus === "true");
        expect(Number.parseFloat(bar?.style.left ?? "0") - scrollLeft).toBe(24);
      });

      it("scrolls again when the focus task changes, not on re-renders", () => {
        const { rerender, onSelectTask } = renderCard();
        const calls = leftSetter.mock.calls.length;
        rerender(
          <GanttTaskNeighborhood
            focusTaskId="focus"
            edges={edges}
            scheduleByTaskId={schedules}
            taskInfoById={info}
            onSelectTask={onSelectTask}
          />,
        );
        expect(leftSetter.mock.calls.length).toBe(calls);
        rerender(
          <GanttTaskNeighborhood
            focusTaskId="succ"
            edges={edges}
            scheduleByTaskId={schedules}
            taskInfoById={info}
            onSelectTask={onSelectTask}
          />,
        );
        expect(leftSetter.mock.calls.length).toBeGreaterThan(calls);
      });

      it("pans by dragging an empty area of the chart", () => {
        renderCard();
        const container = scrollContainer();
        scrollLeft = 200;
        scrollTop = 50;
        const target = screen.getByTestId("gantt-neighborhood-focus-row");
        fireEvent.pointerDown(target, {
          pointerId: 1,
          button: 0,
          clientX: 300,
          clientY: 100,
        });
        fireEvent.pointerMove(target, {
          pointerId: 1,
          clientX: 250,
          clientY: 90,
        });
        expect(scrollLeft).toBe(250);
        expect(scrollTop).toBe(60);
        expect(container).toHaveAttribute("data-panning", "true");
        expect(container.className).toContain("cursor-grabbing");
        fireEvent.pointerUp(target, { pointerId: 1 });
        expect(container).not.toHaveAttribute("data-panning");
        // A move after release no longer pans.
        fireEvent.pointerMove(target, {
          pointerId: 1,
          clientX: 100,
          clientY: 90,
        });
        expect(scrollLeft).toBe(250);
      });

      it("pans when the press starts on a row button, and does not open that row", () => {
        const { onSelectTask } = renderCard();
        const container = scrollContainer();
        scrollLeft = 200;
        // The rows are buttons that cover almost the whole chart, so a drag
        // that starts on one must pan (a drag only on empty background left
        // nothing to grab in a real browser).
        const button = screen.getAllByTestId("gantt-neighborhood-row")[0];
        fireEvent.pointerDown(button, {
          pointerId: 1,
          button: 0,
          clientX: 300,
          clientY: 100,
        });
        fireEvent.pointerMove(button, {
          pointerId: 1,
          clientX: 100,
          clientY: 100,
        });
        expect(scrollLeft).toBe(400);
        expect(container).toHaveAttribute("data-panning", "true");
        fireEvent.pointerUp(button, { pointerId: 1 });
        // The click a browser dispatches after the drag is swallowed.
        fireEvent.click(button);
        expect(onSelectTask).not.toHaveBeenCalled();
        // The next plain click works again.
        fireEvent.pointerDown(button, {
          pointerId: 2,
          button: 0,
          clientX: 10,
          clientY: 10,
        });
        fireEvent.pointerUp(button, { pointerId: 2 });
        fireEvent.click(button);
        expect(onSelectTask).toHaveBeenCalledWith("pred");
      });

      it("does not pan while the pointer stays under the threshold", () => {
        renderCard();
        scrollLeft = 200;
        const target = screen.getByTestId("gantt-neighborhood-focus-row");
        fireEvent.pointerDown(target, {
          pointerId: 2,
          button: 0,
          clientX: 300,
          clientY: 100,
        });
        fireEvent.pointerMove(target, {
          pointerId: 2,
          clientX: 298,
          clientY: 101,
        });
        expect(scrollLeft).toBe(200);
      });

      it("ignores a touch press (the browser pans it natively) and a secondary button", () => {
        renderCard();
        scrollLeft = 200;
        const target = screen.getByTestId("gantt-neighborhood-focus-row");
        fireEvent.pointerDown(target, {
          pointerId: 3,
          pointerType: "touch",
          button: 0,
          clientX: 300,
          clientY: 100,
        });
        fireEvent.pointerMove(target, { pointerId: 3, clientX: 100 });
        fireEvent.pointerDown(target, {
          pointerId: 4,
          button: 2,
          clientX: 300,
          clientY: 100,
        });
        fireEvent.pointerMove(target, { pointerId: 4, clientX: 100 });
        expect(scrollLeft).toBe(200);
      });

      it("still switches the task on a plain click after a tiny movement", () => {
        const { onSelectTask } = renderCard();
        const button = screen.getAllByTestId("gantt-neighborhood-row")[0];
        fireEvent.pointerDown(button, {
          pointerId: 1,
          button: 0,
          clientX: 10,
          clientY: 10,
        });
        fireEvent.pointerMove(button, {
          pointerId: 1,
          clientX: 11,
          clientY: 10,
        });
        fireEvent.pointerUp(button, { pointerId: 1 });
        fireEvent.click(button);
        expect(onSelectTask).toHaveBeenCalledWith("pred");
      });
    });
  });

  describe("scale switch", () => {
    const zoomButton = (zoom: string) =>
      screen
        .getByTestId("gantt-neighborhood-zoom")
        .querySelector(`[data-zoom=${zoom}]`) as HTMLButtonElement;
    const chartWidth = () =>
      Number.parseFloat(
        (
          screen.getByTestId("gantt-neighborhood-scroll")
            .firstElementChild as HTMLElement
        ).style.width,
      );
    const tickLabels = () =>
      [
        ...screen
          .getByTestId("gantt-neighborhood-scroll")
          .querySelectorAll(".sticky.top-0 > span.absolute"),
      ].map((tick) => tick.textContent);

    it("offers Fit and the main toolbar's four units, Fit pressed by default", () => {
      renderCard();
      const labels = [
        ...screen
          .getByTestId("gantt-neighborhood-zoom")
          .querySelectorAll("button"),
      ].map((button) => button.textContent);
      expect(labels).toEqual([
        "tasks:gantt.neighborhoodZoomFit",
        "tasks:gantt.unitDay",
        "tasks:gantt.unitWeek",
        "tasks:gantt.unitMonth",
        "tasks:gantt.unitQuarter",
      ]);
      expect(zoomButton("fit")).toHaveAttribute("aria-pressed", "true");
      expect(zoomButton("week")).toHaveAttribute("aria-pressed", "false");
      expect(
        screen.getByRole("group", {
          name: "tasks:gantt.neighborhoodZoomLabel",
        }),
      ).toBeInTheDocument();
    });

    it("is not offered when there is nothing to scale", () => {
      renderCard({ edges: [] });
      expect(screen.queryByTestId("gantt-neighborhood-zoom")).toBeNull();
    });

    it("changes the width per day and the ticks when a unit is picked", () => {
      renderCard();
      const fitWidth = chartWidth();
      const fitTicks = tickLabels();
      fireEvent.click(zoomButton("day"));
      expect(zoomButton("day")).toHaveAttribute("aria-pressed", "true");
      expect(zoomButton("fit")).toHaveAttribute("aria-pressed", "false");
      const dayBars = screen.getAllByTestId("gantt-neighborhood-bar");
      // The 5-day focus bar is 5 x 44px wide on the Day scale.
      expect(
        dayBars.find((bar) => bar.dataset.focus === "true")?.style.width,
      ).toBe("220px");
      expect(chartWidth()).not.toBe(fitWidth);

      fireEvent.click(zoomButton("month"));
      expect(
        screen
          .getAllByTestId("gantt-neighborhood-bar")
          .find((bar) => bar.dataset.focus === "true")?.style.width,
      ).toBe(`${5 * 2.96}px`);
      expect(tickLabels()).toContain("Mar 2026");
      expect(tickLabels()).not.toEqual(fitTicks);

      fireEvent.click(zoomButton("quarter"));
      expect(tickLabels()).toContain("Q1 2026");
    });

    it("persists the chosen unit per user and survives a reload", () => {
      renderCard();
      fireEvent.click(zoomButton("week"));
      expect(useUserPreferencesStore.getState().ganttNeighborhoodZoom).toBe(
        "week",
      );
      const stored = JSON.parse(
        localStorage.getItem("user-preferences") ?? "{}",
      );
      expect(stored.state.ganttNeighborhoodZoom).toBe("week");
      cleanup();

      // A new mount starts on the stored unit.
      useUserPreferencesStore.persist.rehydrate();
      renderCard();
      expect(zoomButton("week")).toHaveAttribute("aria-pressed", "true");
    });

    it("falls back to fit when the stored value is not a known scale", async () => {
      localStorage.setItem(
        "user-preferences",
        JSON.stringify({
          state: { ganttNeighborhoodZoom: "year" },
          version: 0,
        }),
      );
      await useUserPreferencesStore.persist.rehydrate();
      expect(useUserPreferencesStore.getState().ganttNeighborhoodZoom).toBe(
        "fit",
      );
    });

    it("keeps the focus task in view when the unit changes", () => {
      let scrollLeft = 0;
      Object.defineProperty(HTMLElement.prototype, "scrollLeft", {
        configurable: true,
        get: () => scrollLeft,
        set: (value: number) => {
          scrollLeft = value;
        },
      });
      try {
        renderCard({
          scheduleByTaskId: new Map([
            ["pred", { start: day("2026-01-01"), end: day("2026-01-05") }],
            ["focus", { start: day("2026-06-01"), end: day("2026-06-08") }],
            ["succ", { start: day("2026-12-01"), end: day("2026-12-12") }],
          ]),
        });
        const focusBarLeft = () =>
          Number.parseFloat(
            screen
              .getAllByTestId("gantt-neighborhood-bar")
              .find((bar) => bar.dataset.focus === "true")?.style.left ?? "0",
          );
        for (const zoom of ["day", "week", "fit"]) {
          scrollLeft = 0;
          fireEvent.click(zoomButton(zoom));
          // The bar sits at the same spot (24px margin) at every scale.
          expect(focusBarLeft() - scrollLeft).toBe(24);
        }
      } finally {
        delete (HTMLElement.prototype as { scrollLeft?: number }).scrollLeft;
      }
    });

    describe("wheel", () => {
      const sizes = (
        element: HTMLElement,
        {
          scrollHeight,
          clientHeight,
          scrollWidth,
          clientWidth,
        }: Record<string, number>,
      ) => {
        for (const [name, value] of Object.entries({
          scrollHeight,
          clientHeight,
          scrollWidth,
          clientWidth,
        })) {
          Object.defineProperty(element, name, { configurable: true, value });
        }
      };

      it("pans a chart that only overflows sideways with a vertical wheel", () => {
        renderCard();
        const container = screen.getByTestId("gantt-neighborhood-scroll");
        sizes(container, {
          scrollHeight: 300,
          clientHeight: 300,
          scrollWidth: 2000,
          clientWidth: 600,
        });
        let scrollLeft = 100;
        Object.defineProperty(container, "scrollLeft", {
          configurable: true,
          get: () => scrollLeft,
          set: (value: number) => {
            scrollLeft = value;
          },
        });
        // fireEvent returns false when the listener called preventDefault.
        expect(fireEvent.wheel(container, { deltaY: 120 })).toBe(false);
        expect(scrollLeft).toBe(220);
        expect(fireEvent.wheel(container, { deltaY: -50 })).toBe(false);
        expect(scrollLeft).toBe(170);
      });

      it("leaves the native wheel alone when the chart scrolls vertically, on a sideways swipe and on shift+wheel", () => {
        renderCard();
        const container = screen.getByTestId("gantt-neighborhood-scroll");
        sizes(container, {
          scrollHeight: 900,
          clientHeight: 300,
          scrollWidth: 2000,
          clientWidth: 600,
        });
        expect(fireEvent.wheel(container, { deltaY: 120 })).toBe(true);
        sizes(container, {
          scrollHeight: 300,
          clientHeight: 300,
          scrollWidth: 2000,
          clientWidth: 600,
        });
        expect(fireEvent.wheel(container, { deltaX: 90, deltaY: 10 })).toBe(
          true,
        );
        expect(
          fireEvent.wheel(container, { deltaY: 120, shiftKey: true }),
        ).toBe(true);
        // Nothing overflows: nothing to pan, nothing to prevent.
        sizes(container, {
          scrollHeight: 300,
          clientHeight: 300,
          scrollWidth: 600,
          clientWidth: 600,
        });
        expect(fireEvent.wheel(container, { deltaY: 120 })).toBe(true);
      });

      it("steps through the scales with ctrl+wheel and cmd+wheel", () => {
        renderCard();
        const container = screen.getByTestId("gantt-neighborhood-scroll");
        const current = () =>
          useUserPreferencesStore.getState().ganttNeighborhoodZoom;
        expect(current()).toBe("fit");
        // The fit scale is wider per day than Day here, so zooming out from it
        // lands on Day, then Week, Month and Quarter, and stops there.
        expect(fireEvent.wheel(container, { deltaY: 100, ctrlKey: true })).toBe(
          false,
        );
        expect(current()).toBe("day");
        fireEvent.wheel(container, { deltaY: 100, metaKey: true });
        expect(current()).toBe("week");
        // Small deltas (a trackpad pinch) add up to one step.
        fireEvent.wheel(container, { deltaY: 30, ctrlKey: true });
        expect(current()).toBe("week");
        fireEvent.wheel(container, { deltaY: 40, ctrlKey: true });
        expect(current()).toBe("month");
        fireEvent.wheel(container, { deltaY: 100, ctrlKey: true });
        fireEvent.wheel(container, { deltaY: 100, ctrlKey: true });
        expect(current()).toBe("quarter");
        // Zooming in goes back, one step each.
        fireEvent.wheel(container, { deltaY: -100, ctrlKey: true });
        expect(current()).toBe("month");
      });
    });
  });

  it("only animates its appearance when motion is allowed", () => {
    renderCard();
    const className = screen.getByTestId("gantt-neighborhood-card").className;
    expect(className).toContain("motion-safe:animate-");
    expect(className).not.toMatch(/(^|\s)animate-/);
  });
});
