import { describe, expect, it } from "vitest";
import type { CascadeEdge } from "./gantt-dependency-cascade";
import {
  type DerivedScheduleSource,
  deriveUndatedSuccessorSchedules,
} from "./gantt-derived-schedule";
import { deriveTaskScheduleWithEstimate } from "./gantt-estimated-span";

function day(n: number): Date {
  // Whole UTC days from a fixed epoch, so deltas are easy to reason about in
  // each test without pulling in date-fns just for arithmetic.
  return new Date(Date.UTC(2026, 0, 1 + n));
}

function schedule(start: number, end: number): DerivedScheduleSource {
  return { start: day(start), end: day(end) };
}

function edge(
  sourceTaskId: string,
  targetTaskId: string,
  dependencyType: CascadeEdge["dependencyType"] = "fs",
  lagDays = 0,
): CascadeEdge {
  return { sourceTaskId, targetTaskId, dependencyType, lagDays };
}

describe("deriveUndatedSuccessorSchedules", () => {
  it("places an undated FS successor on the day after predecessor.end (zero-duration point)", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 0)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: ["b"],
    });

    // FS, no lag: B sits on the day AFTER A's end day, as a single-day marker.
    expect(derived.get("b")).toEqual({ start: day(5), end: day(5) });
  });

  it("applies positive lag and negative lead to the FS anchor", () => {
    const withLag = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 3)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: ["b"],
    });
    expect(withLag.get("b")).toEqual({ start: day(8), end: day(8) });

    const withLead = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", -2)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: ["b"],
    });
    expect(withLead.get("b")).toEqual({ start: day(3), end: day(3) });
  });

  it("anchors SS/SF on predecessor.start, FF on predecessor.end and FS the day after it", () => {
    const dated = new Map([["a", schedule(2, 9)]]);

    const fs = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 0)],
      datedScheduleById: dated,
      undatedCandidateIds: ["b"],
    });
    expect(fs.get("b")).toEqual({ start: day(10), end: day(10) });

    const ff = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "ff", 0)],
      datedScheduleById: dated,
      undatedCandidateIds: ["b"],
    });
    expect(ff.get("b")).toEqual({ start: day(9), end: day(9) });

    const ss = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "ss", 0)],
      datedScheduleById: dated,
      undatedCandidateIds: ["b"],
    });
    expect(ss.get("b")).toEqual({ start: day(2), end: day(2) });

    const sf = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "sf", 0)],
      datedScheduleById: dated,
      undatedCandidateIds: ["b"],
    });
    expect(sf.get("b")).toEqual({ start: day(2), end: day(2) });
  });

  it("takes the latest anchor across several dated predecessors", () => {
    const derived = deriveUndatedSuccessorSchedules({
      // A ends day 4, C ends day 10 — the later of the two constraints wins.
      edges: [edge("a", "b", "fs", 0), edge("c", "b", "fs", 0)],
      datedScheduleById: new Map([
        ["a", schedule(0, 4)],
        ["c", schedule(6, 10)],
      ]),
      undatedCandidateIds: ["b"],
    });
    expect(derived.get("b")).toEqual({ start: day(11), end: day(11) });
  });

  it("ignores a candidate that already has a real schedule", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 0)],
      // B is BOTH a candidate and dated — its own dates win, so nothing is
      // derived for it.
      datedScheduleById: new Map([
        ["a", schedule(0, 4)],
        ["b", schedule(20, 22)],
      ]),
      undatedCandidateIds: ["b"],
    });
    expect(derived.has("b")).toBe(false);
    expect(derived.size).toBe(0);
  });

  it("does not chain through an undated predecessor that has no estimate", () => {
    // a (dated) blocks b (undated) blocks c (undated). b gets a derived point,
    // but c must NOT — its only predecessor b has no REAL schedule, and this
    // pass deliberately never chains through a derived one.
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 0), edge("b", "c", "fs", 0)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: ["b", "c"],
    });
    expect(derived.get("b")).toEqual({ start: day(5), end: day(5) });
    expect(derived.has("c")).toBe(false);
  });

  it("leaves a candidate with no dated predecessor unplaced", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 0)],
      // The only edge into b comes from an undated source.
      datedScheduleById: new Map(),
      undatedCandidateIds: ["b"],
    });
    expect(derived.size).toBe(0);
  });

  it("only derives listed candidates, not arbitrary edge targets", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 0), edge("a", "z", "fs", 0)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      // z is a successor too, but not offered as a candidate (e.g. it has its
      // own dates elsewhere, or is out of this project's relation set).
      undatedCandidateIds: ["b"],
    });
    expect(derived.has("b")).toBe(true);
    expect(derived.has("z")).toBe(false);
  });

  it("nudges a derived anchor off a non-working day when a calendar is given", () => {
    // A ends on day 4; treat days 5 and 6 as non-working (a weekend), so an FS
    // successor with +1 lag (landing on day 6) is nudged forward to day 7.
    const nonWorking = new Set([day(5).getTime(), day(6).getTime()]);
    const isWorkingDay = (d: Date) => !nonWorking.has(d.getTime());

    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 1)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: ["b"],
      isWorkingDay,
    });
    expect(derived.get("b")).toEqual({ start: day(7), end: day(7) });
  });

  it("does not nudge when no calendar predicate is supplied", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 1)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: ["b"],
    });
    // Lands on day 6 (end 4 + 1 + lag 1) and stays there — no calendar means
    // no nudge.
    expect(derived.get("b")).toEqual({ start: day(6), end: day(6) });
  });

  it("ignores a self-referencing edge", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("b", "b", "fs", 0)],
      datedScheduleById: new Map([["b-source", schedule(0, 4)]]),
      undatedCandidateIds: ["b"],
    });
    expect(derived.size).toBe(0);
  });

  it("returns nothing when there are no candidates", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 0)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: [],
    });
    expect(derived.size).toBe(0);
  });
});

