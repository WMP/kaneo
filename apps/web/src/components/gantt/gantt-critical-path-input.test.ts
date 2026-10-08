import { describe, expect, it } from "vitest";
import {
  type CriticalPathEdgeInput,
  computeCriticalPath,
} from "./gantt-critical-path";
import {
  buildCriticalPathInput,
  isCriticalPathProjected,
} from "./gantt-critical-path-input";
import { deriveUndatedSuccessorSchedules } from "./gantt-derived-schedule";

function day(n: number): Date {
  return new Date(Date.UTC(2026, 0, 1 + n));
}

function fs(
  id: string,
  sourceTaskId: string,
  targetTaskId: string,
): CriticalPathEdgeInput {
  return { id, sourceTaskId, targetTaskId, dependencyType: "fs", lagDays: 0 };
}

// Mirrors what the Gantt route does: derive the display position of the undated
// tasks, expose them as external rows and assemble the CPM input from both.
function project({
  dated,
  undated,
  edges,
  farEnds = [],
}: {
  dated: Record<string, [number, number]>;
  undated: Record<string, number | null>;
  edges: CriticalPathEdgeInput[];
  farEnds?: { id: string; start: number; end: number }[];
}) {
  const ownSchedules = new Map(
    Object.entries(dated).map(([id, [start, end]]) => [
      id,
      { start: day(start), end: day(end) },
    ]),
  );
  const datedScheduleById = new Map(ownSchedules);
  for (const far of farEnds) {
    datedScheduleById.set(far.id, { start: day(far.start), end: day(far.end) });
  }
  const derived = deriveUndatedSuccessorSchedules({
    edges,
    datedScheduleById,
    undatedCandidateIds: Object.keys(undated),
    estimateMinutesById: new Map(Object.entries(undated)),
  });
  const externalRows = [
    ...farEnds.map((far) => ({
      id: far.id,
      scheduleStart: day(far.start),
      scheduleEnd: day(far.end),
      isDerived: false,
    })),
    ...[...derived].map(([id, schedule]) => ({
      id,
      scheduleStart: schedule.start,
      scheduleEnd: schedule.end,
      isDerived: true,
    })),
  ];
  const input = buildCriticalPathInput({ ownSchedules, externalRows, edges });
  return {
    derived,
    input,
    result: computeCriticalPath(input.tasks, edges),
  };
}

describe("buildCriticalPathInput", () => {
  it("makes a chain dated A -> derived B (estimate) -> derived C critical end to end", () => {
    const edges = [fs("a-b", "A", "B"), fs("b-c", "B", "C")];
    const { derived, input, result } = project({
      dated: { A: [0, 4] },
      // B has a 2-day estimate, C a 1-day estimate.
      undated: { B: 960, C: 480 },
      edges,
    });

    expect(derived.get("B")).toEqual({ start: day(5), end: day(6) });
    expect(derived.get("C")).toEqual({ start: day(7), end: day(7) });
    expect([...input.derivedTaskIds].sort()).toEqual(["B", "C"]);
    expect([...result.criticalTaskIds].sort()).toEqual(["A", "B", "C"]);
    expect([...result.criticalEdgeIds].sort()).toEqual(["a-b", "b-c"]);
    expect(result.droppedEdgeCount).toBe(0);
    expect(isCriticalPathProjected(result, input.derivedTaskIds)).toBe(true);
  });

  it("still drops an edge whose endpoint cannot be placed (no dates, no dated predecessor)", () => {
    // U has no dates and no predecessor, so it cannot be derived; the edge
    // from it into the dated chain is dropped and counted.
    const edges = [fs("a-b", "A", "B"), fs("u-a", "U", "A")];
    const { input, result } = project({
      dated: { A: [0, 4] },
      undated: { B: 480, U: 480 },
      edges,
    });

    expect(input.tasks.map((task) => task.id).sort()).toEqual(["A", "B"]);
    expect(result.droppedEdgeCount).toBe(1);
    expect([...result.criticalTaskIds].sort()).toEqual(["A", "B"]);
  });

  it("keeps a derived marker without an estimate out of further chaining and counts that edge as dropped", () => {
    const edges = [fs("a-b", "A", "B"), fs("b-c", "B", "C")];
    const { input, result } = project({
      dated: { A: [0, 4] },
      undated: { B: null, C: 480 },
      edges,
    });

    expect(input.tasks.map((task) => task.id).sort()).toEqual(["A", "B"]);
    expect(result.droppedEdgeCount).toBe(1);
  });

  it("leaves a dated-only network unchanged and reports it as not projected", () => {
    const edges = [fs("a-b", "A", "B")];
    const { input, result } = project({
      dated: { A: [0, 4], B: [5, 6] },
      undated: {},
      edges,
    });

    expect(input.derivedTaskIds.size).toBe(0);
    expect([...result.criticalTaskIds].sort()).toEqual(["A", "B"]);
    expect(isCriticalPathProjected(result, input.derivedTaskIds)).toBe(false);
  });

  it("does not call the path projected when a derived row is off the critical path", () => {
    // A -> B is the long chain; A -> D is a short derived branch into the
    // shared sink B2 (dated well after D), so D has slack.
    const edges = [
      fs("a-b", "A", "B"),
      fs("a-d", "A", "D"),
      fs("d-b", "D", "B"),
    ];
    const { input, result } = project({
      dated: { A: [0, 4], B: [20, 22] },
      undated: { D: 480 },
      edges,
    });

    expect(result.criticalTaskIds.has("D")).toBe(false);
    expect(isCriticalPathProjected(result, input.derivedTaskIds)).toBe(false);
  });

  it("admits a dated far end whose only counterpart is a derived row", () => {
    // F (another project, dated) blocks the own undated D; D is derived from F.
    const edges = [fs("f-d", "F", "D")];
    const { input, result } = project({
      dated: {},
      undated: { D: 480 },
      edges,
      farEnds: [{ id: "F", start: 0, end: 4 }],
    });

    expect(input.tasks.map((task) => task.id).sort()).toEqual(["D", "F"]);
    expect([...input.derivedTaskIds]).toEqual(["D"]);
    expect([...result.criticalTaskIds].sort()).toEqual(["D", "F"]);
    expect(result.droppedEdgeCount).toBe(0);
  });

  it("leaves out a far end or derived row that no blocks edge connects to a participant", () => {
    const input = buildCriticalPathInput({
      ownSchedules: new Map([["A", { start: day(0), end: day(4) }]]),
      externalRows: [
        // A "related"-only far end: no blocks edge touches it.
        { id: "R", scheduleStart: day(1), scheduleEnd: day(2) },
        // A derived row whose only anchor is not in the input (e.g. archived).
        {
          id: "D",
          scheduleStart: day(8),
          scheduleEnd: day(8),
          isDerived: true,
        },
      ],
      edges: [fs("x-d", "ARCHIVED", "D")],
    });

    expect(input.tasks.map((task) => task.id)).toEqual(["A"]);
    expect(input.derivedTaskIds.size).toBe(0);
  });

  it("keeps an own dated task's real schedule when an external row repeats its id", () => {
    const input = buildCriticalPathInput({
      ownSchedules: new Map([["A", { start: day(0), end: day(4) }]]),
      externalRows: [
        {
          id: "A",
          scheduleStart: day(9),
          scheduleEnd: day(9),
          isDerived: true,
        },
      ],
      edges: [],
    });

    expect(input.tasks).toEqual([
      { id: "A", scheduleStart: day(0), scheduleEnd: day(4) },
    ]);
    expect(input.derivedTaskIds.size).toBe(0);
  });
});
