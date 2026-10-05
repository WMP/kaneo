import { HTTPException } from "hono/http-exception";

// Effort estimate constants shared by the task schemas and controllers.
//
// The estimate is stored as whole minutes (`task.estimateMinutes`) plus the
// unit the user entered it in (`task.estimateUnit`, only a display hint).
//
// MIRRORED in apps/web/src/lib/estimate.ts (WORK_DAY_MINUTES): the web app
// converts between minutes and the entered unit and the Gantt derives a bar
// length in working days from the same constant. There is no package both
// apps depend on that fits (`@kaneo/libs` depends on the API's types), so keep
// the two values equal.

/** Hours in one work day. */
export const WORK_DAY_HOURS = 8;

/** Minutes in one work day (8 hours). */
export const WORK_DAY_MINUTES = WORK_DAY_HOURS * 60;

export const ESTIMATE_UNITS = ["hours", "days"] as const;

export type EstimateUnit = (typeof ESTIMATE_UNITS)[number];

/** Upper bound for a stored estimate: 1,000,000 minutes (about 2,083 work days). */
export const MAX_ESTIMATE_MINUTES = 1_000_000;

/**
 * Name of the database check constraint behind the rule below. Keep equal to
 * the `check()` in database/schema.ts and the migration.
 */
export const ESTIMATE_DATE_RANGE_CONSTRAINT =
  "ganttpro_task_estimate_no_full_date_range";

/**
 * Stable client-facing message (400) when a task would hold an effort estimate
 * together with BOTH a start and a due date. Web and MCP clients show it as is.
 */
export const ESTIMATE_DATE_RANGE_CONFLICT_MESSAGE =
  "A task with an effort estimate cannot have both a start date and a due date. Remove the estimate or clear one of the dates.";

/**
 * Rule: a task that has an estimate must not have a complete date range.
 * Estimate + start only, estimate + due only and estimate alone are allowed.
 * Pass the MERGED state (what the row will hold after the write), not just
 * the incoming fields. Throws a 400 HTTPException on a violation.
 */
export function assertEstimateExcludesDateRange(state: {
  estimateMinutes: number | null | undefined;
  startDate: Date | null | undefined;
  dueDate: Date | null | undefined;
}): void {
  if (
    state.estimateMinutes != null &&
    state.startDate != null &&
    state.dueDate != null
  ) {
    throw new HTTPException(400, {
      message: ESTIMATE_DATE_RANGE_CONFLICT_MESSAGE,
    });
  }
}

/**
 * True when `error` is (or wraps, as Drizzle's query error does) the
 * PostgreSQL check violation of the rule above. A write that passed the
 * application check can still hit it under a concurrent write, or through a
 * path that forgot the check; the app error handler maps it to the same 400.
 */
export function isEstimateDateRangeViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown };
    if (
      candidate.code === "23514" &&
      candidate.constraint === ESTIMATE_DATE_RANGE_CONSTRAINT
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
