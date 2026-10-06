// Effort-estimate helpers shared by the task details and the Gantt.
//
// The API stores an estimate as whole minutes (`estimateMinutes`) plus the unit
// the user entered it in (`estimateUnit`, a display hint only). A work day is 8
// hours.
//
// MIRRORED in apps/api/src/task/estimate.ts (WORK_DAY_MINUTES,
// MAX_ESTIMATE_MINUTES): no package is shared by both apps that fits, so keep
// the values equal.

export const WORK_DAY_MINUTES = 8 * 60;

/** Largest estimate the API accepts, in minutes. */
export const MAX_ESTIMATE_MINUTES = 1_000_000;

export const ESTIMATE_UNITS = ["hours", "days"] as const;

export type EstimateUnit = (typeof ESTIMATE_UNITS)[number];

export function isEstimateUnit(value: unknown): value is EstimateUnit {
  return value === "hours" || value === "days";
}

/** Minutes in one `unit`. */
export function minutesPerUnit(unit: EstimateUnit): number {
  return unit === "days" ? WORK_DAY_MINUTES : 60;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Converts stored minutes to the number shown in the field for `unit`. */
export function minutesToUnitValue(
  minutes: number,
  unit: EstimateUnit,
): number {
  return roundTo(minutes / minutesPerUnit(unit), 2);
}

export type ParsedEstimate =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "value"; minutes: number };

/**
 * Parses the field text (decimals allowed, "," or "." as the separator) into
 * whole minutes. Empty text clears the estimate; negative, non-numeric or
 * over-limit input is invalid.
 */
export function parseEstimateInput(
  text: string,
  unit: EstimateUnit,
): ParsedEstimate {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  if (!/^\d*[.,]?\d+$|^\d+[.,]$/.test(trimmed)) return { kind: "invalid" };
  const value = Number.parseFloat(trimmed.replace(",", "."));
  if (!Number.isFinite(value)) return { kind: "invalid" };
  const minutes = Math.round(value * minutesPerUnit(unit));
  if (minutes < 0 || minutes > MAX_ESTIMATE_MINUTES) {
    return { kind: "invalid" };
  }
  return { kind: "value", minutes };
}

/**
 * Length of an estimate on the Gantt, in whole working days: at least one day,
 * rounded up (a 9-hour estimate takes 2 days).
 */
export function estimateToWorkingDays(estimateMinutes: number): number {
  return Math.max(1, Math.ceil(estimateMinutes / WORK_DAY_MINUTES));
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Short label for a stored estimate in the unit it was entered in, e.g. "1.5 h" or "2 d". */
export function formatEstimate(
  minutes: number,
  unit: string | undefined,
  t: Translate,
): string {
  const resolved: EstimateUnit = isEstimateUnit(unit) ? unit : "hours";
  const value = minutesToUnitValue(minutes, resolved);
  return t(
    resolved === "days"
      ? "tasks:estimate.valueDays"
      : "tasks:estimate.valueHours",
    { value },
  );
}

// A task with an estimate must not have a complete date range (the API and a
// database check enforce it, see docs/agent-guide/scheduling.md). These two
// predicates drive the disabled pickers/inputs so the UI never offers the
// forbidden combination.

type MaybeDate = string | Date | null | undefined;

/** True when both a start and a due date are set. */
export function hasFullDateRange(
  startDate: MaybeDate,
  dueDate: MaybeDate,
): boolean {
  return Boolean(startDate) && Boolean(dueDate);
}

/**
 * True when the date picker for `ownDate` must be disabled: the task has an
 * estimate, this date is empty and the OTHER date is already set (setting it
 * would complete the range). A date that is already set stays editable.
 */
export function isDateBlockedByEstimate(
  estimateMinutes: number | null | undefined,
  ownDate: MaybeDate,
  otherDate: MaybeDate,
): boolean {
  return estimateMinutes != null && !ownDate && Boolean(otherDate);
}
