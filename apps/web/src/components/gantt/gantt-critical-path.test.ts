import { describe, expect, it } from "vitest";
import {
  type CriticalPathEdgeInput,
  type CriticalPathTaskInput,
  computeCriticalPath,
} from "./gantt-critical-path";
import {
  DEFAULT_WORKING_DAYS,
  makeWorkingDayIndexer,
} from "./gantt-working-calendar";

function day(n: number): Date {
  // Whole UTC days from a fixed epoch, so spans/deltas are easy to reason
  // about in each test without pulling in date-fns just for arithmetic.
  return new Date(Date.UTC(2026, 0, 1 + n));
}

function task(id: string, start: number, end: number): CriticalPathTaskInput {
  return { id, scheduleStart: day(start), scheduleEnd: day(end) };
}

function blocks(
  id: string,
  sourceTaskId: string,
  targetTaskId: string,
  dependencyType: CriticalPathEdgeInput["dependencyType"] = "fs",
  lagDays = 0,
): CriticalPathEdgeInput {
  return { id, sourceTaskId, targetTaskId, dependencyType, lagDays };
}

describe("computeCriticalPath", () => {
  it("marks every task and edge critical along a tight simple chain", () => {
    // A(0-2) -FS,0-> B(3-6) -FS,0-> C(7-10): each task starts the day AFTER its
    // predecessor finishes (an FS hand-off is tight at finish+1, not the same
    // day), so there is no slack anywhere on the chain.
    const tasks = [task("a", 0, 2), task("b", 3, 6), task("c", 7, 10)];
    const edges = [blocks("e1", "a", "b"), blocks("e2", "b", "c")];

    const result = computeCriticalPath(tasks, edges);

    expect(result.criticalTaskIds).toEqual(new Set(["a", "b", "c"]));
    expect(result.criticalEdgeIds).toEqual(new Set(["e1", "e2"]));
  });

  it("only marks the longer branch critical in a diamond with one slack branch", () => {
    // A(0-2) forks into B(2-6, 4-day) and C(2-3, 1-day), both FS into
    // D(6-8) — D's own dates are tight against the LONGER branch (B), so B
    // finishing exactly when D starts is critical, while C arrives 3 days
    // early and carries that much slack.
    const tasks = [
      task("a", 0, 2),
      task("b", 2, 6),
      task("c", 2, 3),
      task("d", 6, 8),
    ];
    const edges = [
      blocks("ab", "a", "b"),
      blocks("ac", "a", "c"),
      blocks("bd", "b", "d"),
      blocks("cd", "c", "d"),
    ];

    const result = computeCriticalPath(tasks, edges);

    expect(result.criticalTaskIds).toEqual(new Set(["a", "b", "d"]));
    expect(result.criticalTaskIds.has("c")).toBe(false);
    expect(result.criticalEdgeIds).toEqual(new Set(["ab", "bd"]));
    expect(result.criticalEdgeIds.has("ac")).toBe(false);
    expect(result.criticalEdgeIds.has("cd")).toBe(false);
  });

  it("never marks parallel independent tasks (no edges) critical", () => {
    // No edges at all: each task has zero slack by construction, but with no
    // dependency network there is no chain to be the tight part of, so none
    // is highlighted — highlighting every unconnected task would just be noise.
    const tasks = [task("a", 0, 3), task("b", 10, 12), task("c", 5, 5)];

    const result = computeCriticalPath(tasks, []);

    expect(result.criticalTaskIds.size).toBe(0);
    expect(result.criticalEdgeIds.size).toBe(0);
  });

  it("never marks a lone task with no dependencies critical", () => {
    const result = computeCriticalPath([task("solo", 3, 9)], []);

    expect(result.criticalTaskIds.size).toBe(0);
    expect(result.criticalEdgeIds.size).toBe(0);
  });

  it("excludes a lone task even alongside a real critical chain", () => {
    // A(0-2) -FS,0-> B(2-5) is a tight chain; "solo" has no edge at all and
    // must stay off the highlight while the chain lights up.
    const tasks = [task("a", 0, 2), task("b", 2, 5), task("solo", 8, 12)];
    const edges = [blocks("e1", "a", "b")];

    const result = computeCriticalPath(tasks, edges);

    expect(result.criticalTaskIds).toEqual(new Set(["a", "b"]));
    expect(result.criticalTaskIds.has("solo")).toBe(false);
  });

  it("a positive lag that exactly matches the gap keeps the link critical", () => {
    // A(0-2) -FS,+3-> B: required start is A.end(2)+3 lag +1 hand-off = 6, and
    // B is dated (6-9) to match exactly — zero slack.
    const tasks = [task("a", 0, 2), task("b", 6, 9)];
    const edges = [blocks("e1", "a", "b", "fs", 3)];

    const result = computeCriticalPath(tasks, edges);

    expect(result.criticalTaskIds).toEqual(new Set(["a", "b"]));
    expect(result.criticalEdgeIds).toEqual(new Set(["e1"]));
  });

  it("the same lag introduces slack once the target's own dates sit later", () => {
    // Same FS,+3 lag (required start still 6), but B is actually dated
    // starting on day 8 — 2 days later than the network requires, so both
    // ends of the link carry 2 days of slack and neither is critical.
    const tasks = [task("a", 0, 2), task("b", 8, 11)];
    const edges = [blocks("e1", "a", "b", "fs", 3)];

    const result = computeCriticalPath(tasks, edges);

    expect(result.criticalTaskIds.size).toBe(0);
    expect(result.criticalEdgeIds.size).toBe(0);
  });

  it("an FS hand-off to the next calendar day is tight (default day index)", () => {
    // A(0-2) -FS,0-> B(3-6): B starts the day after A finishes -> tight.
    const tight = computeCriticalPath(
      [task("a", 0, 2), task("b", 3, 6)],
      [blocks("e1", "a", "b")],
    );
    expect(tight.criticalTaskIds).toEqual(new Set(["a", "b"]));
    expect(tight.criticalEdgeIds).toEqual(new Set(["e1"]));

    // A(0-2) -FS,0-> B(5-8): a whole idle day (day 4) between -> slack, so
    // neither end is critical.
    const slack = computeCriticalPath(
      [task("a", 0, 2), task("b", 5, 8)],
      [blocks("e1", "a", "b")],
    );
    expect(slack.criticalTaskIds.size).toBe(0);
    expect(slack.criticalEdgeIds.size).toBe(0);
  });

  describe("working-day slack (toDayIndex)", () => {
    // Local-time dates so the working-calendar indexer's weekday math matches
    // regardless of the test runner's time zone. Jan 2026: 1=Thu, 2=Fri,
    // 3=Sat, 4=Sun, 5=Mon, 6=Tue, 7=Wed. Mon-Fri working, no holidays.
    const d = (dayOfMonth: number) => new Date(2026, 0, dayOfMonth);
    const indexer = () =>
      makeWorkingDayIndexer(d(1), DEFAULT_WORKING_DAYS, new Set());

    it("treats a Friday->Monday hand-off across the weekend as tight", () => {
      // A ends Fri (Jan 2), B starts the next working day Mon (Jan 5): no
      // working day sits idle between them, so the link is tight even though
      // three calendar days pass.
      const tasks = [
        { id: "a", scheduleStart: d(1), scheduleEnd: d(2) },
        { id: "b", scheduleStart: d(5), scheduleEnd: d(6) },
      ];
      const result = computeCriticalPath(tasks, [blocks("e1", "a", "b")], {
        toDayIndex: indexer(),
      });
      expect(result.criticalTaskIds).toEqual(new Set(["a", "b"]));
      expect(result.criticalEdgeIds).toEqual(new Set(["e1"]));
    });

    it("does not mark a hand-off with an idle working day as critical", () => {
      // A ends Fri (Jan 2), B starts Tue (Jan 6): Monday is a working day left
      // idle, so the link carries a real working day of slack.
      const tasks = [
        { id: "a", scheduleStart: d(1), scheduleEnd: d(2) },
        { id: "b", scheduleStart: d(6), scheduleEnd: d(7) },
      ];
      const result = computeCriticalPath(tasks, [blocks("e1", "a", "b")], {
        toDayIndex: indexer(),
      });
      expect(result.criticalTaskIds.size).toBe(0);
      expect(result.criticalEdgeIds.size).toBe(0);
    });
  });

  it("honors SS (start-to-start) with lag", () => {
    // A(0-3) -SS,+1-> B: B's earliest start is A.start(0)+1=1; B is dated
    // (1-4) to match exactly.
    const tasks = [task("a", 0, 3), task("b", 1, 4)];
    const edges = [blocks("e1", "a", "b", "ss", 1)];

    const result = computeCriticalPath(tasks, edges);

    expect(result.criticalTaskIds).toEqual(new Set(["a", "b"]));
    expect(result.criticalEdgeIds).toEqual(new Set(["e1"]));
  });

  it("honors FF (finish-to-finish) with lag", () => {
    // A(0-5, duration 5) -FF,0-> B (duration 2): B's earliest finish is
    // A.end(5)+0=5, so B's earliest start is 5-2=3; B is dated (3-5) to
    // match exactly.
    const tasks = [task("a", 0, 5), task("b", 3, 5)];
    const edges = [blocks("e1", "a", "b", "ff", 0)];

    const result = computeCriticalPath(tasks, edges);

    expect(result.criticalTaskIds).toEqual(new Set(["a", "b"]));
    expect(result.criticalEdgeIds).toEqual(new Set(["e1"]));
  });

  it("honors SF (start-to-finish) with lag", () => {
    // A(2-6) -SF,0-> B (duration 3): B's earliest finish is A.start(2)+0=2,
    // so B's earliest start is 2-3=-1; B is dated (-1-2) to match exactly.
    const tasks = [task("a", 2, 6), task("b", -1, 2)];
    const edges = [blocks("e1", "a", "b", "sf", 0)];

    const result = computeCriticalPath(tasks, edges);

    expect(result.criticalTaskIds).toEqual(new Set(["a", "b"]));
    expect(result.criticalEdgeIds).toEqual(new Set(["e1"]));
  });

  it("drops edges reaching outside the participating task set", () => {
    // "b" isn't in the task list (a cross-project/dateless task, per the
    // caller's own filtering) — the edge into it must not blow up. "a" is then
    // left with no in-scope edge, so it's a lone task and stays off the
    // highlight rather than being spuriously marked critical.
    const tasks = [task("a", 0, 2)];
    const edges = [blocks("e1", "a", "b")];

    const result = computeCriticalPath(tasks, edges);

    expect(result.criticalTaskIds.size).toBe(0);
    expect(result.criticalEdgeIds.size).toBe(0);
    expect(result.droppedEdgeCount).toBe(1);
  });

  describe("cross-project participation", () => {
    // These exercise the exact scenario the Gantt route wires up: a
    // cross-project "blocks" edge whose far-end task DOES have a resolved
    // schedule, so the caller includes it in `tasks` alongside this
    // project's own tasks (see gantt.tsx's crossProjectCriticalPathTasks).
    // The module itself has no notion of "project" — these tests just
    // confirm that including such a task produces the same tight-chain
    // behavior as an all-own-project network, since that's the whole point
    // of the fix: a cross-project task must be able to constrain (or be
    // constrained by) the network exactly like an own task once it's dated.

    it("marks a cross-project edge critical when it's the tight link in the chain", () => {
      // "gate" lives in another project (a security gate before the wave);
      // it FS,0-blocks "wave-1" in THIS project — the gap between them is
      // zero, so the cross-project link itself is tight/critical, and both
      // its endpoints are critical.
      const tasks = [
        task("gate", 0, 3), // cross-project far end, has its own dates
        task("wave-1", 3, 9), // this project's own task
      ];
      const edges = [blocks("gate-blocks-wave-1", "gate", "wave-1")];

      const result = computeCriticalPath(tasks, edges);

      expect(result.criticalTaskIds).toEqual(new Set(["gate", "wave-1"]));
      expect(result.criticalEdgeIds).toEqual(new Set(["gate-blocks-wave-1"]));
      expect(result.droppedEdgeCount).toBe(0);
    });

    it("marks only the branch that crosses a project boundary critical in a diamond", () => {
      // "approval" (own project) forks into "cutover" (ANOTHER project, the
      // 4-day long branch) and "prep" (own project, a 1-day branch that
      // finishes early), both FS into "go-live" (own project) — go-live's
      // own dates are tight against the cross-project branch, so "cutover"
      // and the edges touching it come out critical while "prep" carries
      // slack, mirroring the same-project diamond test above but with the
      // critical branch itself crossing a project boundary.
      const tasks = [
        task("approval", 0, 2),
        task("cutover", 2, 6), // cross-project
        task("prep", 2, 3), // own project, slack branch
        task("go-live", 6, 8),
      ];
      const edges = [
        blocks("approval-cutover", "approval", "cutover"),
        blocks("approval-prep", "approval", "prep"),
        blocks("cutover-go-live", "cutover", "go-live"),
        blocks("prep-go-live", "prep", "go-live"),
      ];

      const result = computeCriticalPath(tasks, edges);

      expect(result.criticalTaskIds).toEqual(
        new Set(["approval", "cutover", "go-live"]),
      );
      expect(result.criticalTaskIds.has("prep")).toBe(false);
      expect(result.criticalEdgeIds).toEqual(
        new Set(["approval-cutover", "cutover-go-live"]),
      );
      expect(result.criticalEdgeIds.has("approval-prep")).toBe(false);
      expect(result.criticalEdgeIds.has("prep-go-live")).toBe(false);
    });

    it("still drops a cross-project edge whose far end has no resolved schedule", () => {
      // "client-signoff" is a dateless cross-project task — the caller
      // never includes a dateless task in `tasks` (own or cross-project),
      // so this edge is dropped exactly like any other out-of-scope edge.
      // "wave-1" is then left with no in-scope edge, so it's a lone task and
      // stays off the highlight instead of being spuriously marked critical.
      const tasks = [task("wave-1", 3, 9)];
      const edges = [
        blocks("signoff-blocks-wave-1", "client-signoff", "wave-1"),
      ];

      const result = computeCriticalPath(tasks, edges);

      expect(result.criticalTaskIds.size).toBe(0);
      expect(result.criticalEdgeIds.size).toBe(0);
      expect(result.droppedEdgeCount).toBe(1);
    });
  });

  describe("droppedEdgeCount", () => {
    it("is 0 when every edge's endpoints are both in the participating task set", () => {
      const tasks = [task("a", 0, 2), task("b", 2, 5)];
      const edges = [blocks("e1", "a", "b")];

      expect(computeCriticalPath(tasks, edges).droppedEdgeCount).toBe(0);
    });

    it("counts an edge into a cross-project/dateless task, one per out-of-scope endpoint", () => {
      // "a" is in scope; "missing-1"/"missing-2" are not (a cross-project or
      // dateless task never makes it into the task list the caller passes).
      const tasks = [task("a", 0, 2)];
      const edges = [
        blocks("e1", "a", "missing-1"),
        blocks("e2", "missing-2", "a"),
      ];

      expect(computeCriticalPath(tasks, edges).droppedEdgeCount).toBe(2);
    });

    it("counts a self-edge as dropped even when the task itself is in scope", () => {
      const tasks = [task("a", 0, 2)];
      const edges = [blocks("e1", "a", "a")];

      const result = computeCriticalPath(tasks, edges);

      expect(result.droppedEdgeCount).toBe(1);
      expect(result.criticalEdgeIds.size).toBe(0);
    });
  });
});
