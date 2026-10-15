import { format } from "date-fns";
import { describe, expect, it } from "vitest";
import {
  type CascadeEdge,
  type CascadeSchedule,
  computeDependencyCascade,
} from "./gantt-dependency-cascade";

function day(n: number): Date {
  // Whole UTC days from a fixed epoch, so deltas are easy to reason about in
  // each test without pulling in date-fns just for arithmetic.
  return new Date(Date.UTC(2026, 0, 1 + n));
}

function schedule(start: number, end: number): CascadeSchedule {
  return { start: day(start), end: day(end) };
}

describe("computeDependencyCascade", () => {
  it("is a no-op when no constraint is violated", () => {
    // A (0-2) blocks B (5-7) FS, 0 lag: B.start (5) already >= A.end (2).
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(0, 2)],
      ["b", schedule(5, 7)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
    });

    expect(shifts.size).toBe(0);
  });

  it("pushes an FS dependent forward just enough to clear source.end + 1 + lag", () => {
    // A moved to (0-10), overlapping B's original (5-8). FS + 2 days lag:
    // B.start must be >= 10 + 1 + 2 = 13, so B shifts by 13 - 5 = 8 days.
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "fs",
        lagDays: 2,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(0, 10)],
      ["b", schedule(5, 8)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
    });

    expect(shifts.get("b")).toEqual(schedule(13, 16));
  });

  it("pushes an FS dependent by one day when the predecessor now ends on the dependent's start day", () => {
    // A moved to (0-5) so its end equals B's start (5): finish-to-start with
    // lag 0 still forces B to start the NEXT day (6), preserving its span.
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(0, 5)],
      ["b", schedule(5, 8)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
    });

    expect(shifts.get("b")).toEqual(schedule(6, 9));
  });

  it("enforces SS: target.start >= source.start + lag", () => {
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "ss",
        lagDays: 1,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(10, 20)],
      ["b", schedule(5, 9)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
    });

    // B.start must be >= 10 + 1 = 11, delta = 11 - 5 = 6.
    expect(shifts.get("b")).toEqual(schedule(11, 15));
  });

  it("enforces FF: target.end >= source.end + lag", () => {
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "ff",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(0, 10)],
      ["b", schedule(2, 6)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
    });

    // B.end must be >= 10, delta = 10 - 6 = 4.
    expect(shifts.get("b")).toEqual(schedule(6, 10));
  });

  it("enforces SF: target.end >= source.start + lag", () => {
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "sf",
        lagDays: 3,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(10, 20)],
      ["b", schedule(0, 5)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
    });

    // B.end must be >= 10 + 3 = 13, delta = 13 - 5 = 8.
    expect(shifts.get("b")).toEqual(schedule(8, 13));
  });

  it("cascades transitively: A blocks B blocks C, both FS", () => {
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "fs",
        lagDays: 0,
      },
      {
        sourceTaskId: "b",
        targetTaskId: "c",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(0, 10)],
      ["b", schedule(5, 8)],
      ["c", schedule(9, 12)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
    });

    // B pushed to start at 11 (delta 6) -> (11-14). C must start >= 15, its
    // original start is 9, so it also shifts by delta 6 -> (15-18).
    expect(shifts.get("b")).toEqual(schedule(11, 14));
    expect(shifts.get("c")).toEqual(schedule(15, 18));
  });

  it("preserves each shifted task's original duration", () => {
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(0, 20)],
      // A 1-day span (start === end).
      ["b", schedule(5, 5)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
    });

    const shiftedB = shifts.get("b");
    expect(shiftedB).toBeDefined();
    expect(shiftedB?.end.getTime()).toBe(shiftedB?.start.getTime());
  });

  it("never pulls a dependent EARLIER when the predecessor moves earlier", () => {
    // B currently starts well after A's ORIGINAL end; A moves earlier still,
    // so the FS constraint is even more satisfied than before. B must stay
    // exactly where it is.
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      // A moved from some later span to (0-2) — an earlier commit.
      ["a", schedule(0, 2)],
      ["b", schedule(20, 25)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
    });

    expect(shifts.size).toBe(0);
  });

  it("skips a dependent outside the provided scope (e.g. cross-project, or missing dates)", () => {
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "external",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    // "external" deliberately has no entry — same as a cross-project
    // dependent or a same-project task with no start/due date at all.
    const tasksById = new Map([["a", schedule(0, 10)]]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
    });

    expect(shifts.size).toBe(0);
  });

  it("does not cut the cascade short just because one branch is out of scope", () => {
    // A blocks B (in scope) and A blocks EXTERNAL (out of scope); B blocks C.
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "fs",
        lagDays: 0,
      },
      {
        sourceTaskId: "a",
        targetTaskId: "external",
        dependencyType: "fs",
        lagDays: 0,
      },
      {
        sourceTaskId: "b",
        targetTaskId: "c",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(0, 10)],
      ["b", schedule(5, 8)],
      ["c", schedule(9, 12)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
    });

    expect(shifts.has("external")).toBe(false);
    expect(shifts.get("b")).toEqual(schedule(11, 14));
    expect(shifts.get("c")).toEqual(schedule(15, 18));
  });

  it("combines multiple incoming edges by taking the strictest (max) forced delta", () => {
    // C is blocked by both A (FS) and B (FS); only A's constraint is
    // violated, but the combined result must still satisfy both.
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "c",
        dependencyType: "fs",
        lagDays: 0,
      },
      {
        sourceTaskId: "b",
        targetTaskId: "c",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(0, 20)],
      ["b", schedule(0, 3)],
      ["c", schedule(5, 8)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
    });

    // A forces C.start >= 21 (delta 16); B forces C.start >= 4 (already
    // satisfied). The stricter one wins.
    expect(shifts.get("c")).toEqual(schedule(21, 24));
  });

  it("nudges a shifted task's start forward off a weekend, preserving its span", () => {
    // day(2) = 2026-01-03 = Saturday, day(3) = Sunday, day(4) = Monday. A
    // (ending day 2) forces B's start onto the Saturday; B must land on the
    // following Monday instead, with its original 3-day span intact.
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(0, 2)],
      ["b", schedule(0, 3)],
    ]);

    const isWorkingDay = (d: Date) => {
      const dow = d.getUTCDay();
      return dow !== 0 && dow !== 6;
    };

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
      isWorkingDay,
    });

    // Forced start = A.end + 1 (day 3, Sunday), delta = 3 - 0 = 3. Nudged
    // forward 1 more day to day 4 (Monday); end carries the same +4 total,
    // from day 3 to day 7.
    expect(shifts.get("b")).toEqual(schedule(4, 7));
  });

  it("nudges a shifted task's start forward off a workspace holiday", () => {
    // day(5) = 2026-01-06 (Tuesday) is declared a holiday for this test.
    const holiday = day(5).getTime();
    const isWorkingDay = (d: Date) => {
      if (d.getTime() === holiday) return false;
      const dow = d.getUTCDay();
      return dow !== 0 && dow !== 6;
    };

    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(0, 5)], // ends on the holiday, day(5)
      ["b", schedule(0, 2)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
      isWorkingDay,
    });

    // Forced start = day(6), the day after the holiday A ends on: Wednesday,
    // a working day, so no nudge is needed.
    expect(shifts.get("b")).toEqual(schedule(6, 8));
  });

  it("propagates a nudged schedule further downstream through the chain", () => {
    // A pushes B onto Sunday (day 3); B nudges to Monday (day 4). C is
    // blocked by B FS with 0 lag, originally comfortably after B's
    // PRE-nudge schedule but not its POST-nudge one, so C must also shift.
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "fs",
        lagDays: 0,
      },
      {
        sourceTaskId: "b",
        targetTaskId: "c",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(0, 2)],
      ["b", schedule(0, 3)],
      // C originally starts at day 3: satisfies B's pre-nudge end (3) but
      // not its post-nudge end (7).
      ["c", schedule(3, 5)],
    ]);

    const isWorkingDay = (d: Date) => {
      const dow = d.getUTCDay();
      return dow !== 0 && dow !== 6;
    };

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
      isWorkingDay,
    });

    // B: forced start day 3 (Sunday) -> nudged to day 4 (Monday), end day 7.
    expect(shifts.get("b")).toEqual(schedule(4, 7));
    // C: forced start >= B.end + 1 (8); original start 3, delta 5 -> (8, 10).
    // day(8) is Friday, a working day, so no further nudge.
    expect(shifts.get("c")).toEqual(schedule(8, 10));
  });

  it("never nudges when no isWorkingDay predicate is given (unchanged behavior)", () => {
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(0, 2)], // forces B.start to land on Sunday (day 3)
      ["b", schedule(0, 3)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
    });

    // No predicate supplied: B lands exactly on day 3, weekend or not.
    expect(shifts.get("b")).toEqual(schedule(3, 6));
  });

  it("never shifts a task pinned by a must_start_on constraint", () => {
    // A blocks B (pinned) FS, 0 lag — would normally push B from 5 to 10.
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(0, 10)],
      ["b", schedule(5, 8)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
      pinnedTaskIds: new Set(["b"]),
    });

    expect(shifts.has("b")).toBe(false);
  });

  it("does not propagate a phantom shift through a pinned must_start_on task to its dependents", () => {
    // A blocks B (pinned) blocks C, both FS 0 lag. Without pinning, B would
    // shift to (10-13) and force C from (9-12) to (13-16). With B pinned, B
    // stays at (5-8) and C's constraint against B's REAL end (8) is already
    // satisfied (C starts at 9), so C must not move either.
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "fs",
        lagDays: 0,
      },
      {
        sourceTaskId: "b",
        targetTaskId: "c",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(0, 10)],
      ["b", schedule(5, 8)],
      ["c", schedule(9, 12)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
      pinnedTaskIds: new Set(["b"]),
    });

    expect(shifts.has("b")).toBe(false);
    expect(shifts.has("c")).toBe(false);
  });

  it("omitting pinnedTaskIds behaves exactly like before this feature existed", () => {
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      ["a", schedule(0, 10)],
      ["b", schedule(5, 8)],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
    });

    expect(shifts.get("b")).toEqual(schedule(11, 14));
  });

  it("returns nothing when the moved task itself is unscoped", () => {
    const edges: CascadeEdge[] = [
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([["b", schedule(0, 5)]]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
    });

    expect(shifts.size).toBe(0);
  });
});

