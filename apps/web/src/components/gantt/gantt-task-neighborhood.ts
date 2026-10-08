// Pure model for the "dependency neighborhood" card shown over the Gantt's
// task-details backdrop (see gantt-task-neighborhood.tsx): the open task, its
// DIRECT predecessors above it and its DIRECT successors below it, with the
// relation edges among them and the date range they cover. Kept free of React
// and the DOM, like the rest of this folder's pure modules, so the ordering
// and de-duplication rules are unit-testable directly.
//
// Only "blocks" and "related" relations take part (the same set the Gantt
// draws as dependency lines). For both, `sourceTaskId` is the predecessor side
// and `targetTaskId` the successor side, matching how the lines are drawn.
//
// Schedules are supplied by the caller: the Gantt route already computes them
// (own dates, estimate-sized spans, rolled-up summary spans, derived spans for
// undated successors and cross-project far ends), and this module must not
// recompute them. A task without an entry is "undated": it keeps its row but
// has no bar and does not widen the range.

import { addDays, differenceInCalendarDays } from "date-fns";
import { formatDateShort } from "@/lib/format";
import type { DependencyEdgeInput } from "./dependency-lines";
import { NEIGHBORHOOD_ZOOMS, type NeighborhoodZoom } from "./neighborhood-zoom";
import { buildGanttHeaderColumns, type GanttUnit } from "./timeline";

export type NeighborhoodSchedule = { start: Date; end: Date };

export type NeighborhoodRole = "predecessor" | "focus" | "successor";

export type NeighborhoodRow = {
  taskId: string;
  role: NeighborhoodRole;
  /** The task's schedule, or null when it has no resolvable dates. */
  schedule: NeighborhoodSchedule | null;
};

export type TaskNeighborhood = {
  /** Predecessors (by start date), the focus task, then successors (by start
   * date). The focus row is always present. */
  rows: NeighborhoodRow[];
  /** Every blocks/related edge whose two endpoints are both in `rows`,
   * de-duplicated by id, in input order. */
  edges: DependencyEdgeInput[];
  /** First and last day covered by the dated rows, or null when none is dated. */
  range: { start: Date; end: Date } | null;
  /** Number of neighbor rows (predecessors + successors, each task once). */
  neighborCount: number;
};

type BuildTaskNeighborhoodInput = {
  focusTaskId: string;
  edges: readonly DependencyEdgeInput[];
  scheduleByTaskId: ReadonlyMap<string, NeighborhoodSchedule>;
};

function compareBySchedule(
  left: NeighborhoodRow,
  right: NeighborhoodRow,
): number {
  // Dated tasks first, ordered by start then end; undated ones last. The id is
  // the final tie-break so the order never depends on relation arrival order.
  if (left.schedule && right.schedule) {
    const byStart =
      left.schedule.start.getTime() - right.schedule.start.getTime();
    if (byStart !== 0) return byStart;
    const byEnd = left.schedule.end.getTime() - right.schedule.end.getTime();
    if (byEnd !== 0) return byEnd;
  } else if (left.schedule) {
    return -1;
  } else if (right.schedule) {
    return 1;
  }
  return left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0;
}

