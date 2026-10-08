import { addDays } from "date-fns";
import {
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { formatDateShort } from "@/lib/format";
import {
  buildDependencyEdges,
  type DependencyEdgeInput,
  type TaskBarBox,
} from "./dependency-lines";
import { GanttDependencyOverlay } from "./gantt-dependency-overlay";
import {
  buildNeighborhoodScale,
  buildTaskNeighborhood,
  type NeighborhoodRole,
  type NeighborhoodRow,
  type NeighborhoodSchedule,
} from "./gantt-task-neighborhood";

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

const CARD_MARGIN_PX = 24;
const CARD_MAX_WIDTH_PX = 880;
const RAIL_WIDTH_PX = 200;
const AXIS_HEIGHT_PX = 26;
const ROW_HEIGHT_PX = 34;
const GROUP_LABEL_HEIGHT_PX = 22;
const BAR_HEIGHT_PX = 14;
const MIN_BAR_WIDTH_PX = 8;
const MARKER_ID_PREFIX = "gantt-neighborhood-arrow";

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
  const availableWidth = useElementWidth(rootRef);

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
  const timelineWidth = Math.max(cardWidth - RAIL_WIDTH_PX, 120);

  const scale = useMemo(
    () =>
      neighborhood.range
        ? buildNeighborhoodScale(neighborhood.range, timelineWidth)
        : null,
    [neighborhood.range, timelineWidth],
  );

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
          className="flex min-w-0 shrink-0 items-center gap-2 px-3"
          style={{ width: RAIL_WIDTH_PX }}
        >
          <span
            className={cn(
              "shrink-0 text-xs",
              isFocus
                ? "font-semibold text-primary"
                : "font-medium text-muted-foreground",
            )}
          >
            {key}
          </span>
          <span
            className={cn("min-w-0 truncate text-xs", isFocus && "font-medium")}
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
          <span
            aria-hidden="true"
            className="absolute inset-y-0 start-0 w-1 bg-primary"
          />
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
          className="relative flex w-full cursor-pointer items-center text-start outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
          <header className="flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2.5">
            <h2 className="min-w-0 truncate font-medium text-sm">{title}</h2>
            {neighborhood.neighborCount > 0 && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                {t("tasks:gantt.neighborhoodCount", {
                  count: neighborhood.neighborCount,
                })}
              </span>
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
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              <div
                className="relative"
                style={{ width: RAIL_WIDTH_PX + timelineWidth }}
              >
                {scale && (
                  <div
                    aria-hidden="true"
                    className="sticky top-0 z-10 border-b bg-popover"
                    style={{ height: AXIS_HEIGHT_PX }}
                  >
                    {scale.ticks.map((tick) => (
                      <span
                        key={tick.day.getTime()}
                        className="absolute top-0 flex items-center ps-1 text-[10px] text-muted-foreground"
                        style={{
                          left: RAIL_WIDTH_PX + tick.x,
                          height: AXIS_HEIGHT_PX,
                        }}
                      >
                        {formatDateShort(tick.day)}
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
                          className="flex items-center px-3 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide"
                          style={{ height: GROUP_LABEL_HEIGHT_PX }}
                        >
                          {groupLabel(group.role)}
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
