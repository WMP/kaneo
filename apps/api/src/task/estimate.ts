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