export function buildTaskNeighborhood({
  focusTaskId,
  edges,
  scheduleByTaskId,
}: BuildTaskNeighborhoodInput): TaskNeighborhood {
  const predecessorIds = new Set<string>();
  const successorIds = new Set<string>();

  for (const edge of edges) {
    if (edge.sourceTaskId === edge.targetTaskId) continue;
    if (edge.targetTaskId === focusTaskId) {
      predecessorIds.add(edge.sourceTaskId);
    } else if (edge.sourceTaskId === focusTaskId) {
      successorIds.add(edge.targetTaskId);
    }
  }

  // A task that is both a predecessor and a successor (for example a "blocks"
  // in one direction plus a "related" in the other) gets ONE row, in the
  // predecessor group.
  for (const id of predecessorIds) successorIds.delete(id);

  const toRow = (taskId: string, role: NeighborhoodRole): NeighborhoodRow => ({
    taskId,
    role,
    schedule: scheduleByTaskId.get(taskId) ?? null,
  });

  const predecessors = [...predecessorIds]
    .map((id) => toRow(id, "predecessor"))
    .sort(compareBySchedule);
  const successors = [...successorIds]
    .map((id) => toRow(id, "successor"))
    .sort(compareBySchedule);
  const rows = [...predecessors, toRow(focusTaskId, "focus"), ...successors];

  const rowIds = new Set(rows.map((row) => row.taskId));
  const seenEdgeIds = new Set<string>();
  const neighborhoodEdges: DependencyEdgeInput[] = [];
  for (const edge of edges) {
    if (edge.sourceTaskId === edge.targetTaskId) continue;
    if (!rowIds.has(edge.sourceTaskId) || !rowIds.has(edge.targetTaskId)) {
      continue;
    }
    if (seenEdgeIds.has(edge.id)) continue;
    seenEdgeIds.add(edge.id);
    neighborhoodEdges.push(edge);
  }

  let start: Date | null = null;
  let end: Date | null = null;
  for (const row of rows) {
    if (!row.schedule) continue;
    if (start === null || row.schedule.start < start)
      start = row.schedule.start;
    if (end === null || row.schedule.end > end) end = row.schedule.end;
  }

  return {
    rows,
    edges: neighborhoodEdges,
    range: start && end ? { start, end } : null,
    neighborCount: predecessors.length + successors.length,
  };
}

export {
  DEFAULT_NEIGHBORHOOD_ZOOM,
  isNeighborhoodZoom,
  NEIGHBORHOOD_ZOOMS,
  type NeighborhoodZoom,
} from "./neighborhood-zoom";

/** Pixels per day of each unit. They mirror the main Gantt's desktop base
 * day-column widths (UNIT_BASE_DAY_COLUMN_WIDTH_REM in the project's gantt
 * route, at a 16px root font size) so a "Week" here looks like a "Week" there. */
export const UNIT_PIXELS_PER_DAY: Record<GanttUnit, number> = {
  day: 44,
  week: 13.12,
  month: 2.96,
  quarter: 1.216,
};

/**
 * The scale one Ctrl/Cmd+wheel step away: `direction` 1 zooms in (wider days),
 * -1 zooms out. The scales are ordered by pixels per day; "fit" sits where its
 * own px/day (`fitPixelsPerDay`) falls among the fixed units. The ends clamp.
 */
export function stepNeighborhoodZoom(
  current: NeighborhoodZoom,
  direction: 1 | -1,
  fitPixelsPerDay: number,
): NeighborhoodZoom {
  const pixelsPerDay = (zoom: NeighborhoodZoom) =>
    zoom === "fit" ? fitPixelsPerDay : UNIT_PIXELS_PER_DAY[zoom];
  const ordered = [...NEIGHBORHOOD_ZOOMS].sort(
    (left, right) => pixelsPerDay(left) - pixelsPerDay(right),
  );
  const index = ordered.indexOf(current);
  return ordered[Math.min(Math.max(index + direction, 0), ordered.length - 1)];
}

export type NeighborhoodScale = {
  /** The choice that produced this scale. */
  zoom: NeighborhoodZoom;
  /** First day shown (one day of padding before the earliest date). */
  start: Date;
  /** Number of whole days shown. */
  totalDays: number;
  pixelsPerDay: number;
  /** Full width of the time axis, `totalDays * pixelsPerDay`. It can exceed
   * the width the range was fitted into (the card then scrolls). */
  widthPx: number;
  /** Pixel offset of a calendar day's left edge. */
  offsetOf: (day: Date) => number;
  /** Labelled tick days: at least `minTickSpacingPx` apart in "fit" mode, at
   * each day/week/month/quarter boundary for a fixed unit. */
  ticks: { day: Date; x: number; label: string }[];
};

// Candidate tick steps in days; the smallest one whose spacing is wide enough
// wins, so a short span is labelled per day and a long one per week or month.
const TICK_STEPS_DAYS = [1, 2, 7, 14, 28, 91, 182, 365];