// day(0) is Thursday 2026-01-01, so day(2) is Saturday and day(4) is Monday.
const MON_FRI = (date: Date) => {
  const weekday = date.getUTCDay();
  return weekday >= 1 && weekday <= 5;
};

const HOURS = 60;
const WORK_DAY = 8 * HOURS;

function estimates(entries: Record<string, number | null>) {
  return new Map(Object.entries(entries));
}

describe("deriveUndatedSuccessorSchedules with an effort estimate", () => {
  it("spans ceil(estimate / work day) calendar days when there is no calendar", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 0)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: ["b"],
      // 17 hours is 2.125 work days, so 3 days.
      estimateMinutesById: estimates({ b: 17 * HOURS }),
    });

    // FS starts the day AFTER the predecessor's end day (end + 1 + lag).
    expect(derived.get("b")).toEqual({ start: day(5), end: day(7) });
  });

  it("rounds a part day up and never goes below one day", () => {
    const common = {
      edges: [edge("a", "b", "fs", 0)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: ["b"],
    };
    expect(
      deriveUndatedSuccessorSchedules({
        ...common,
        estimateMinutesById: estimates({ b: WORK_DAY + 1 }),
      }).get("b"),
    ).toEqual({ start: day(5), end: day(6) });
    expect(
      deriveUndatedSuccessorSchedules({
        ...common,
        estimateMinutesById: estimates({ b: 30 }),
      }).get("b"),
    ).toEqual({ start: day(5), end: day(5) });
    expect(
      deriveUndatedSuccessorSchedules({
        ...common,
        estimateMinutesById: estimates({ b: 0 }),
      }).get("b"),
    ).toEqual({ start: day(5), end: day(5) });
  });

  it("keeps the single-day marker when the estimate is missing or unusable", () => {
    for (const value of [null, undefined, Number.NaN, -60]) {
      const derived = deriveUndatedSuccessorSchedules({
        edges: [edge("a", "b", "fs", 0)],
        datedScheduleById: new Map([["a", schedule(0, 4)]]),
        undatedCandidateIds: ["b"],
        estimateMinutesById: new Map([["b", value]]),
      });
      expect(derived.get("b")).toEqual({ start: day(5), end: day(5) });
    }
  });

  it("skips non-working days when extending the end", () => {
    const derived = deriveUndatedSuccessorSchedules({
      // Predecessor ends Thursday; the successor starts Friday and its three
      // working days are Fri, Mon, Tue.
      edges: [edge("a", "b", "fs", 0)],
      datedScheduleById: new Map([["a", schedule(0, 0)]]),
      undatedCandidateIds: ["b"],
      isWorkingDay: MON_FRI,
      estimateMinutesById: estimates({ b: 3 * WORK_DAY }),
    });

    expect(derived.get("b")).toEqual({ start: day(1), end: day(5) });
  });

  it("nudges a start that lands on a weekend forward before counting the span", () => {
    const derived = deriveUndatedSuccessorSchedules({
      // Predecessor ends Saturday: the next day (Sunday) nudges to Monday, two
      // days end Tuesday.
      edges: [edge("a", "b", "fs", 0)],
      datedScheduleById: new Map([["a", schedule(0, 2)]]),
      undatedCandidateIds: ["b"],
      isWorkingDay: MON_FRI,
      estimateMinutesById: estimates({ b: 2 * WORK_DAY }),
    });

    expect(derived.get("b")).toEqual({ start: day(4), end: day(5) });
  });

  it("anchors SS on the predecessor's start", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "ss", 1)],
      datedScheduleById: new Map([["a", schedule(10, 20)]]),
      undatedCandidateIds: ["b"],
      estimateMinutesById: estimates({ b: 2 * WORK_DAY }),
    });

    expect(derived.get("b")).toEqual({ start: day(11), end: day(12) });
  });

  it("anchors the END for FF and counts the start backwards", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "ff", 0)],
      datedScheduleById: new Map([["a", schedule(0, 10)]]),
      undatedCandidateIds: ["b"],
      estimateMinutesById: estimates({ b: 3 * WORK_DAY }),
    });

    expect(derived.get("b")).toEqual({ start: day(8), end: day(10) });
  });

  it("anchors the END for SF on the predecessor's start", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "sf", 0)],
      datedScheduleById: new Map([["a", schedule(10, 20)]]),
      undatedCandidateIds: ["b"],
      estimateMinutesById: estimates({ b: 2 * WORK_DAY }),
    });

    expect(derived.get("b")).toEqual({ start: day(9), end: day(10) });
  });

  it("counts FF backwards over working days only", () => {
    const derived = deriveUndatedSuccessorSchedules({
      // Predecessor ends Tuesday 2026-01-06 (day 5): three working days back
      // from it are Tue, Mon and Fri 2026-01-02 (day 1).
      edges: [edge("a", "b", "ff", 0)],
      datedScheduleById: new Map([["a", schedule(0, 5)]]),
      undatedCandidateIds: ["b"],
      isWorkingDay: MON_FRI,
      estimateMinutesById: estimates({ b: 3 * WORK_DAY }),
    });

    expect(derived.get("b")).toEqual({ start: day(1), end: day(5) });
  });

  it("lets the latest constraint win across a start and an end edge", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 0), edge("c", "b", "ff", 0)],
      datedScheduleById: new Map([
        ["a", schedule(0, 4)],
        ["c", schedule(0, 20)],
      ]),
      undatedCandidateIds: ["b"],
      estimateMinutesById: estimates({ b: 3 * WORK_DAY }),
    });

    // The FF edge needs the end on day 20, so the start is day 18, later than
    // the FS edge's day 4.
    expect(derived.get("b")).toEqual({ start: day(18), end: day(20) });
  });

  it("chains through a derived task that has an estimate", () => {
    const derived = deriveUndatedSuccessorSchedules({
      // Listed out of dependency order on purpose.
      edges: [edge("b", "c", "fs", 0), edge("a", "b", "fs", 0)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: ["c", "b"],
      estimateMinutesById: estimates({ b: 2 * WORK_DAY, c: 3 * WORK_DAY }),
    });

    expect(derived.get("b")).toEqual({ start: day(5), end: day(6) });
    expect(derived.get("c")).toEqual({ start: day(7), end: day(9) });
  });

  it("places a chained task without an estimate as a marker on a sized predecessor", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 0), edge("b", "c", "fs", 0)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: ["b", "c"],
      estimateMinutesById: estimates({ b: 2 * WORK_DAY }),
    });

    expect(derived.get("c")).toEqual({ start: day(7), end: day(7) });
  });

  it("chains a diamond in dependency order, taking the later branch", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")],
      datedScheduleById: new Map([["a", schedule(0, 0)]]),
      undatedCandidateIds: ["d", "c", "b"],
      estimateMinutesById: estimates({
        b: 2 * WORK_DAY,
        c: 5 * WORK_DAY,
        d: WORK_DAY,
      }),
    });

    expect(derived.get("b")).toEqual({ start: day(1), end: day(2) });
    expect(derived.get("c")).toEqual({ start: day(1), end: day(5) });
    expect(derived.get("d")).toEqual({ start: day(6), end: day(6) });
  });

  it("leaves tasks on a cycle unplaced without looping", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b"), edge("b", "c"), edge("c", "b"), edge("a", "d")],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: ["b", "c", "d"],
      estimateMinutesById: estimates({
        b: WORK_DAY,
        c: WORK_DAY,
        d: WORK_DAY,
      }),
    });

    expect(derived.has("b")).toBe(false);
    expect(derived.has("c")).toBe(false);
    // A task outside the cycle is still placed.
    expect(derived.get("d")).toEqual({ start: day(5), end: day(5) });
  });

  it("never overrides a task that has its own dates", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 0)],
      datedScheduleById: new Map([
        ["a", schedule(0, 4)],
        ["b", schedule(20, 22)],
      ]),
      undatedCandidateIds: ["b"],
      estimateMinutesById: estimates({ b: 5 * WORK_DAY }),
    });

    expect(derived.size).toBe(0);
  });
});

