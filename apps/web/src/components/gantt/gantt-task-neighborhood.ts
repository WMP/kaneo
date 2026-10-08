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
import type { DependencyEdgeInput } from "./dependency-lines";

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

export type NeighborhoodScale = {
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
  /** Tick days, each at least `minTickSpacingPx` apart. */
  ticks: { day: Date; x: number }[];
};

// Candidate tick steps in days; the smallest one whose spacing is wide enough
// wins, so a short span is labelled per day and a long one per week or month.
const TICK_STEPS_DAYS = [1, 2, 7, 14, 28, 91, 182, 365];

/** Narrowest a day may get. A longer range keeps this scale and overflows the
 * width it was fitted into, so the card scrolls horizontally instead of
 * squeezing bars into slivers. */
export const MIN_PIXELS_PER_DAY = 14;

/** Fits `range` (plus one day of padding on each side) into `widthPx`, never
 * narrower than `minPixelsPerDay` per day, and picks tick days by span. Day arithmetic is calendar-day based (never
 * milliseconds / 86 400 000), so a DST change does not shift a bar. */
export function buildNeighborhoodScale(
  range: { start: Date; end: Date },
  widthPx: number,
  minTickSpacingPx = 64,
  minPixelsPerDay = MIN_PIXELS_PER_DAY,
): NeighborhoodScale {
  const start = addDays(range.start, -1);
  const totalDays = Math.max(
    differenceInCalendarDays(range.end, range.start) + 3,
    3,
  );
  const pixelsPerDay = Math.max(
    Math.max(widthPx, 1) / totalDays,
    minPixelsPerDay,
  );
  const offsetOf = (day: Date) =>
    differenceInCalendarDays(day, start) * pixelsPerDay;
  const step =
    TICK_STEPS_DAYS.find(
      (candidate) => candidate * pixelsPerDay >= minTickSpacingPx,
    ) ?? TICK_STEPS_DAYS[TICK_STEPS_DAYS.length - 1];
  const ticks: { day: Date; x: number }[] = [];
  for (let offset = 0; offset < totalDays; offset += step) {
    const day = addDays(start, offset);
    ticks.push({ day, x: offsetOf(day) });
  }
  return {
    start,
    totalDays,
    pixelsPerDay,
    widthPx: totalDays * pixelsPerDay,
    offsetOf,
    ticks,
  };
}
