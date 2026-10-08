import { addDays } from "date-fns";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { formatDateShort } from "@/lib/format";
import { useUserPreferencesStore } from "@/store/user-preferences";
import {
  buildDependencyEdges,
  type DependencyEdgeInput,
  type TaskBarBox,
} from "./dependency-lines";
import { GanttDependencyOverlay } from "./gantt-dependency-overlay";
import {
  buildNeighborhoodScale,
  buildTaskNeighborhood,
  fitPixelsPerDay,
  NEIGHBORHOOD_ZOOMS,
  type NeighborhoodRole,
  type NeighborhoodRow,
  type NeighborhoodSchedule,
  type NeighborhoodZoom,
  stepNeighborhoodZoom,
} from "./gantt-task-neighborhood";
import { normalizeWheelDeltaY } from "./zoom";

export type NeighborhoodTaskInfo = {
  /** The task key as shown elsewhere (for example AFB-36). */
  key: string;
  title: string;
  /** The schedule is display-only (derived from predecessors). */
  isDerived?: boolean;
};

type GanttTaskNeighborhoodProps = {
  focusTaskId: string;
  edges: readonly DependencyEdgeInput[];
  scheduleByTaskId: ReadonlyMap<string, NeighborhoodSchedule>;
  taskInfoById: ReadonlyMap<string, NeighborhoodTaskInfo>;
  violatedEdgeIds?: ReadonlySet<string>;
  /** Switches the details sheet to a neighbor. */
  onSelectTask: (taskId: string) => void;
  /** The card is not drawn when the free area is narrower than this. */
  minAvailableWidthPx?: number;
};

export const NEIGHBORHOOD_MIN_AVAILABLE_WIDTH_PX = 480;

// Static i18n keys (never built from the zoom value at the call site). The
// unit labels are the main Gantt toolbar's own keys.
const ZOOM_LABEL_KEYS: Record<NeighborhoodZoom, string> = {
  fit: "tasks:gantt.neighborhoodZoomFit",
  day: "tasks:gantt.unitDay",
  week: "tasks:gantt.unitWeek",
  month: "tasks:gantt.unitMonth",
  quarter: "tasks:gantt.unitQuarter",
};

const CARD_MARGIN_PX = 24;
const CARD_MAX_WIDTH_PX = 880;
const RAIL_WIDTH_PX = 200;
const AXIS_HEIGHT_PX = 26;
const ROW_HEIGHT_PX = 34;
const GROUP_LABEL_HEIGHT_PX = 22;
const BAR_HEIGHT_PX = 14;
const MIN_BAR_WIDTH_PX = 8;
const MARKER_ID_PREFIX = "gantt-neighborhood-arrow";
// Space kept between the rail and the focus bar when the chart scrolls to it.
const FOCUS_SCROLL_MARGIN_PX = 24;
// A pointer must travel this far before a press on the chart becomes a pan, so
// a plain click still lands.
const DRAG_THRESHOLD_PX = 4;
// Ctrl/Cmd+wheel (and a trackpad pinch, which browsers report the same way)
// changes the scale one step per this much accumulated wheel travel.
const ZOOM_WHEEL_STEP_PX = 60;

type Group = { role: NeighborhoodRole; rows: NeighborhoodRow[]; top: number };

// Reads the width of the free area (the element stretches from the left edge
// of the viewport to the left edge of the sheet) and keeps it current.
function useElementWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * A floating card with a small Gantt of the open task's DIRECT dependency
 * neighborhood: its predecessors, the task itself (highlighted) and its
 * successors. It is meant to be passed as `backdropAside` to TaskDetailsSheet,
 * which renders it inside the sheet's popup so it shares the modal focus trap
 * and a click inside it is not an outside press.
 */