describe("computeDependencyCascade with estimated single-date tasks", () => {
  // 2026-10-05 is a Monday; local dates so the Mon-Fri predicate lines up.
  const local = (dayOfMonth: number) => new Date(2026, 9, dayOfMonth);
  const MON_FRI = (date: Date) => date.getDay() >= 1 && date.getDay() <= 5;
  const DAY = 8 * 60;
  const key = (date: Date) =>
    `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  const fs: CascadeEdge[] = [
    {
      sourceTaskId: "a",
      targetTaskId: "b",
      dependencyType: "fs",
      lagDays: 0,
    },
  ];

  it("re-derives a start-only task's end from its shifted own date", () => {
    // B: start Thu 8, 3 days => Thu, Fri, Mon (end Mon 12, 4 calendar days).
    // A now finishes Mon 12 => B.start must move to Tue 13 (delta 5). Keeping
    // the calendar span would end B on Sat 17; the estimate says Tue-Thu.
    const tasksById = new Map([
      ["a", { start: local(5), end: local(12) }],
      ["b", { start: local(8), end: local(12) }],
    ]);

    const preserved = computeDependencyCascade({
      movedTaskId: "a",
      edges: fs,
      tasksById,
      isWorkingDay: MON_FRI,
    });
    expect(key(preserved.get("b")?.end as Date)).toBe("2026-10-17");

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: fs,
      tasksById,
      isWorkingDay: MON_FRI,
      estimatedTasks: new Map([
        ["b", { anchor: "start" as const, estimateMinutes: 3 * DAY }],
      ]),
    });

    expect(key(shifts.get("b")?.start as Date)).toBe("2026-10-13");
    expect(key(shifts.get("b")?.end as Date)).toBe("2026-10-15");
  });

  it("keeps a due-only task's re-derived start at or after the constraint", () => {
    // B: due Wed 7, 3 days => Mon 5 - Wed 7. A finishes Fri 9 => B.start must
    // be >= Sat 10 (the day after), nudged to Mon 12. Three working days back
    // from the calendar-preserving end must not start before that: the due
    // date moves on to Wed 14 (Mon 12, Tue 13, Wed 14).
    const tasksById = new Map([
      ["a", { start: local(5), end: local(9) }],
      ["b", { start: local(5), end: local(7) }],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: fs,
      tasksById,
      isWorkingDay: MON_FRI,
      estimatedTasks: new Map([
        ["b", { anchor: "due" as const, estimateMinutes: 3 * DAY }],
      ]),
    });

    expect(key(shifts.get("b")?.start as Date)).toBe("2026-10-12");
    expect(key(shifts.get("b")?.end as Date)).toBe("2026-10-14");
  });

  it("anchors the next dependent on the re-derived span of an estimated task", () => {
    // A -> B (estimated, start-only) -> C (dated). C follows B's re-derived end.
    const edges: CascadeEdge[] = [
      ...fs,
      {
        sourceTaskId: "b",
        targetTaskId: "c",
        dependencyType: "fs",
        lagDays: 0,
      },
    ];
    const tasksById = new Map([
      ["a", { start: local(5), end: local(12) }],
      ["b", { start: local(8), end: local(12) }],
      ["c", { start: local(12), end: local(13) }],
    ]);

    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges,
      tasksById,
      isWorkingDay: MON_FRI,
      estimatedTasks: new Map([
        ["b", { anchor: "start" as const, estimateMinutes: 3 * DAY }],
      ]),
    });

    // B ends Thu 15, so C (fs, lag 0) starts Fri 16: delta 4, span preserved.
    expect(key(shifts.get("c")?.start as Date)).toBe("2026-10-16");
    expect(key(shifts.get("c")?.end as Date)).toBe("2026-10-17");
  });

  it("is unchanged for tasks that are not in estimatedTasks", () => {
    const tasksById = new Map([
      ["a", { start: local(5), end: local(12) }],
      ["b", { start: local(8), end: local(12) }],
    ]);
    const without = computeDependencyCascade({
      movedTaskId: "a",
      edges: fs,
      tasksById,
      isWorkingDay: MON_FRI,
    });
    const withEmpty = computeDependencyCascade({
      movedTaskId: "a",
      edges: fs,
      tasksById,
      isWorkingDay: MON_FRI,
      estimatedTasks: new Map(),
    });
    expect(withEmpty).toEqual(without);
  });
});

// DST-sensitive cases. They are built from LOCAL dates (what the Gantt works
// in), and their expected days are literal local calendar days worked out by
// hand. In a zone without a daylight saving change (CI runs in UTC) they pass
// trivially; run them with `pnpm --filter @kaneo/web test:tz` to exercise the
// Europe/Warsaw (DST ends 2026-10-25, starts 2026-03-29) and America/New_York
// (DST ends 2026-11-01, starts 2026-03-08) transitions.
describe("computeDependencyCascade across daylight saving changes (local days)", () => {
  const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);
  const ymd = (d: Date) => format(d, "yyyy-MM-dd");
  // Monday-Friday, by LOCAL weekday, like the production calendar predicate.
  const monFri = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;

  function edge(
    dependencyType: CascadeEdge["dependencyType"],
    sourceTaskId = "a",
    targetTaskId = "b",
    lagDays = 0,
  ): CascadeEdge {
    return { sourceTaskId, targetTaskId, dependencyType, lagDays };
  }

  // The result must be at LOCAL MIDNIGHT: the route saves startOfDay(d), so a
  // 23:00 value of the previous day (or 01:00) is a different saved day.
  function expectLocalSpan(
    actual: CascadeSchedule | undefined,
    start: string,
    end: string,
  ) {
    expect(actual).toBeDefined();
    if (!actual) return;
    expect([ymd(actual.start), ymd(actual.end)]).toEqual([start, end]);
    expect([actual.start.getHours(), actual.end.getHours()]).toEqual([0, 0]);
  }

  it("Europe/Warsaw, end of DST: FS shift lands on 28 Oct, not 23:00 on 27 Oct", () => {
    // A ends Tue 27 Oct, so FS (handoff 1 day, lag 0) puts B on Wed 28 Oct.
    // B keeps its 2-day span (20-21 Oct, a shift of 8 days): 28-29 Oct. The
    // 25 Oct change makes a local day 25 hours long in between.
    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      tasksById: new Map([
        ["a", { start: local(2026, 10, 19), end: local(2026, 10, 27) }],
        ["b", { start: local(2026, 10, 20), end: local(2026, 10, 21) }],
      ]),
    });

    expectLocalSpan(shifts.get("b"), "2026-10-28", "2026-10-29");
  });

  it("America/New_York, end of DST: a one-day dependent lands on 4 Nov", () => {
    // A ends Tue 3 Nov, so B (27 Oct, one day) moves to Wed 4 Nov; 1 Nov is
    // the 25-hour day.
    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      tasksById: new Map([
        ["a", { start: local(2026, 10, 26), end: local(2026, 11, 3) }],
        ["b", { start: local(2026, 10, 27), end: local(2026, 10, 27) }],
      ]),
    });

    expectLocalSpan(shifts.get("b"), "2026-11-04", "2026-11-04");
  });

  it("start of DST (Warsaw 29 Mar, New York 8 Mar): the shifted dependent stays at local midnight", () => {
    // Warsaw window: A ends Tue 31 Mar -> B (24-25 Mar) moves 8 days to
    // 1-2 Apr. The 23-hour day on 29 Mar must not leave it at 01:00.
    const warsaw = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      tasksById: new Map([
        ["a", { start: local(2026, 3, 23), end: local(2026, 3, 31) }],
        ["b", { start: local(2026, 3, 24), end: local(2026, 3, 25) }],
      ]),
    });
    expectLocalSpan(warsaw.get("b"), "2026-04-01", "2026-04-02");

    // New York window: A ends Tue 10 Mar -> B (3-4 Mar) moves 8 days to
    // 11-12 Mar.
    const newYork = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      tasksById: new Map([
        ["a", { start: local(2026, 3, 2), end: local(2026, 3, 10) }],
        ["b", { start: local(2026, 3, 3), end: local(2026, 3, 4) }],
      ]),
    });
    expectLocalSpan(newYork.get("b"), "2026-03-11", "2026-03-12");
  });

  it("measures the forced delta in calendar days when the gap spans the DST change (FF, SS)", () => {
    // FF: A ends Tue 27 Oct; B (20-22 Oct) must end on/after it -> shift 5
    // days: 25-27 Oct (Warsaw's 25 Oct is the 25-hour day).
    const ff = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("ff")],
      tasksById: new Map([
        ["a", { start: local(2026, 10, 19), end: local(2026, 10, 27) }],
        ["b", { start: local(2026, 10, 20), end: local(2026, 10, 22) }],
      ]),
    });
    expectLocalSpan(ff.get("b"), "2026-10-25", "2026-10-27");

    // SS with 2 days lag: A starts Mon 26 Oct (moved), B (21-22 Oct) must
    // start on 28 Oct -> shift 7 days: 28-29 Oct.
    const ss = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("ss", "a", "b", 2)],
      tasksById: new Map([
        ["a", { start: local(2026, 10, 26), end: local(2026, 10, 30) }],
        ["b", { start: local(2026, 10, 21), end: local(2026, 10, 22) }],
      ]),
    });
    expectLocalSpan(ss.get("b"), "2026-10-28", "2026-10-29");
  });

  it("cascades transitively across the DST change", () => {
    // A ends Tue 27 Oct -> B 28-29 Oct -> C (22-23 Oct) starts 30 Oct and
    // keeps its 2-day span: 30-31 Oct.
    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs", "a", "b"), edge("fs", "b", "c")],
      tasksById: new Map([
        ["a", { start: local(2026, 10, 19), end: local(2026, 10, 27) }],
        ["b", { start: local(2026, 10, 20), end: local(2026, 10, 21) }],
        ["c", { start: local(2026, 10, 22), end: local(2026, 10, 23) }],
      ]),
    });

    expectLocalSpan(shifts.get("b"), "2026-10-28", "2026-10-29");
    expectLocalSpan(shifts.get("c"), "2026-10-30", "2026-10-31");
  });

  it("working-day nudge across the Warsaw DST end: Saturday start moves to Monday 26 Oct", () => {
    // A (Mon 19 - Fri 23 Oct) -> B (Tue 20 - Wed 21 Oct): FS start Sat 24 Oct
    // (shift 4), nudged over Sunday 25 Oct (25 hours long) to Mon 26 Oct;
    // the end follows: 21 + 4 + 2 = Tue 27 Oct.
    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      isWorkingDay: monFri,
      tasksById: new Map([
        ["a", { start: local(2026, 10, 19), end: local(2026, 10, 23) }],
        ["b", { start: local(2026, 10, 20), end: local(2026, 10, 21) }],
      ]),
    });

    expectLocalSpan(shifts.get("b"), "2026-10-26", "2026-10-27");
  });

  it("working-day nudge across the New York DST end: Saturday start moves to Monday 2 Nov", () => {
    // A (Mon 26 - Fri 30 Oct) -> B (Tue 27 - Wed 28 Oct): FS start Sat 31 Oct
    // (shift 4), nudged over Sunday 1 Nov to Mon 2 Nov; end: 28 Oct + 4 + 2 =
    // Tue 3 Nov.
    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      isWorkingDay: monFri,
      tasksById: new Map([
        ["a", { start: local(2026, 10, 26), end: local(2026, 10, 30) }],
        ["b", { start: local(2026, 10, 27), end: local(2026, 10, 28) }],
      ]),
    });

    expectLocalSpan(shifts.get("b"), "2026-11-02", "2026-11-03");
  });

  it("working-day nudge across the DST start (Warsaw 29 Mar, New York 8 Mar)", () => {
    // Warsaw: A (Mon 23 - Fri 27 Mar) -> B (24-25 Mar): Sat 28 Mar nudged
    // over Sunday 29 Mar (23 hours long) to Mon 30 Mar; end 25 + 4 + 2 = 31 Mar.
    const warsaw = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      isWorkingDay: monFri,
      tasksById: new Map([
        ["a", { start: local(2026, 3, 23), end: local(2026, 3, 27) }],
        ["b", { start: local(2026, 3, 24), end: local(2026, 3, 25) }],
      ]),
    });
    expectLocalSpan(warsaw.get("b"), "2026-03-30", "2026-03-31");

    // New York: A (Mon 2 - Fri 6 Mar) -> B (3-4 Mar): Sat 7 Mar nudged over
    // Sunday 8 Mar to Mon 9 Mar; end 4 + 4 + 2 = 10 Mar.
    const newYork = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      isWorkingDay: monFri,
      tasksById: new Map([
        ["a", { start: local(2026, 3, 2), end: local(2026, 3, 6) }],
        ["b", { start: local(2026, 3, 3), end: local(2026, 3, 4) }],
      ]),
    });
    expectLocalSpan(newYork.get("b"), "2026-03-09", "2026-03-10");
  });

  it("re-derives an estimated start-only dependent over the Warsaw DST end", () => {
    // A ends Fri 23 Oct -> FS start Sat 24 Oct, nudged to Mon 26 Oct. A
    // 2-working-day estimate (960 minutes) then ends Tue 27 Oct.
    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      isWorkingDay: monFri,
      tasksById: new Map([
        ["a", { start: local(2026, 10, 19), end: local(2026, 10, 23) }],
        ["b", { start: local(2026, 10, 20), end: local(2026, 10, 21) }],
      ]),
      estimatedTasks: new Map([
        ["b", { anchor: "start", estimateMinutes: 960 }],
      ]),
    });

    expectLocalSpan(shifts.get("b"), "2026-10-26", "2026-10-27");
  });
});
