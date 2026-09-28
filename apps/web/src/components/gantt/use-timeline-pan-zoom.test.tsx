import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isDefaultPannableTarget,
  useTimelinePanZoom,
} from "./use-timeline-pan-zoom";
import { MAX_GANTT_ZOOM, MIN_GANTT_ZOOM } from "./zoom";

// A minimal harness rendering just the hook's own wiring -- no Gantt/
// Portfolio-specific markup -- so these tests prove the hook's own
// behavior in isolation from either route.
function Harness({
  getRailWidthPx = () => 320,
}: {
  getRailWidthPx?: () => number;
}) {
  const {
    viewportRef,
    zoom,
    isPanning,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  } = useTimelinePanZoom({ getRailWidthPx });

  return (
    <div ref={viewportRef} data-testid="viewport" style={{ overflow: "auto" }}>
      <div
        data-testid="content"
        data-panning={isPanning}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <span data-testid="zoom">{zoom}</span>
        <button type="button" data-testid="task-button">
          Task
        </button>
      </div>
    </div>
  );
}

beforeEach(() => {
  // jsdom never lays anything out; the wheel handler only needs a stable
  // left offset to turn clientX into a viewport-relative pointerX.
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      x: 0,
      y: 0,
      toJSON() {},
    }),
  });
});

afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)
    .getBoundingClientRect;
});

describe("isDefaultPannableTarget", () => {
  it("excludes a button (and anything inside it)", () => {
    const button = document.createElement("button");
    const span = document.createElement("span");
    button.appendChild(span);
    expect(isDefaultPannableTarget(button)).toBe(false);
    expect(isDefaultPannableTarget(span)).toBe(false);
  });

  it("allows a plain element", () => {
    const div = document.createElement("div");
    expect(isDefaultPannableTarget(div)).toBe(true);
  });
});

describe("useTimelinePanZoom wheel-zoom", () => {
  it("starts at zoom 1 and zooms in on a vertical wheel (no ctrl needed)", () => {
    render(<Harness />);
    const viewport = screen.getByTestId("viewport");
    expect(screen.getByTestId("zoom")).toHaveTextContent("1");

    fireEvent.wheel(viewport, { deltaY: -200, clientX: 500, clientY: 40 });

    const zoomed = Number(screen.getByTestId("zoom").textContent);
    expect(zoomed).toBeGreaterThan(1);
  });

  it("zooms out on a positive deltaY", () => {
    render(<Harness />);
    const viewport = screen.getByTestId("viewport");

    fireEvent.wheel(viewport, { deltaY: 200, clientX: 500, clientY: 40 });

    const zoomed = Number(screen.getByTestId("zoom").textContent);
    expect(zoomed).toBeLessThan(1);
  });

  it("clamps at MAX_GANTT_ZOOM for a huge zoom-in gesture", () => {
    render(<Harness />);
    const viewport = screen.getByTestId("viewport");

    fireEvent.wheel(viewport, { deltaY: -100000, clientX: 500, clientY: 40 });

    expect(Number(screen.getByTestId("zoom").textContent)).toBe(MAX_GANTT_ZOOM);
  });

  it("clamps at MIN_GANTT_ZOOM for a huge zoom-out gesture", () => {
    render(<Harness />);
    const viewport = screen.getByTestId("viewport");

    fireEvent.wheel(viewport, { deltaY: 100000, clientX: 500, clientY: 40 });

    expect(Number(screen.getByTestId("zoom").textContent)).toBe(MIN_GANTT_ZOOM);
  });

  it("prevents the default scroll while zooming", () => {
    render(<Harness />);
    const viewport = screen.getByTestId("viewport");
    const event = new WheelEvent("wheel", {
      deltaY: -100,
      clientX: 500,
      clientY: 40,
      bubbles: true,
      cancelable: true,
    });
    viewport.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a deltaX-dominant (trackpad swipe) wheel event alone -- no zoom, no preventDefault", () => {
    render(<Harness />);
    const viewport = screen.getByTestId("viewport");
    const event = new WheelEvent("wheel", {
      deltaX: 100,
      deltaY: 10,
      bubbles: true,
      cancelable: true,
    });
    viewport.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByTestId("zoom")).toHaveTextContent("1");
  });

  it("anchors the zoom under the cursor: keeps the same day-content point under pointerX", () => {
    render(<Harness getRailWidthPx={() => 0} />);
    const viewport = screen.getByTestId("viewport");
    viewport.scrollLeft = 100;

    // Matches zoom.test.ts's own "keeps the day under the pointer fixed"
    // case: contentX under the pointer = 100 + 50 - 0 = 150 at zoom 1;
    // doubling zoom moves that point to 300, so scrollLeft must land at
    // 300 - 50 = 250 once the zoom step lands at exactly 2x.
    // deltaY of -Math.log(2)/0.0015 makes nextGanttZoom(1, deltaY) land on
    // exactly 2 (nextGanttZoom multiplies by exp(-deltaY * 0.0015)).
    const deltaYForExactDouble = -Math.log(2) / 0.0015;
    fireEvent.wheel(viewport, {
      deltaY: deltaYForExactDouble,
      clientX: 50,
      clientY: 40,
    });

    expect(Number(screen.getByTestId("zoom").textContent)).toBeCloseTo(2, 5);
    expect(viewport.scrollLeft).toBe(250);
  });
});

