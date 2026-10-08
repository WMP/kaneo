import { describe, expect, it } from "vitest";
import type { DependencyEdgeInput } from "./dependency-lines";
import {
  buildNeighborhoodScale,
  buildTaskNeighborhood,
  type NeighborhoodSchedule,
} from "./gantt-task-neighborhood";

const day = (value: string) => new Date(`${value}T00:00:00`);
const span = (start: string, end: string): NeighborhoodSchedule => ({
  start: day(start),
  end: day(end),
});

function edge(
  id: string,
  sourceTaskId: string,
  targetTaskId: string,
  relationType: "blocks" | "related" = "blocks",
): DependencyEdgeInput {
  return { id, sourceTaskId, targetTaskId, relationType };
}

describe("buildTaskNeighborhood", () => {
  it("orders predecessors by start, then the focus task, then successors by start", () => {
    const result = buildTaskNeighborhood({
      focusTaskId: "focus",
      edges: [
        edge("e1", "late-pred", "focus"),
        edge("e2", "early-pred", "focus"),
        edge("e3", "focus", "late-succ"),
        edge("e4", "focus", "early-succ"),
      ],
      scheduleByTaskId: new Map([
        ["late-pred", span("2026-03-05", "2026-03-06")],
        ["early-pred", span("2026-03-01", "2026-03-02")],
        ["focus", span("2026-03-08", "2026-03-10")],
        ["late-succ", span("2026-03-20", "2026-03-22")],
        ["early-succ", span("2026-03-12", "2026-03-13")],
      ]),
    });

    expect(result.rows.map((row) => [row.taskId, row.role])).toEqual([
      ["early-pred", "predecessor"],
      ["late-pred", "predecessor"],
      ["focus", "focus"],
      ["early-succ", "successor"],
      ["late-succ", "successor"],
    ]);
    expect(result.neighborCount).toBe(4);
    expect(result.range).toEqual({
      start: day("2026-03-01"),
      end: day("2026-03-22"),
    });
  });

  it("gives a task that is both predecessor and successor a single predecessor row", () => {
    const result = buildTaskNeighborhood({
      focusTaskId: "focus",
      edges: [
        edge("e1", "both", "focus", "blocks"),
        edge("e2", "focus", "both", "related"),
      ],
      scheduleByTaskId: new Map(),
    });

    expect(result.rows.map((row) => [row.taskId, row.role])).toEqual([
      ["both", "predecessor"],
      ["focus", "focus"],
    ]);
    expect(result.neighborCount).toBe(1);
    // Both relations between the two tasks are kept as edges.
    expect(result.edges.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("treats blocks and related relations alike and keeps each edge's type", () => {
    const result = buildTaskNeighborhood({
      focusTaskId: "focus",
      edges: [
        edge("e1", "a", "focus", "blocks"),
        edge("e2", "b", "focus", "related"),
        edge("e3", "focus", "c", "related"),
      ],
      scheduleByTaskId: new Map(),
    });

    expect(result.rows.map((row) => row.taskId).sort()).toEqual([
      "a",
      "b",
      "c",
      "focus",
    ]);
    expect(result.edges.map((e) => [e.id, e.relationType])).toEqual([
      ["e1", "blocks"],
      ["e2", "related"],
      ["e3", "related"],
    ]);
  });

  it("keeps edges among neighbors but leaves out relations that do not touch the neighborhood", () => {
    const result = buildTaskNeighborhood({
      focusTaskId: "focus",
      edges: [
        edge("e1", "pred", "focus"),
        edge("e2", "focus", "succ"),
        edge("e3", "pred", "succ"),
        edge("e4", "succ", "second-hop"),
        edge("e5", "unrelated-a", "unrelated-b"),
      ],
      scheduleByTaskId: new Map(),
    });

    expect(result.edges.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(result.rows.map((row) => row.taskId)).not.toContain("second-hop");
  });

  it("de-duplicates repeated edge ids and ignores self relations", () => {
    const result = buildTaskNeighborhood({
      focusTaskId: "focus",
      edges: [
        edge("e1", "pred", "focus"),
        edge("e1", "pred", "focus"),
        edge("self", "focus", "focus"),
      ],
      scheduleByTaskId: new Map(),
    });

    expect(result.edges.map((e) => e.id)).toEqual(["e1"]);
    expect(result.neighborCount).toBe(1);
  });

  it("lists an undated neighbor last in its group, without a schedule or range contribution", () => {
    const result = buildTaskNeighborhood({
      focusTaskId: "focus",
      edges: [
        edge("e1", "undated", "focus"),
        edge("e2", "dated", "focus"),
        edge("e3", "focus", "undated-succ"),
      ],
      scheduleByTaskId: new Map([
        ["dated", span("2026-03-02", "2026-03-03")],
        ["focus", span("2026-03-04", "2026-03-05")],
      ]),
    });

    expect(result.rows.map((row) => row.taskId)).toEqual([
      "dated",
      "undated",
      "focus",
      "undated-succ",
    ]);
    expect(
      result.rows.find((r) => r.taskId === "undated")?.schedule,
    ).toBeNull();
    expect(result.range).toEqual({
      start: day("2026-03-02"),
      end: day("2026-03-05"),
    });
  });

  it("returns only the focus row and no range for a task with no relations and no dates", () => {
    const result = buildTaskNeighborhood({
      focusTaskId: "focus",
      edges: [edge("e1", "x", "y")],
      scheduleByTaskId: new Map(),
    });

    expect(result.rows).toEqual([
      { taskId: "focus", role: "focus", schedule: null },
    ]);
    expect(result.edges).toEqual([]);
    expect(result.range).toBeNull();
    expect(result.neighborCount).toBe(0);
  });

  it("does not depend on the arrival order of equally dated neighbors", () => {
    const schedules = new Map([
      ["a", span("2026-03-01", "2026-03-02")],
      ["b", span("2026-03-01", "2026-03-02")],
    ]);
    const first = buildTaskNeighborhood({
      focusTaskId: "focus",
      edges: [edge("e1", "b", "focus"), edge("e2", "a", "focus")],
      scheduleByTaskId: schedules,
    });
    const second = buildTaskNeighborhood({
      focusTaskId: "focus",
      edges: [edge("e2", "a", "focus"), edge("e1", "b", "focus")],
      scheduleByTaskId: schedules,
    });
    expect(first.rows.map((r) => r.taskId)).toEqual(
      second.rows.map((r) => r.taskId),
    );
  });
});

describe("buildNeighborhoodScale", () => {
  it("fits the range with a day of padding on each side", () => {
    const scale = buildNeighborhoodScale(
      { start: day("2026-03-10"), end: day("2026-03-14") },
      800,
    );
    expect(scale.start).toEqual(day("2026-03-09"));
    expect(scale.totalDays).toBe(7);
    expect(scale.pixelsPerDay).toBeCloseTo(800 / 7);
    expect(scale.offsetOf(day("2026-03-10"))).toBeCloseTo(800 / 7);
    // The last day's right edge stays inside the width.
    expect(scale.offsetOf(day("2026-03-15"))).toBeLessThan(800);
  });

  it("labels every day for a short span and coarser steps for a long one", () => {
    const short = buildNeighborhoodScale(
      { start: day("2026-03-10"), end: day("2026-03-14") },
      800,
    );
    expect(short.ticks[1].day.getTime() - short.ticks[0].day.getTime()).toBe(
      24 * 60 * 60 * 1000,
    );

    const long = buildNeighborhoodScale(
      { start: day("2026-01-01"), end: day("2026-12-31") },
      600,
    );
    const gapDays =
      (long.ticks[1].day.getTime() - long.ticks[0].day.getTime()) /
      (24 * 60 * 60 * 1000);
    expect(gapDays).toBeGreaterThanOrEqual(28);
    for (let i = 1; i < long.ticks.length; i++) {
      expect(long.ticks[i].x - long.ticks[i - 1].x).toBeGreaterThanOrEqual(64);
    }
  });

  it("handles a single-day range", () => {
    const scale = buildNeighborhoodScale(
      { start: day("2026-03-10"), end: day("2026-03-10") },
      300,
    );
    expect(scale.totalDays).toBe(3);
    expect(scale.ticks.length).toBeGreaterThan(0);
  });
});
