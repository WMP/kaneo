import type { RefObject } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

export type GanttVirtualRow = {
  /** The row's stable identity (a task id) — matches whatever `keys` held at
   * this index when it was last computed. */
  key: string;
  index: number;
  /** Pixel offset from the top of the full (virtual) row list. */
  start: number;
  /** This row's current height: measured once it has actually rendered (see
   * `measureRow`), the caller's estimate until then. */
  size: number;
};

export type UseGanttRowVirtualizerOptions = {
  /** Ordered row keys (task ids), top to bottom, exactly as rendered. */
  keys: readonly string[];
  /** The single element whose scrollTop/clientHeight drive the window. The
   * Gantt task rail and timeline pane are two grid columns of the SAME row
   * element (not separate scroll containers — see gantt.tsx), so windowing
   * this one shared scroll container keeps both columns in lockstep for
   * free; there is no separate sync step. */
  scrollElementRef: RefObject<HTMLElement | null>;
  /** A row's height before it has ever been measured (or after its key
   * temporarily left the window and the cache was cleared — it never is,
   * see below). Called per key so callers can vary it (e.g. a taller row
   * for a task with a baseline). */
  estimateSize: (key: string) => number;
  /** Extra pixels rendered above/below the visible viewport, so a fast
   * scroll doesn't flash empty space before the next frame's rows mount. */
  overscanPx?: number;
};

export type UseGanttRowVirtualizerResult = {
  /** Only the rows currently in (or near) the viewport — mount exactly
   * these, nothing else. */
  virtualItems: GanttVirtualRow[];
  /** Total pixel height of the full row list (measured rows + estimated
   * rows) — give the scroll-content container this height explicitly so
   * scrolling and the full-height dependency-line overlay behave exactly as
   * if every row were mounted. */
  totalSize: number;
  /** Feed a rendered row's real height back in (e.g. from a layout effect
   * reading `element.offsetHeight`) to refine the cache used for `start`/
   * `totalSize`. A no-op when the size is unchanged or non-positive (jsdom
   * reports 0 unless a test stubs it). */
  measureRow: (key: string, size: number) => void;
};

const DEFAULT_OVERSCAN_PX = 400;

// jsdom never lays anything out, so a real scroll container's clientHeight
// reads 0 there even once mounted (existing Gantt tests stub clientWidth/
// offsetLeft/offsetTop/offsetHeight but never clientHeight — see
// gantt-dependency-line-rendering.test.tsx and friends). Falling back to a
// generous viewport height instead of 0 keeps every task-count-under-a-few-
// dozen board (i.e. basically every existing test, and any real small
// board) rendering every row exactly as it did before virtualization,
// rather than windowing down to nothing the moment clientHeight is
// unmeasured or genuinely zero.
const FALLBACK_VIEWPORT_PX = 2000;

/**
 * Dependency-free vertical windowing for a list of variable-but-mostly-
 * uniform-height rows sharing one scroll container. Unlike a fixed-size
 * virtualizer, row height isn't assumed: every key gets a cached size
 * (seeded by `estimateSize`, corrected once `measureRow` reports the real
 * rendered height), and offsets are the running sum of that cache — the
 * same "trust the caller's estimate until it's actually measured" approach
 * a full-featured virtualizer uses, kept small and specific to this one
 * screen rather than pulled in as a library dependency.
 */
export function useGanttRowVirtualizer({
  keys,
  scrollElementRef,
  estimateSize,
  overscanPx = DEFAULT_OVERSCAN_PX,
}: UseGanttRowVirtualizerOptions): UseGanttRowVirtualizerResult {
  // Persisted across renders (and across a row briefly leaving the window)
  // by task id, so a row that scrolls out and back in keeps its last known
  // height instead of reverting to the plain estimate and shifting layout.
  const sizeCacheRef = useRef(new Map<string, number>());
  // Bumped by `measureRow` to force the offsets memo below to re-read the
  // (otherwise non-reactive) cache ref.
  const [measureVersion, setMeasureVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportPx, setViewportPx] = useState(0);

  useLayoutEffect(() => {
    const element = scrollElementRef.current;
    if (!element) return;

    const updateViewport = () => setViewportPx(element.clientHeight);
    const updateScroll = () => setScrollTop(element.scrollTop);

    updateViewport();
    updateScroll();

    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(element);
    element.addEventListener("scroll", updateScroll, { passive: true });

    return () => {
      resizeObserver.disconnect();
      element.removeEventListener("scroll", updateScroll);
    };
  }, [scrollElementRef]);

  // Every row's offset + size, in key order. O(n) in the row count, which is
  // the same order of work the previous (non-virtualized) DOM-measurement
  // pass already did every layout — fine at Gantt's realistic scale
  // (task-heavy means hundreds, not the tens of thousands a binary-search
  // offset lookup would be worth building for).
  // biome-ignore lint/correctness/useExhaustiveDependencies: measureVersion forces a re-read of sizeCacheRef (a plain ref) after measureRow mutates it; the body itself doesn't reference the state value.
  const offsets = useMemo(() => {
    const list: { start: number; size: number }[] = new Array(keys.length);
    let cumulative = 0;
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      if (key === undefined) continue;
      const size = sizeCacheRef.current.get(key) ?? estimateSize(key);
      list[index] = { start: cumulative, size };
      cumulative += size;
    }
    return { list, totalSize: cumulative };
  }, [keys, estimateSize, measureVersion]);

  const effectiveViewportPx =
    viewportPx > 0 ? viewportPx : FALLBACK_VIEWPORT_PX;
  const rangeStart = Math.max(0, scrollTop - overscanPx);
  const rangeEnd = scrollTop + effectiveViewportPx + overscanPx;

  const virtualItems = useMemo(() => {
    const items: GanttVirtualRow[] = [];
    for (let index = 0; index < offsets.list.length; index++) {
      const entry = offsets.list[index];
      if (!entry) continue;
      const end = entry.start + entry.size;
      if (end < rangeStart || entry.start > rangeEnd) continue;
      const key = keys[index];
      if (key === undefined) continue;
      items.push({ key, index, start: entry.start, size: entry.size });
    }
    return items;
  }, [offsets, rangeStart, rangeEnd, keys]);

  const measureRow = useCallback((key: string, size: number) => {
    if (!(size > 0)) return;
    const previous = sizeCacheRef.current.get(key);
    // Sub-pixel jitter from rounding shouldn't trigger a re-layout on every
    // measurement pass.
    if (previous !== undefined && Math.abs(previous - size) < 0.5) return;
    sizeCacheRef.current.set(key, size);
    setMeasureVersion((version) => version + 1);
  }, []);

  return { virtualItems, totalSize: offsets.totalSize, measureRow };
}
