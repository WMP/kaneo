// Pure "an estimated task with exactly ONE own date gets a span" math for the
// Gantt. Kept free of React, the DOM and the network, like the rest of this
// folder's pure modules, so the Gantt route, the task bar and the dependency
// cascade share one definition and it is unit-testable directly.
//
// THE RULE (enforced by the API and a database check, see
// docs/agent-guide/scheduling.md): a task with an effort estimate never has
// BOTH a start and a due date. With exactly one of them the task is still a
// dated task with a real bar row, but a single date has no length, so the
// missing end is DERIVED from the estimate:
//  - start only: end = start + (durationDays - 1) working days;
//  - due only:   start = due counted back (durationDays - 1) working days;
// where durationDays = max(1, ceil(estimateMinutes / 480))
// (`estimateToWorkingDays`) and working days come from the workspace calendar
// predicate (calendar days when it is omitted). The task's OWN date is never
// nudged.
//
// DISPLAY ONLY. The derived end/start is never persisted as the missing date:
// anything that writes such a task sends only its own date field.

import { estimateToWorkingDays } from "@/lib/estimate";
import { deriveTaskSchedule } from "./timeline";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Defensive bound on any day-by-day walk (same as the cascade's forward
// nudge): a real calendar has a working day within a week.
export const MAX_WALK_DAYS = 366;

export type EstimateAnchor = "start" | "due";

export type EstimatedSingleDate = {
  /** Which date the task actually has. */
  anchor: EstimateAnchor;
  estimateMinutes: number;
};

export type EstimatedSpan = { start: Date; end: Date };

export function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * Moves `steps` WORKING days away from `date` (`direction` 1 = later,
 * -1 = earlier), landing on a working day; plain calendar days without a
 * calendar. Zero steps returns `date` unchanged.
 */
export function addWorkingDays(
  date: Date,
  steps: number,
  direction: 1 | -1,
  isWorkingDay?: (d: Date) => boolean,
): Date {
  if (steps <= 0) return date;
  if (!isWorkingDay) return addCalendarDays(date, direction * steps);
  let current = date;
  let remaining = steps;
  let walked = 0;
  while (remaining > 0 && walked < MAX_WALK_DAYS) {
    current = addCalendarDays(current, direction);
    walked++;
    if (isWorkingDay(current)) remaining--;
  }
  return current;
}

function usableEstimate(minutes: number | null | undefined): number | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) return null;
  return minutes >= 0 ? minutes : null;
}

/**
 * The anchor of a task that has an estimate and exactly one own date, or null
 * (no estimate, no date, both dates, or a milestone, which is a point marker).
 */
export function getEstimatedSingleDate(task: {
  startDate: string | null;
  dueDate: string | null;
  estimateMinutes?: number | null;
  isMilestone?: boolean;
}): EstimatedSingleDate | null {
  const estimateMinutes = usableEstimate(task.estimateMinutes);
  if (estimateMinutes === null || task.isMilestone) return null;
  const hasStart = Boolean(task.startDate);
  const hasDue = Boolean(task.dueDate);
  if (hasStart === hasDue) return null;
  return { anchor: hasStart ? "start" : "due", estimateMinutes };
}

/** The displayed span of an estimated single-date task from its own date. */
export function estimatedSpanFromAnchor(
  anchor: EstimateAnchor,
  ownDate: Date,
  estimateMinutes: number,
  isWorkingDay?: (d: Date) => boolean,
): EstimatedSpan {
  const extraDays = estimateToWorkingDays(estimateMinutes) - 1;
  return anchor === "start"
    ? {
        start: ownDate,
        end: addWorkingDays(ownDate, extraDays, 1, isWorkingDay),
      }
    : {
        start: addWorkingDays(ownDate, extraDays, -1, isWorkingDay),
        end: ownDate,
      };
}

/**
 * `deriveTaskSchedule` that sizes an estimated single-date task by its
 * estimate. Every other task (both dates, no dates, no estimate, milestone)
 * gets exactly what `deriveTaskSchedule` returns.
 */
export function deriveTaskScheduleWithEstimate(
  task: {
    startDate: string | null;
    dueDate: string | null;
    estimateMinutes?: number | null;
    isMilestone?: boolean;
  },
  isWorkingDay?: (d: Date) => boolean,
): EstimatedSpan | null {
  const base = deriveTaskSchedule(task.startDate, task.dueDate);
  if (!base) return null;
  const estimated = getEstimatedSingleDate(task);
  if (!estimated) return base;
  // A single date makes the base schedule a one-day marker on that date.
  return estimatedSpanFromAnchor(
    estimated.anchor,
    estimated.anchor === "start" ? base.start : base.end,
    estimated.estimateMinutes,
    isWorkingDay,
  );
}

/**
 * The payload for persisting a move of an estimated single-date task: ONLY its
 * own date (the other stays null), taken from the displayed span. Returns the
 * ISO strings through `toIso`.
 */
export function ownDatePayload(
  anchor: EstimateAnchor,
  span: EstimatedSpan,
  toIso: (d: Date) => string,
): { startDate: string | null; dueDate: string | null } {
  return anchor === "start"
    ? { startDate: toIso(span.start), dueDate: null }
    : { startDate: null, dueDate: toIso(span.end) };
}
