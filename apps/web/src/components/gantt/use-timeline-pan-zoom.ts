// Reusable Gantt-style pan/zoom wiring for a horizontally scrollable
// timeline: drag-to-pan, wheel/trackpad panning, and ctrl/cmd-wheel zoom
// anchored under the cursor. Built entirely on the per-project Gantt's own
// pure math (zoom.ts/pan.ts) so the two views can never drift apart on *how*
// a wheel notch or a drag maps to scroll/zoom -- only on which DOM elements
// they're wired to. See gantt.tsx's handleChartPointerDown/handleChartPointerMove/
// endChartPan and its native wheel listener for the pattern this mirrors.
//
// This hook intentionally does not touch the existing Gantt route -- it's a
// new extraction for Portfolio (and any future timeline) to consume.
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { computePanScrollPosition } from "./pan";
import {
  clampGanttZoom,
  isZoomWheelGesture,
  nextGanttZoom,
  normalizeWheelDeltaY,
  scrollLeftForZoom,
} from "./zoom";

// A pointerdown that never moves more than this many pixels is a click/tap,
// not a drag -- below this threshold no scroll position is touched and
// pointer capture is never taken, so a task bar, row button, or any other
// clickable element inside the pannable area still receives its normal
// click. Above it, the gesture commits to panning for the rest of the drag
// (per pointerId) even if the pointer doubles back under the threshold.
const DEFAULT_DRAG_THRESHOLD_PX = 4;

// Matches gantt.tsx's own isPannableTarget: everything is pannable except an
// actual interactive control, which handles its own click/drag. Exported so
// a caller can extend it (e.g. also excluding a data attribute) rather than
// re-deriving the base selector.
export function isDefaultPannableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return !target.closest('button, input, a, [role="button"], textarea, select');
}

export type UseTimelinePanZoomOptions = {
  // Starting zoom factor (1 = the caller's own base/unzoomed column width).
  // Clamped to [MIN_GANTT_ZOOM, MAX_GANTT_ZOOM] like every other zoom value.
  initialZoom?: number;
  // The scrollable content's rail width in pixels *at the time it's called*
  // (a getter rather than a plain number so a resize or a rail being hidden
  // is always read fresh, the same reason gantt.tsx mirrors barsLeftPx into
  // a ref for its own wheel handler instead of closing over the value).
  getRailWidthPx: () => number;
  // Whether a pointerdown at this target may start a drag-to-pan. Defaults
  // to isDefaultPannableTarget; override to also exclude view-specific
  // elements (e.g. an external/read-only bar, as gantt.tsx does for
  // [data-gantt-external-bar]).
  isPannableTarget?: (target: EventTarget | null) => boolean;
  // Whether a wheel event at this target should be left alone entirely (no
  // zoom, no preventDefault) -- e.g. gantt.tsx's own rail area, which keeps
  // its native vertical scroll.
  isWheelZoomExcluded?: (target: EventTarget | null) => boolean;
  dragThresholdPx?: number;
  // Forces the native wheel listener to (re)attach once the viewport
  // element actually mounts -- needed because the viewport is often behind
  // a loading/empty conditional, so the ref is still null on the render
  // that first runs this hook's effect. Mirrors gantt.tsx's own
  // `chartIsMounted` dependency on its wheel-listener effect. Defaults to
  // true (viewport assumed mounted up front).
  enabled?: boolean;
};

export type UseTimelinePanZoomResult = {
  // Attach to the scrollable (`overflow-auto`) viewport element itself --
  // both the native wheel listener and drag-to-pan read/write its
  // scrollLeft/scrollTop directly.
  viewportRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  setZoom: (zoom: number | ((current: number) => number)) => void;
  // True only once a pointer drag has actually crossed the movement
  // threshold -- useful for a `cursor-grabbing` style, matching gantt.tsx's
  // own isPanning.
  isPanning: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
  dragging: boolean;
};

