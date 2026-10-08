import { describe, expect, it } from "vitest";
import type { DependencyEdgeInput } from "./dependency-lines";
import {
  buildNeighborhoodScale,
  buildTaskNeighborhood,
  isNeighborhoodZoom,
  MIN_PIXELS_PER_DAY,
  type NeighborhoodSchedule,
  stepNeighborhoodZoom,
  UNIT_PIXELS_PER_DAY,
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
      // Disable the minimum to exercise the tick steps of a fully fitted year.
      { minTickSpacingPx: 64, minPixelsPerDay: 0 },
    );
    const gapDays =
      (long.ticks[1].day.getTime() - long.ticks[0].day.getTime()) /
      (24 * 60 * 60 * 1000);
    expect(gapDays).toBeGreaterThanOrEqual(28);
    for (let i = 1; i < long.ticks.length; i++) {
      expect(long.ticks[i].x - long.ticks[i - 1].x).toBeGreaterThanOrEqual(64);
    }
  });

  it("keeps the fit-to-width scale when the range already fits", () => {
    const scale = buildNeighborhoodScale(
      { start: day("2026-03-10"), end: day("2026-03-14") },
      800,
    );
    expect(800 / scale.totalDays).toBeGreaterThan(MIN_PIXELS_PER_DAY);
    expect(scale.pixelsPerDay).toBeCloseTo(800 / scale.totalDays);
    expect(scale.widthPx).toBeCloseTo(800);
  });

  it("never goes below the minimum px per day and overflows a long range", () => {
    const scale = buildNeighborhoodScale(
      { start: day("2026-01-01"), end: day("2026-12-31") },
      600,
    );
    expect(scale.pixelsPerDay).toBe(MIN_PIXELS_PER_DAY);
    expect(scale.widthPx).toBe(scale.totalDays * MIN_PIXELS_PER_DAY);
    expect(scale.widthPx).toBeGreaterThan(600);
    expect(scale.offsetOf(day("2026-12-31"))).toBeGreaterThan(600);
    for (let i = 1; i < scale.ticks.length; i++) {
      expect(scale.ticks[i].x - scale.ticks[i - 1].x).toBeGreaterThanOrEqual(
        64,
      );
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

describe("buildNeighborhoodScale with a fixed unit", () => {
  const range = { start: day("2026-03-10"), end: day("2026-09-20") };
  const labels = (zoom: "day" | "week" | "month" | "quarter") =>
    buildNeighborhoodScale(range, 600, { zoom }).ticks.map(
      (tick) => tick.label,
    );

  it("uses each unit's fixed px per day instead of fitting the width", () => {
    for (const zoom of ["day", "week", "month", "quarter"] as const) {
      const scale = buildNeighborhoodScale(range, 600, { zoom });
      expect(scale.zoom).toBe(zoom);
      expect(scale.pixelsPerDay).toBe(UNIT_PIXELS_PER_DAY[zoom]);
      expect(scale.widthPx).toBeCloseTo(scale.totalDays * scale.pixelsPerDay);
    }
    expect(UNIT_PIXELS_PER_DAY.day).toBeGreaterThan(UNIT_PIXELS_PER_DAY.week);
    expect(UNIT_PIXELS_PER_DAY.week).toBeGreaterThan(UNIT_PIXELS_PER_DAY.month);
    expect(UNIT_PIXELS_PER_DAY.month).toBeGreaterThan(
      UNIT_PIXELS_PER_DAY.quarter,
    );
  });

  it("changes the pixels per day and the ticks when the unit changes", () => {
    const fit = buildNeighborhoodScale(range, 600);
    const day44 = buildNeighborhoodScale(range, 600, { zoom: "day" });
    const month = buildNeighborhoodScale(range, 600, { zoom: "month" });
    expect(day44.pixelsPerDay).not.toBe(fit.pixelsPerDay);
    expect(month.pixelsPerDay).not.toBe(day44.pixelsPerDay);
    // One tick per day, per month and per quarter respectively.
    expect(day44.ticks).toHaveLength(day44.totalDays);
    expect(month.ticks.length).toBeLessThan(15);
    const quarter = buildNeighborhoodScale(range, 600, { zoom: "quarter" });
    // A quarter tick is a whole quarter apart; the first one is the partial
    // quarter the padded range starts in.
    expect(quarter.ticks[0].label).toBe("Q1 2026");
    expect(quarter.ticks[2].x - quarter.ticks[1].x).toBeGreaterThan(
      month.ticks[2].x - month.ticks[1].x,
    );
  });

  it("labels the ticks like the main Gantt header", () => {
    expect(labels("month")).toContain("Apr 2026");
    expect(labels("quarter")).toEqual(
      expect.arrayContaining(["Q1 2026", "Q2 2026", "Q3 2026"]),
    );
    // A week column is labelled by its first day (Sunday by default).
    expect(labels("week")[1]).toBe("Mar 15");
    expect(
      buildNeighborhoodScale(range, 600, { zoom: "week", weekStartsOn: 1 })
        .ticks[1].label,
    ).toBe("Mar 16");
  });

  it("puts ticks at the unit boundaries at the unit's offsets", () => {
    const scale = buildNeighborhoodScale(range, 600, { zoom: "month" });
    const april = scale.ticks.find((tick) => tick.label === "Apr 2026");
    expect(april?.day).toEqual(day("2026-04-01"));
    expect(april?.x).toBeCloseTo(scale.offsetOf(day("2026-04-01")));
  });

  it("keeps drawing grid to the card's edge when the unit is narrower than it", () => {
    const short = { start: day("2026-03-10"), end: day("2026-03-14") };
    const scale = buildNeighborhoodScale(short, 800, { zoom: "quarter" });
    expect(scale.widthPx).toBeGreaterThanOrEqual(800);
  });

  it("does not change bar offsets between scales except by their px per day", () => {
    const a = buildNeighborhoodScale(range, 600, { zoom: "day" });
    const b = buildNeighborhoodScale(range, 600, { zoom: "week" });
    const d = day("2026-05-01");
    expect(a.offsetOf(d) / a.pixelsPerDay).toBeCloseTo(
      b.offsetOf(d) / b.pixelsPerDay,
    );
  });
});

describe("stepNeighborhoodZoom", () => {
  it("steps between the scales ordered by px per day and clamps at the ends", () => {
    // A fit scale of 20 px/day sits between week (13.12) and day (44).
    expect(stepNeighborhoodZoom("quarter", 1, 20)).toBe("month");
    expect(stepNeighborhoodZoom("week", 1, 20)).toBe("fit");
    expect(stepNeighborhoodZoom("fit", 1, 20)).toBe("day");
    expect(stepNeighborhoodZoom("day", 1, 20)).toBe("day");
    expect(stepNeighborhoodZoom("day", -1, 20)).toBe("fit");
    expect(stepNeighborhoodZoom("quarter", -1, 20)).toBe("quarter");
  });
});

describe("isNeighborhoodZoom", () => {
  it("accepts fit and the four units only", () => {
    for (const value of ["fit", "day", "week", "month", "quarter"]) {
      expect(isNeighborhoodZoom(value)).toBe(true);
    }
    for (const value of ["year", "", null, undefined, 3]) {
      expect(isNeighborhoodZoom(value)).toBe(false);
    }
  });
});