describe("useTimelinePanZoom drag-to-pan", () => {
  it("does not pan (or take pointer capture) below the movement threshold", () => {
    render(<Harness />);
    const viewport = screen.getByTestId("viewport");
    const content = screen.getByTestId("content");
    viewport.scrollLeft = 200;
    viewport.scrollTop = 30;

    fireEvent.pointerDown(content, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 500,
      clientY: 100,
    });
    fireEvent.pointerMove(content, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 502,
      clientY: 100,
    });

    expect(viewport.scrollLeft).toBe(200);
    expect(content.dataset.panning).toBe("false");
  });

  it("pans the viewport once the drag crosses the movement threshold", () => {
    render(<Harness />);
    const viewport = screen.getByTestId("viewport");
    const content = screen.getByTestId("content");
    viewport.scrollLeft = 200;
    viewport.scrollTop = 30;

    fireEvent.pointerDown(content, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 500,
      clientY: 100,
    });
    fireEvent.pointerMove(content, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 420,
      clientY: 70,
    });

    // Dragging left (clientX decreased by 80) pulls the content left, i.e.
    // increases scrollLeft by the same amount -- same "grab and pull"
    // convention as the per-project Gantt.
    expect(viewport.scrollLeft).toBe(280);
    expect(viewport.scrollTop).toBe(60);
    expect(content.dataset.panning).toBe("true");

    fireEvent.pointerUp(content, { pointerId: 1, pointerType: "mouse" });
    expect(content.dataset.panning).toBe("false");

    fireEvent.pointerMove(content, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 100,
      clientY: 100,
    });
    expect(viewport.scrollLeft).toBe(280);
  });

  it("does not start a pan from a pointerdown on a button, so its click still works", () => {
    render(<Harness />);
    const viewport = screen.getByTestId("viewport");
    const button = screen.getByTestId("task-button");
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    viewport.scrollLeft = 200;

    fireEvent.pointerDown(button, {
      button: 0,
      pointerId: 2,
      pointerType: "mouse",
      clientX: 500,
      clientY: 100,
    });
    fireEvent.pointerUp(button, {
      button: 0,
      pointerId: 2,
      pointerType: "mouse",
      clientX: 500,
      clientY: 100,
    });
    fireEvent.click(button);

    expect(viewport.scrollLeft).toBe(200);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ignores touch input, leaving native touch scrolling in charge", () => {
    render(<Harness />);
    const viewport = screen.getByTestId("viewport");
    const content = screen.getByTestId("content");
    viewport.scrollLeft = 200;

    fireEvent.pointerDown(content, {
      button: 0,
      pointerId: 3,
      pointerType: "touch",
      clientX: 500,
      clientY: 100,
    });
    fireEvent.pointerMove(content, {
      pointerId: 3,
      pointerType: "touch",
      clientX: 300,
      clientY: 100,
    });

    expect(viewport.scrollLeft).toBe(200);
  });
});