export function useTimelinePanZoom(
  options: UseTimelinePanZoomOptions,
): UseTimelinePanZoomResult {
  const {
    initialZoom = 1,
    dragThresholdPx = DEFAULT_DRAG_THRESHOLD_PX,
    enabled = true,
  } = options;

  // Mirrored into a ref on every render (rather than listed in the
  // callbacks'/effect's own dependency arrays) so a caller can pass fresh
  // inline closures each render -- as Portfolio does for getRailWidthPx,
  // which reads live rem/isMobile state -- without forcing the wheel
  // listener to tear down and reattach on every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoomState] = useState(() => clampGanttZoom(initialZoom));
  const [isPanning, setIsPanning] = useState(false);
  const dragStateRef = useRef<DragState | null>(null);
  // Set by the wheel handler when a zoom step changes the day-column width;
  // applied by a layout effect once the caller's re-render has actually
  // committed the new width, since the target scrollLeft has to be computed
  // against the NEW scrollWidth, not the one at wheel time. Same two-step
  // pattern gantt.tsx uses for its own pendingScrollLeftRef.
  const pendingScrollLeftRef = useRef<number | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || event.pointerType !== "mouse") return;
      const isPannableTarget =
        optionsRef.current.isPannableTarget ?? isDefaultPannableTarget;
      if (!isPannableTarget(event.target)) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScrollLeft: viewport.scrollLeft,
        startScrollTop: viewport.scrollTop,
        dragging: false,
      };
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      const viewport = viewportRef.current;
      if (!state || state.pointerId !== event.pointerId || !viewport) return;
      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;
      if (!state.dragging) {
        // Below the threshold: this may still turn into a click/tap, so
        // nothing is touched yet -- no scroll write, no pointer capture.
        if (Math.hypot(deltaX, deltaY) < dragThresholdPx) return;
        state.dragging = true;
        setIsPanning(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }
      const next = computePanScrollPosition({
        startScrollLeft: state.startScrollLeft,
        startScrollTop: state.startScrollTop,
        deltaX,
        deltaY,
      });
      viewport.scrollLeft = next.scrollLeft;
      viewport.scrollTop = next.scrollTop;
    },
    [dragThresholdPx],
  );

  const endPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    if (state.dragging) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setIsPanning(false);
    }
  }, []);

  // Native (non-passive) wheel listener: React's onWheel is always passive,
  // which silently ignores preventDefault() and would leave the page
  // scrolling underneath the zoom. See gantt.tsx's identical listener for
  // the full reasoning behind each branch below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `enabled` forces the listener to (re)attach once the viewport mounts (e.g. past a loading/empty conditional); the closure itself only reads optionsRef and refs, not this value.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.shiftKey) return;
      const isWheelZoomExcluded = optionsRef.current.isWheelZoomExcluded;
      if (isWheelZoomExcluded?.(event.target)) return;
      if (!isZoomWheelGesture(event.deltaX, event.deltaY, event.ctrlKey)) {
        return;
      }
      event.preventDefault();
      const normalizedDeltaY = normalizeWheelDeltaY(
        event.deltaY,
        event.deltaMode,
        window.innerHeight,
      );
      setZoomState((currentZoom) => {
        const next = nextGanttZoom(currentZoom, normalizedDeltaY);
        if (next === currentZoom) return currentZoom;
        const rect = viewport.getBoundingClientRect();
        pendingScrollLeftRef.current = scrollLeftForZoom({
          scrollLeft: viewport.scrollLeft,
          pointerX: event.clientX - rect.left,
          railWidthPx: optionsRef.current.getRailWidthPx(),
          oldZoom: currentZoom,
          newZoom: next,
        });
        return next;
      });
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [enabled]);

  // Applies the scrollLeft computed above once, after this render commits
  // the new zoomed width to the DOM -- otherwise it would be computed and
  // clamped against the OLD scrollWidth.
  // biome-ignore lint/correctness/useExhaustiveDependencies: zoom is listed to force this to run right after the zoomed grid commits; the body itself only reads the pending-scroll ref.
  useLayoutEffect(() => {
    const pending = pendingScrollLeftRef.current;
    if (pending == null) return;
    pendingScrollLeftRef.current = null;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollLeft = pending;
  }, [zoom]);

  const setZoom = useCallback(
    (next: number | ((current: number) => number)) => {
      setZoomState((current) =>
        clampGanttZoom(typeof next === "function" ? next(current) : next),
      );
    },
    [],
  );

  return {
    viewportRef,
    zoom,
    setZoom,
    isPanning,
    onPointerDown,
    onPointerMove,
    onPointerUp: endPan,
    onPointerCancel: endPan,
  };
}
