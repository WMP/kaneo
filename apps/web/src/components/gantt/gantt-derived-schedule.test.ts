import { describe, expect, it } from "vitest";
import type { CascadeEdge } from "./gantt-dependency-cascade";
import {
  type DerivedScheduleSource,
  deriveUndatedSuccessorSchedules,
} from "./gantt-derived-schedule";

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
  it("places an undated FS successor at predecessor.end (zero-duration point)", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 0)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: ["b"],
    });

    // FS, no lag: B sits on A's end day, as a single-day marker.
    expect(derived.get("b")).toEqual({ start: day(4), end: day(4) });
  });

  it("applies positive lag and negative lead to the FS anchor", () => {
    const withLag = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 3)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: ["b"],
    });
    expect(withLag.get("b")).toEqual({ start: day(7), end: day(7) });

    const withLead = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", -2)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: ["b"],
    });
    expect(withLead.get("b")).toEqual({ start: day(2), end: day(2) });
  });

  it("anchors SS/SF on predecessor.start and FS/FF on predecessor.end", () => {
    const dated = new Map([["a", schedule(2, 9)]]);

    const fs = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 0)],
      datedScheduleById: dated,
      undatedCandidateIds: ["b"],
    });
    expect(fs.get("b")).toEqual({ start: day(9), end: day(9) });

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
    expect(derived.get("b")).toEqual({ start: day(10), end: day(10) });
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

  it("does not chain through an undated predecessor", () => {
    // a (dated) blocks b (undated) blocks c (undated). b gets a derived point,
    // but c must NOT — its only predecessor b has no REAL schedule, and this
    // pass deliberately never chains through a derived one.
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("a", "b", "fs", 0), edge("b", "c", "fs", 0)],
      datedScheduleById: new Map([["a", schedule(0, 4)]]),
      undatedCandidateIds: ["b", "c"],
    });
    expect(derived.get("b")).toEqual({ start: day(4), end: day(4) });
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
    // successor with +1 lag (landing on day 5) is nudged forward to day 7.
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
    // Lands on day 5 and stays there — no calendar means no nudge.
    expect(derived.get("b")).toEqual({ start: day(5), end: day(5) });
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