export function GanttTaskNeighborhood({
  focusTaskId,
  edges,
  scheduleByTaskId,
  taskInfoById,
  violatedEdgeIds,
  onSelectTask,
  minAvailableWidthPx = NEIGHBORHOOD_MIN_AVAILABLE_WIDTH_PX,
}: GanttTaskNeighborhoodProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
    active: boolean;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  // A pan that started on a row button must not also open that row's task.
  const suppressClickRef = useRef(false);
  const wheelZoomRef = useRef(0);
  const availableWidth = useElementWidth(rootRef);
  const zoom = useUserPreferencesStore((state) => state.ganttNeighborhoodZoom);
  const setZoom = useUserPreferencesStore(
    (state) => state.setGanttNeighborhoodZoom,
  );
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);

  const neighborhood = useMemo(
    () => buildTaskNeighborhood({ focusTaskId, edges, scheduleByTaskId }),
    [focusTaskId, edges, scheduleByTaskId],
  );

  const visible =
    availableWidth !== null && availableWidth >= minAvailableWidthPx;
  const cardWidth = Math.min(
    (availableWidth ?? 0) - CARD_MARGIN_PX * 2,
    CARD_MAX_WIDTH_PX,
  );
  const viewportTimelineWidth = Math.max(cardWidth - RAIL_WIDTH_PX, 120);

  const scale = useMemo(
    () =>
      neighborhood.range
        ? buildNeighborhoodScale(neighborhood.range, viewportTimelineWidth, {
            zoom,
            weekStartsOn,
          })
        : null,
    [neighborhood.range, viewportTimelineWidth, zoom, weekStartsOn],
  );
  // What "fit" would use, whichever scale is active: Ctrl/Cmd+wheel orders the
  // scales by pixels per day and needs to place "fit" among the units.
  const fitPpd = neighborhood.range
    ? fitPixelsPerDay(neighborhood.range, viewportTimelineWidth)
    : 0;
  // The chart is as wide as the scale needs; it is wider than the viewport
  // when the range is long, and the scroll container then scrolls.
  const timelineWidth = scale?.widthPx ?? viewportTimelineWidth;

  // Rows grouped as predecessors / focus / successors with the top offset of
  // each group (measured from the first row area, below the axis).
  const { groups, rowsHeight, rowTops } = useMemo(() => {
    const byRole = (role: NeighborhoodRole) =>
      neighborhood.rows.filter((row) => row.role === role);
    const result: Group[] = [];
    const tops = new Map<string, number>();
    let top = 0;
    for (const role of ["predecessor", "focus", "successor"] as const) {
      const rows = byRole(role);
      if (rows.length === 0) continue;
      if (role !== "focus") top += GROUP_LABEL_HEIGHT_PX;
      result.push({ role, rows, top });
      for (const row of rows) {
        tops.set(row.taskId, top);
        top += ROW_HEIGHT_PX;
      }
    }
    return { groups: result, rowsHeight: top, rowTops: tops };
  }, [neighborhood.rows]);

  const geometry = useMemo(() => {
    if (!scale) return [];
    const boxes = new Map<string, TaskBarBox>();
    for (const row of neighborhood.rows) {
      const top = rowTops.get(row.taskId);
      if (!row.schedule || top === undefined) continue;
      const left = scale.offsetOf(row.schedule.start);
      const right = Math.max(
        scale.offsetOf(addDays(row.schedule.end, 1)),
        left + MIN_BAR_WIDTH_PX,
      );
      boxes.set(row.taskId, { left, right, top, height: ROW_HEIGHT_PX });
    }
    return buildDependencyEdges([...neighborhood.edges], boxes);
  }, [scale, neighborhood.rows, neighborhood.edges, rowTops]);

  // Bring the focus bar and row into view when the card opens and whenever the
  // focus task changes, not on every resize or data refresh.
  const focusSchedule = neighborhood.rows.find(
    (row) => row.role === "focus",
  )?.schedule;
  const focusStartOffset = focusSchedule
    ? (scale?.offsetOf(focusSchedule.start) ?? null)
    : null;
  const focusTop = rowTops.get(focusTaskId) ?? null;
  const hasBody = visible && neighborhood.neighborCount > 0;
  // The focus bar is brought into view for each task/scale pair: a new focus
  // task, or a new scale (every offset changes, so the bar would otherwise end
  // up anywhere).
  const scrollKey = `${focusTaskId}|${scale?.zoom ?? ""}`;
  const scrolledForRef = useRef<string | null>(null);
  const latestFocusRef = useRef({ focusStartOffset, focusTop });
  latestFocusRef.current = { focusStartOffset, focusTop };
  useLayoutEffect(() => {
    if (!hasBody) {
      scrolledForRef.current = null;
      return;
    }
    const element = scrollRef.current;
    if (!element || scrolledForRef.current === scrollKey) return;
    scrolledForRef.current = scrollKey;
    const { focusStartOffset: startOffset, focusTop: top } =
      latestFocusRef.current;
    if (startOffset !== null) {
      element.scrollLeft = Math.max(startOffset - FOCUS_SCROLL_MARGIN_PX, 0);
    }
    if (top !== null) {
      // Centre the focus row in the area below the sticky date header.
      const visibleRows = Math.max(element.clientHeight - AXIS_HEIGHT_PX, 0);
      element.scrollTop = Math.max(
        top + ROW_HEIGHT_PX / 2 - visibleRows / 2,
        0,
      );
    }
  }, [hasBody, scrollKey]);

  // Wheel input. A plain vertical wheel over a chart that only overflows
  // sideways would otherwise do nothing (the browser scrolls the axis that has
  // no overflow by zero), so it pans the time axis. Ctrl/Cmd+wheel, which is
  // also how browsers report a trackpad pinch, switches the scale. A native
  // non-passive listener, because React registers wheel handlers as passive
  // and ignores preventDefault there.
  const latestZoomRef = useRef({ zoom, fitPpd, setZoom });
  latestZoomRef.current = { zoom, fitPpd, setZoom };
  useEffect(() => {
    const element = scrollRef.current;
    if (!hasBody || !element) return;
    const onWheel = (event: WheelEvent) => {
      const deltaY = normalizeWheelDeltaY(
        event.deltaY,
        event.deltaMode,
        element.clientHeight,
      );
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        wheelZoomRef.current += deltaY;
        if (Math.abs(wheelZoomRef.current) < ZOOM_WHEEL_STEP_PX) return;
        // Scrolling up (negative deltaY) zooms in, as in the main Gantt.
        const direction = wheelZoomRef.current < 0 ? 1 : -1;
        wheelZoomRef.current = 0;
        const latest = latestZoomRef.current;
        const next = stepNeighborhoodZoom(
          latest.zoom,
          direction,
          latest.fitPpd,
        );
        if (next !== latest.zoom) latest.setZoom(next);
        return;
      }
      // Shift+wheel and a sideways swipe already scroll horizontally; a chart
      // that also overflows vertically keeps the native vertical wheel.
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(deltaY)) return;
      if (element.scrollHeight > element.clientHeight) return;
      if (element.scrollWidth <= element.clientWidth) return;
      event.preventDefault();
      element.scrollLeft += deltaY;
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [hasBody]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Touch already pans natively; only a primary mouse/pen press starts a
    // drag. A press on a row button starts one too: the rows cover almost the
    // whole chart, so excluding them left nothing to grab. The movement
    // threshold keeps a plain click a click.
    if (event.pointerType === "touch" || event.button !== 0) return;
    suppressClickRef.current = false;
    const element = event.currentTarget;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: element.scrollLeft,
      top: element.scrollTop,
      active: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.active = true;
      suppressClickRef.current = true;
      setIsPanning(true);
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // The pointer may already be gone; panning still works without it.
      }
    }
    event.currentTarget.scrollLeft = drag.left - dx;
    event.currentTarget.scrollTop = drag.top - dy;
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.active) {
      setIsPanning(false);
      // The click that ends this drag is dispatched right after pointerup;
      // the suppression only has to outlive that.
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      try {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      } catch {
        // Already released.
      }
    }
  };

  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const focusInfo = taskInfoById.get(focusTaskId);
  const focusKey = focusInfo?.key ?? "";
  const title = t("tasks:gantt.neighborhoodTitle", { key: focusKey });

  const groupLabel = (role: NeighborhoodRole): string =>
    role === "predecessor"
      ? t("tasks:gantt.neighborhoodPredecessors")
      : t("tasks:gantt.neighborhoodSuccessors");

  const renderRow = (row: NeighborhoodRow): ReactNode => {
    const info = taskInfoById.get(row.taskId);
    const key = info?.key ?? row.taskId;
    const taskTitle = info?.title ?? "";
    const isFocus = row.role === "focus";
    const bar =
      row.schedule && scale ? (
        (() => {
          const left = scale.offsetOf(row.schedule.start);
          const width = Math.max(
            scale.offsetOf(addDays(row.schedule.end, 1)) - left,
            MIN_BAR_WIDTH_PX,
          );
          return (
            <span
              aria-hidden="true"
              data-testid="gantt-neighborhood-bar"
              data-focus={isFocus ? "true" : undefined}
              title={`${formatDateShort(row.schedule.start)} – ${formatDateShort(row.schedule.end)}`}
              className={cn(
                "absolute top-1/2 -translate-y-1/2 rounded-[4px]",
                isFocus
                  ? "bg-primary ring-2 ring-primary/35 ring-offset-1 ring-offset-popover"
                  : info?.isDerived
                    ? "border border-muted-foreground/60 border-dashed bg-muted-foreground/15"
                    : "bg-muted-foreground/45",
              )}
              style={{ left, width, height: BAR_HEIGHT_PX }}
            />
          );
        })()
      ) : (
        <span className="absolute inset-y-0 start-2 flex items-center text-[11px] text-muted-foreground italic">
          {t("tasks:gantt.neighborhoodNoDates")}
        </span>
      );

    const content = (
      <>
        <span
          // Sticky and opaque: bars and edges scroll underneath the rail.
          className="sticky left-0 z-20 flex min-w-0 shrink-0 items-center gap-2 bg-popover px-3"
          style={{ width: RAIL_WIDTH_PX }}
        >
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0",
              isFocus
                ? "bg-primary/10"
                : "group-hover/row:bg-accent/60 group-focus-visible/row:bg-accent/60",
            )}
          />
          {isFocus && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1 bg-primary"
            />
          )}
          <span
            className={cn(
              "relative shrink-0 text-xs",
              isFocus
                ? "font-semibold text-primary"
                : "font-medium text-muted-foreground",
            )}
          >
            {key}
          </span>
          <span
            className={cn(
              "relative min-w-0 truncate text-xs",
              isFocus && "font-medium",
            )}
          >
            {taskTitle}
          </span>
        </span>
        <span
          className="relative block h-full shrink-0"
          style={{ width: timelineWidth }}
        >
          {bar}
        </span>
      </>
    );

    if (isFocus) {
      return (
        <li
          key={row.taskId}
          aria-current="true"
          data-testid="gantt-neighborhood-focus-row"
          title={taskTitle ? `${key} ${taskTitle}` : key}
          className="relative flex items-center bg-primary/10"
          style={{ height: ROW_HEIGHT_PX }}
        >
          {content}
        </li>
      );
    }

    return (
      <li key={row.taskId}>
        <button
          type="button"
          aria-label={t("tasks:gantt.neighborhoodOpenTask", { key })}
          title={taskTitle ? `${key} ${taskTitle}` : key}
          data-testid="gantt-neighborhood-row"
          onClick={() => onSelectTask(row.taskId)}
          className="group/row relative flex w-full cursor-pointer items-center text-start outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          style={{ height: ROW_HEIGHT_PX }}
        >
          {content}
        </button>
      </li>
    );
  };

  return (
    <div
      ref={rootRef}
      data-testid="gantt-neighborhood-aside"
      // Stretches from the viewport's left edge to the sheet's left edge: the
      // sheet popup is this element's containing block, so 100% is its width.
      // Empty areas let clicks through to the sheet's viewport, which is an
      // outside press that closes the sheet.
      className="pointer-events-none absolute inset-y-0 end-full flex w-[calc(100vw-100%)] items-center justify-center p-6"
    >
      {visible && (
        <section
          aria-label={title}
          data-testid="gantt-neighborhood-card"
          className="pointer-events-auto flex max-h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg motion-safe:animate-[gantt-neighborhood-in_160ms_ease-out_both]"
          style={{ width: cardWidth }}
        >
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <h2 className="min-w-0 truncate font-medium text-sm">{title}</h2>
              {neighborhood.neighborCount > 0 && (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                  {t("tasks:gantt.neighborhoodCount", {
                    count: neighborhood.neighborCount,
                  })}
                </span>
              )}
            </div>
            {neighborhood.neighborCount > 0 && neighborhood.range && (
              <fieldset
                data-testid="gantt-neighborhood-zoom"
                className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
              >
                <legend className="sr-only">
                  {t("tasks:gantt.neighborhoodZoomLabel")}
                </legend>
                {NEIGHBORHOOD_ZOOMS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={zoom === option}
                    data-zoom={option}
                    onClick={() => setZoom(option)}
                    className={cn(
                      "touch-manipulation rounded-sm px-2 py-0.5 font-medium text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      zoom === option
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {t(ZOOM_LABEL_KEYS[option])}
                  </button>
                ))}
              </fieldset>
            )}
          </header>
          {neighborhood.neighborCount === 0 ? (
            <p
              data-testid="gantt-neighborhood-empty"
              className="px-3 py-6 text-center text-muted-foreground text-sm"
            >
              {t("tasks:gantt.neighborhoodEmpty")}
            </p>
          ) : (
            // One scroll container for both axes keeps the bars, the SVG overlay,
            // the sticky date header and the sticky rail aligned. Base UI's
            // scroll lock only sets overflow:hidden on <html>/<body>, so wheel
            // and trackpad scrolling inside the popup is unaffected;
            // overscroll-contain stops it chaining to the page.
            // biome-ignore lint/a11y/useSemanticElements: a labelled div is the scrollable-region pattern; a fieldset would be a form group
            <div
              ref={scrollRef}
              role="group"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable so the arrow keys scroll it
              tabIndex={0}
              aria-label={t("tasks:gantt.neighborhoodScrollLabel")}
              data-testid="gantt-neighborhood-scroll"
              data-panning={isPanning ? "true" : undefined}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onClickCapture={handleClickCapture}
              className={cn(
                "min-h-0 flex-1 select-none overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                isPanning ? "cursor-grabbing" : "cursor-grab",
              )}
            >
              <div
                className="relative"
                style={{ width: RAIL_WIDTH_PX + timelineWidth }}
              >
                {scale && (
                  <div
                    aria-hidden="true"
                    className="sticky top-0 z-30 flex border-b bg-popover"
                    style={{ height: AXIS_HEIGHT_PX }}
                  >
                    <span
                      className="sticky left-0 z-10 block shrink-0 bg-popover"
                      style={{ width: RAIL_WIDTH_PX, height: AXIS_HEIGHT_PX }}
                    />
                    {scale.ticks.map((tick) => (
                      <span
                        key={tick.day.getTime()}
                        className="absolute top-0 flex items-center ps-1 text-[10px] text-muted-foreground"
                        style={{
                          left: RAIL_WIDTH_PX + tick.x,
                          height: AXIS_HEIGHT_PX,
                        }}
                      >
                        {tick.label}
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative" style={{ height: rowsHeight }}>
                  {scale?.ticks.map((tick) => (
                    <span
                      key={tick.day.getTime()}
                      aria-hidden="true"
                      className="absolute inset-y-0 border-s border-border/50"
                      style={{ left: RAIL_WIDTH_PX + tick.x }}
                    />
                  ))}
                  {groups.map((group) => (
                    <div
                      key={group.role}
                      className="absolute inset-x-0"
                      style={{
                        top:
                          group.top -
                          (group.role === "focus" ? 0 : GROUP_LABEL_HEIGHT_PX),
                      }}
                    >
                      {group.role !== "focus" && (
                        <div
                          aria-hidden="true"
                          className="flex items-center font-semibold text-[10px] text-muted-foreground uppercase tracking-wide"
                          style={{ height: GROUP_LABEL_HEIGHT_PX }}
                        >
                          <span className="sticky left-0 z-20 bg-popover px-3">
                            {groupLabel(group.role)}
                          </span>
                        </div>
                      )}
                      <ul
                        aria-label={
                          group.role === "focus"
                            ? title
                            : groupLabel(group.role)
                        }
                      >
                        {group.rows.map(renderRow)}
                      </ul>
                    </div>
                  ))}
                  {scale && (
                    <div
                      className="pointer-events-none absolute top-0"
                      style={{
                        left: RAIL_WIDTH_PX,
                        width: timelineWidth,
                        height: rowsHeight,
                      }}
                    >
                      <GanttDependencyOverlay
                        edges={geometry}
                        hoveredTaskId={null}
                        pinnedTaskId={focusTaskId}
                        violatedEdgeIds={violatedEdgeIds}
                        clipLeftPx={0}
                        resolveProjectId={() => undefined}
                        showTypeLabels={false}
                        markerIdPrefix={MARKER_ID_PREFIX}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