describe("deriveUndatedSuccessorSchedules finish-to-start hand-off", () => {
  it("starts an undated 3-day successor the working day after a predecessor that ends Thu 5 Nov 2026", () => {
    // Reproduces the cross-project report: the predecessor ends Thu 5 Nov, FS
    // lag 0, the successor has no dates and a 3-day (1440 min) estimate.
    const utcDay = (m: number, d: number) => new Date(Date.UTC(2026, m, d));
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("dc1", "sof2", "fs", 0)],
      datedScheduleById: new Map([
        ["dc1", { start: utcDay(9, 8), end: utcDay(10, 5) }],
      ]),
      undatedCandidateIds: ["sof2"],
      isWorkingDay: MON_FRI,
      estimateMinutesById: estimates({ sof2: 1440 }),
    });

    // Fri 6 Nov, Mon 9 Nov, Tue 10 Nov: no overlap with the predecessor's day.
    expect(derived.get("sof2")).toEqual({
      start: utcDay(10, 6),
      end: utcDay(10, 10),
    });
  });
});

describe("deriveUndatedSuccessorSchedules anchored on an estimated single-date task", () => {
  it("places a successor after the span an estimate gives a start-only task", () => {
    // B has only a start (Thu Oct 8) and a 3-day estimate: Thu-Mon. The caller
    // feeds that derived span in as B's dated schedule, so the undated C is
    // placed from B's computed end, not from its one-day marker.
    const monFri = (date: Date) => date.getDay() >= 1 && date.getDay() <= 5;
    const bSpan = deriveTaskScheduleWithEstimate(
      {
        startDate: "2026-10-08",
        dueDate: null,
        estimateMinutes: 3 * 8 * 60,
      },
      monFri,
    );
    if (!bSpan) throw new Error("expected a derived span");
    expect(bSpan.end.getDate()).toBe(12);

    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("b", "c", "fs", 0)],
      datedScheduleById: new Map([["b", bSpan]]),
      undatedCandidateIds: ["c"],
      isWorkingDay: monFri,
    });

    // FS: the day after B's computed end (Mon 12 Oct) is Tue 13 Oct.
    expect(derived.get("c")?.start.getDate()).toBe(13);
  });
});
