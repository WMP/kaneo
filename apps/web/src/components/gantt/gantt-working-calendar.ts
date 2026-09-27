// Pure helpers for the workspace's working calendar (weekends + holidays).
// Kept free of React/the DOM/network, like the rest of this folder's pure
// modules (timeline.ts, gantt-dependency-cascade.ts, ...), so both the
// Gantt's day-column shading and the dependency cascade's forward-nudge can
// share one definition of "is this day a working day" and test it directly.
//
// ENCODING: mirrors workspaceTable.workingDays on the API (see
// apps/api/src/database/schema.ts) — bit i (i = 0..6, 0 = Sunday, matching
// JS Date#getDay()) set means weekday i is a WORKING day. Default 62 =
// 0b0111110 = Monday..Friday working, Saturday/Sunday off.
export const DEFAULT_WORKING_DAYS = 62;

/** Local calendar-day key ("yyyy-MM-dd"), independent of time-of-day. */
export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Builds the date-key set `isWorkingDay` expects from the calendar's holiday
 * list (as returned by GET /calendar/{workspaceId}). A holiday's `date` is
 * stored at UTC midnight with date-only semantics (see the API schema), so
 * its ISO string's date part IS the intended calendar date — reading it
 * directly, rather than parsing into a Date and re-formatting in the local
 * time zone, means a holiday always matches the calendar day it was entered
 * as regardless of the viewer's time zone.
 */
export function buildHolidayDateKeySet(
  holidays: readonly { date: string }[],
): Set<string> {
  return new Set(holidays.map((holiday) => holiday.date.slice(0, 10)));
}

/**
 * Whether `date` is a working day: not a holiday, AND its weekday bit is set
 * in `workingDays`. A holiday always wins over the bitmask — a holiday
 * falling on an otherwise-working weekday is still non-working.
 */
export function isWorkingDay(
  date: Date,
  workingDays: number,
  holidayDateSet: ReadonlySet<string>,
): boolean {
  if (holidayDateSet.has(toDateKey(date))) return false;
  const bit = 1 << date.getDay();
  return (workingDays & bit) !== 0;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Builds a monotonic day-indexer that numbers each calendar day by how many
 * WORKING days precede it (from `anchor`): consecutive working days get
 * consecutive integers and a run of weekends/holidays collapses to no gap.
 * Feed it to computeCriticalPath's `toDayIndex` so critical-path slack is
 * measured in working days — a hand-off spanning only a weekend then reads as
 * tight (the next working day) instead of carrying the weekend as slack.
 *
 * Results are cached and the forward walk is extended lazily, so repeated
 * lookups are O(1) amortized and total work is bounded by the queried span.
 * Dates before `anchor` fall back to a backward count (negative indices);
 * callers that anchor at their earliest date never hit that path.
 */
export function makeWorkingDayIndexer(
  anchor: Date,
  workingDays: number,
  holidayDateSet: ReadonlySet<string>,
): (date: Date) => number {
  const anchorDay = startOfLocalDay(anchor);
  const cache = new Map<string, number>();
  cache.set(toDateKey(anchorDay), 0);
  let cursor = anchorDay;
  let countBeforeCursor = 0; // working days strictly before `cursor`

  return (date: Date): number => {
    const target = startOfLocalDay(date);
    const key = toDateKey(target);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    if (target.getTime() < anchorDay.getTime()) {
      // Rare: a date earlier than the anchor. Count backward from the anchor.
      let count = 0;
      let day = new Date(anchorDay);
      while (day.getTime() > target.getTime()) {
        day = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1);
        if (isWorkingDay(day, workingDays, holidayDateSet)) count -= 1;
      }
      cache.set(key, count);
      return count;
    }

    // Extend the forward walk up to `target`, caching every day on the way.
    while (cursor.getTime() < target.getTime()) {
      if (isWorkingDay(cursor, workingDays, holidayDateSet)) {
        countBeforeCursor += 1;
      }
      cursor = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate() + 1,
      );
      cache.set(toDateKey(cursor), countBeforeCursor);
    }
    return cache.get(key) ?? countBeforeCursor;
  };
}
