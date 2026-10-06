import { describe, expect, it } from "vitest";
import {
  addWorkingDays,
  deriveTaskScheduleWithEstimate,
  estimatedSpanFromAnchor,
  getEstimatedSingleDate,
  ownDatePayload,
} from "./gantt-estimated-span";

// 2026-10-05 is a Monday.
const mon5 = new Date(2026, 9, 5);
const thu8 = new Date(2026, 9, 8);
const fri9 = new Date(2026, 9, 9);
const mon12 = new Date(2026, 9, 12);
const tue13 = new Date(2026, 9, 13);

const MON_FRI = (date: Date) => date.getDay() >= 1 && date.getDay() <= 5;
const DAY = 8 * 60;

function key(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function span(result: { start: Date; end: Date } | null) {
  return result && { start: key(result.start), end: key(result.end) };
}

describe("getEstimatedSingleDate", () => {
  it("reports the date the task has", () => {
    expect(
      getEstimatedSingleDate({
        startDate: "2026-10-05",
        dueDate: null,
        estimateMinutes: DAY,
      }),
    ).toEqual({ anchor: "start", estimateMinutes: DAY });
    expect(
      getEstimatedSingleDate({
        startDate: null,
        dueDate: "2026-10-05",
        estimateMinutes: 90,
      }),
    ).toEqual({ anchor: "due", estimateMinutes: 90 });
  });

  it.each([
    ["no estimate", { startDate: "2026-10-05", dueDate: null }],
    [
      "a null estimate",
      { startDate: "2026-10-05", dueDate: null, estimateMinutes: null },
    ],
    ["no dates", { startDate: null, dueDate: null, estimateMinutes: DAY }],
    [
      "both dates (never stored with an estimate)",
      { startDate: "2026-10-05", dueDate: "2026-10-09", estimateMinutes: DAY },
    ],
    [
      "a milestone",
      {
        startDate: "2026-10-05",
        dueDate: null,
        estimateMinutes: DAY,
        isMilestone: true,
      },
    ],
    [
      "a negative estimate",
      { startDate: "2026-10-05", dueDate: null, estimateMinutes: -1 },
    ],
  ])("is null for %s", (_name, task) => {
    expect(getEstimatedSingleDate(task)).toBeNull();
  });

  it("treats a zero estimate as an estimate", () => {
    expect(
      getEstimatedSingleDate({
        startDate: "2026-10-05",
        dueDate: null,
        estimateMinutes: 0,
      }),
    ).toEqual({ anchor: "start", estimateMinutes: 0 });
  });
});

describe("addWorkingDays", () => {
  it("skips weekends in both directions", () => {
    expect(key(addWorkingDays(fri9, 1, 1, MON_FRI))).toBe("2026-10-12");
    expect(key(addWorkingDays(mon12, 1, -1, MON_FRI))).toBe("2026-10-09");
  });

  it("counts calendar days without a calendar and returns the date for zero steps", () => {
    expect(key(addWorkingDays(fri9, 2, 1))).toBe("2026-10-11");
    expect(addWorkingDays(fri9, 0, 1, MON_FRI)).toBe(fri9);
  });
});

describe("estimatedSpanFromAnchor", () => {
  it("start-only: end is start plus (durationDays - 1) working days", () => {
    // 2 days from Monday: Mon + Tue.
    expect(
      span(estimatedSpanFromAnchor("start", mon5, 2 * DAY, MON_FRI)),
    ).toEqual({
      start: "2026-10-05",
      end: "2026-10-06",
    });
    // 3 days from Thursday cross the weekend: Thu, Fri, Mon.
    expect(
      span(estimatedSpanFromAnchor("start", thu8, 3 * DAY, MON_FRI)),
    ).toEqual({
      start: "2026-10-08",
      end: "2026-10-12",
    });
  });

  it("due-only: start is counted backwards from the due date", () => {
    // 3 days ending Monday: Thu, Fri, Mon.
    expect(
      span(estimatedSpanFromAnchor("due", mon12, 3 * DAY, MON_FRI)),
    ).toEqual({
      start: "2026-10-08",
      end: "2026-10-12",
    });
    expect(
      span(estimatedSpanFromAnchor("due", tue13, 2 * DAY, MON_FRI)),
    ).toEqual({
      start: "2026-10-12",
      end: "2026-10-13",
    });
  });

  it("rounds up to whole days and never goes below one day", () => {
    // 9 hours = 2 days; 4 hours and 0 minutes = 1 day (start === end).
    expect(
      span(estimatedSpanFromAnchor("start", mon5, 9 * 60, MON_FRI))?.end,
    ).toBe("2026-10-06");
    expect(
      span(estimatedSpanFromAnchor("start", mon5, 4 * 60, MON_FRI)),
    ).toEqual({
      start: "2026-10-05",
      end: "2026-10-05",
    });
    expect(span(estimatedSpanFromAnchor("due", mon5, 0, MON_FRI))).toEqual({
      start: "2026-10-05",
      end: "2026-10-05",
    });
  });

  it("uses calendar days when no working calendar is given", () => {
    expect(span(estimatedSpanFromAnchor("start", thu8, 3 * DAY))?.end).toBe(
      "2026-10-10",
    );
  });

  it("does not nudge the task's own date onto a working day", () => {
    const sat10 = new Date(2026, 9, 10);
    expect(
      span(estimatedSpanFromAnchor("start", sat10, 2 * DAY, MON_FRI)),
    ).toEqual({ start: "2026-10-10", end: "2026-10-12" });
  });
});

describe("deriveTaskScheduleWithEstimate", () => {
  it("sizes an estimated single-date task by its estimate", () => {
    expect(
      span(
        deriveTaskScheduleWithEstimate(
          {
            startDate: "2026-10-08T00:00:00.000Z".slice(0, 10),
            dueDate: null,
            estimateMinutes: 3 * DAY,
          },
          MON_FRI,
        ),
      ),
    ).toEqual({ start: "2026-10-08", end: "2026-10-12" });
    expect(
      span(
        deriveTaskScheduleWithEstimate(
          { startDate: null, dueDate: "2026-10-12", estimateMinutes: 3 * DAY },
          MON_FRI,
        ),
      ),
    ).toEqual({ start: "2026-10-08", end: "2026-10-12" });
  });

  it("leaves every other task as the plain schedule", () => {
    // Single date without an estimate: a one-day marker.
    expect(
      span(
        deriveTaskScheduleWithEstimate(
          { startDate: "2026-10-08", dueDate: null },
          MON_FRI,
        ),
      ),
    ).toEqual({ start: "2026-10-08", end: "2026-10-08" });
    // Both dates: the stored range.
    expect(
      span(
        deriveTaskScheduleWithEstimate(
          {
            startDate: "2026-10-05",
            dueDate: "2026-10-09",
            estimateMinutes: DAY,
          },
          MON_FRI,
        ),
      ),
    ).toEqual({ start: "2026-10-05", end: "2026-10-09" });
    // No dates: unscheduled.
    expect(
      deriveTaskScheduleWithEstimate(
        { startDate: null, dueDate: null, estimateMinutes: DAY },
        MON_FRI,
      ),
    ).toBeNull();
  });
});

describe("ownDatePayload", () => {
  const derived = { start: thu8, end: mon12 };
  const iso = key;

  it("sends only the start for a start-anchored task", () => {
    expect(ownDatePayload("start", derived, iso)).toEqual({
      startDate: "2026-10-08",
      dueDate: null,
    });
  });

  it("sends only the due date for a due-anchored task", () => {
    expect(ownDatePayload("due", derived, iso)).toEqual({
      startDate: null,
      dueDate: "2026-10-12",
    });
  });
});