/** Narrowest a day may get. A longer range keeps this scale and overflows the
 * width it was fitted into, so the card scrolls horizontally instead of
 * squeezing bars into slivers. */
export const MIN_PIXELS_PER_DAY = 14;

function dayCountOf(range: { start: Date; end: Date }): number {
  // One day of padding on each side of the range.
  return Math.max(differenceInCalendarDays(range.end, range.start) + 3, 3);
}

/** Pixels per day of the "fit" scale: the range fitted into `widthPx`, never
 * narrower than `minPixelsPerDay`. */
export function fitPixelsPerDay(
  range: { start: Date; end: Date },
  widthPx: number,
  minPixelsPerDay = MIN_PIXELS_PER_DAY,
): number {
  return Math.max(Math.max(widthPx, 1) / dayCountOf(range), minPixelsPerDay);
}

type BuildNeighborhoodScaleOptions = {
  zoom?: NeighborhoodZoom;
  /** First day of a "week" column (labels of the "week" unit). */
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  minTickSpacingPx?: number;
  minPixelsPerDay?: number;
};

/**
 * Fits `range` (plus one day of padding on each side) into `widthPx`, never
 * narrower than `minPixelsPerDay` per day, and picks tick days by span. For a
 * fixed unit it uses that unit's px per day instead (the axis still reaches at
 * least `widthPx`) and ticks at the unit's boundaries with the main Gantt
 * header's labels. Day arithmetic is calendar-day based (never milliseconds /
 * 86 400 000), so a DST change does not shift a bar.
 */
export function buildNeighborhoodScale(
  range: { start: Date; end: Date },
  widthPx: number,
  {
    zoom = "fit",
    weekStartsOn = 0,
    minTickSpacingPx = 64,
    minPixelsPerDay = MIN_PIXELS_PER_DAY,
  }: BuildNeighborhoodScaleOptions = {},
): NeighborhoodScale {
  const start = addDays(range.start, -1);
  const rangeDays = dayCountOf(range);
  const fixedPixelsPerDay = zoom === "fit" ? null : UNIT_PIXELS_PER_DAY[zoom];
  const pixelsPerDay =
    fixedPixelsPerDay ?? fitPixelsPerDay(range, widthPx, minPixelsPerDay);
  // A fixed unit can be narrower than the card; keep the grid to its edge.
  const totalDays =
    fixedPixelsPerDay === null
      ? rangeDays
      : Math.max(
          rangeDays,
          Math.ceil(Math.max(widthPx, 1) / fixedPixelsPerDay),
        );
  const offsetOf = (day: Date) =>
    differenceInCalendarDays(day, start) * pixelsPerDay;

  const ticks: NeighborhoodScale["ticks"] = [];
  if (zoom === "fit" || zoom === "day") {
    const step =
      zoom === "day"
        ? 1
        : (TICK_STEPS_DAYS.find(
            (candidate) => candidate * pixelsPerDay >= minTickSpacingPx,
          ) ?? TICK_STEPS_DAYS[TICK_STEPS_DAYS.length - 1]);
    for (let offset = 0; offset < totalDays; offset += step) {
      const day = addDays(start, offset);
      ticks.push({ day, x: offsetOf(day), label: formatDateShort(day) });
    }
  } else {
    // The same grouping and labels as the main Gantt's header: a week's days
    // under its start date, a month under "MMM yyyy", a quarter under "Qn yyyy".
    const days = Array.from({ length: totalDays }, (_, offset) =>
      addDays(start, offset),
    );
    for (const column of buildGanttHeaderColumns(days, zoom, weekStartsOn)) {
      const day = days[column.startIndex];
      ticks.push({ day, x: offsetOf(day), label: column.label });
    }
  }
  return {
    zoom,
    start,
    totalDays,
    pixelsPerDay,
    widthPx: totalDays * pixelsPerDay,
    offsetOf,
    ticks,
  };
}
