import { describe, expect, it } from "vitest";
import { deriveUndatedSuccessorSchedules } from "./gantt-derived-schedule";
import { deriveTaskScheduleWithEstimate } from "./gantt-estimated-span";
import {
  buildPortfolioRows,
  countScheduledTasks,
  flattenPortfolioSchedule,
  type PortfolioProjectInput,
} from "./gantt-portfolio";
import {
  DEFAULT_WORKING_DAYS,
  isWorkingDay,
  toDateKey,
} from "./gantt-working-calendar";

function project(
  overrides: Partial<PortfolioProjectInput> & { id: string },
): PortfolioProjectInput {
  return {
    name: overrides.id,
    slug: overrides.id,
    icon: null,
    tasks: [],
    ...overrides,
  };
}

describe("buildPortfolioRows", () => {
  it("drops archived tasks and counts dateless tasks as unscheduled", () => {
    const rows = buildPortfolioRows([
      project({
        id: "alpha",
        tasks: [
          {
            id: "t1",
            title: "Open task",
            startDate: "2026-01-10",
            dueDate: "2026-01-12",
            progress: 50,
            isMilestone: false,
            status: "to-do",
          },
          {
            id: "t2",
            title: "Filed away",
            startDate: "2026-01-01",
            dueDate: "2026-01-02",
            progress: 100,
            isMilestone: false,
            status: "archived",
          },
          {
            id: "t3",
            title: "Backlog, no dates",
            startDate: null,
            dueDate: null,
            progress: 0,
            isMilestone: false,
            status: "planned",
          },
        ],
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].tasks.map((task) => task.id)).toEqual(["t1"]);
    expect(rows[0].unscheduledCount).toBe(1);
  });

  it("derives a single-day schedule for a task with only one of the two dates", () => {
    const rows = buildPortfolioRows([
      project({
        id: "alpha",
        tasks: [
          {
            id: "t1",
            title: "Milestone-ish",
            startDate: null,
            dueDate: "2026-02-01",
            progress: 0,
            isMilestone: true,
            status: "to-do",
          },
        ],
      }),
    ]);

    expect(rows[0].tasks[0].scheduleStart).toEqual(
      rows[0].tasks[0].scheduleEnd,
    );
    expect(rows[0].tasks[0].scheduleStart.toISOString().slice(0, 10)).toBe(
      "2026-02-01",
    );
  });

  it("rolls up a project's span and duration-weighted progress across its scheduled tasks", () => {
    const rows = buildPortfolioRows([
      project({
        id: "alpha",
        tasks: [
          {
            // 1-day task, 100% done.
            id: "short",
            title: "Short",
            startDate: "2026-01-01",
            dueDate: "2026-01-01",
            progress: 100,
            isMilestone: false,
            status: "to-do",
          },
          {
            // 9-day task (Jan 2 - Jan 10 inclusive), 0% done.
            id: "long",
            title: "Long",
            startDate: "2026-01-02",
            dueDate: "2026-01-10",
            progress: 0,
            isMilestone: false,
            status: "to-do",
          },
        ],
      }),
    ]);

    const row = rows[0];
    expect(row.summarySpan?.start.toISOString().slice(0, 10)).toBe(
      "2026-01-01",
    );
    expect(row.summarySpan?.end.toISOString().slice(0, 10)).toBe("2026-01-10");
    // weighted average: (1*100 + 9*0) / 10 = 10
    expect(row.summaryProgress).toBeCloseTo(10);
  });

  it("reports null span/progress for a project with no scheduled tasks", () => {
    const rows = buildPortfolioRows([project({ id: "empty" })]);
    expect(rows[0].summarySpan).toBeNull();
    expect(rows[0].summaryProgress).toBeNull();
    expect(rows[0].tasks).toEqual([]);
    expect(rows[0].unscheduledCount).toBe(0);
  });

  it("keeps every project's rollup independent of the others", () => {
    const rows = buildPortfolioRows([
      project({
        id: "alpha",
        tasks: [
          {
            id: "a1",
            title: "A",
            startDate: "2026-01-01",
            dueDate: "2026-01-01",
            progress: 100,
            isMilestone: false,
            status: "to-do",
          },
        ],
      }),
      project({
        id: "beta",
        tasks: [
          {
            id: "b1",
            title: "B",
            startDate: "2026-06-01",
            dueDate: "2026-06-01",
            progress: 0,
            isMilestone: false,
            status: "to-do",
          },
        ],
      }),
    ]);

    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("alpha")?.summaryProgress).toBe(100);
    expect(byId.get("beta")?.summaryProgress).toBe(0);
  });
});

describe("flattenPortfolioSchedule", () => {
  it("flattens scheduled tasks across every project into one list", () => {
    const rows = buildPortfolioRows([
      project({
        id: "alpha",
        tasks: [
          {
            id: "a1",
            title: "A",
            startDate: "2026-01-01",
            dueDate: "2026-01-02",
            progress: 0,
            isMilestone: false,
            status: "to-do",
          },
        ],
      }),
      project({
        id: "beta",
        tasks: [
          {
            id: "b1",
            title: "B",
            startDate: "2026-02-01",
            dueDate: "2026-02-02",
            progress: 0,
            isMilestone: false,
            status: "to-do",
          },
        ],
      }),
    ]);

    expect(flattenPortfolioSchedule(rows)).toHaveLength(2);
  });
});

describe("countScheduledTasks", () => {
  it("sums scheduled tasks across every project", () => {
    const rows = buildPortfolioRows([
      project({
        id: "alpha",
        tasks: [
          {
            id: "a1",
            title: "A",
            startDate: "2026-01-01",
            dueDate: null,
            progress: 0,
            isMilestone: false,
            status: "to-do",
          },
        ],
      }),
      project({ id: "beta" }),
    ]);

    expect(countScheduledTasks(rows)).toBe(1);
  });
});

describe("buildPortfolioRows derived (dateless) successors", () => {
  const MON_FRI = (date: Date) =>
    isWorkingDay(date, DEFAULT_WORKING_DAYS, new Set());
  const key = (date: Date) => toDateKey(date);

  function task(
    id: string,
    overrides: Partial<PortfolioProjectInput["tasks"][number]> = {},
  ): PortfolioProjectInput["tasks"][number] {
    return {
      id,
      title: id,
      startDate: null,
      dueDate: null,
      progress: 0,
      isMilestone: false,
      status: "to-do",
      estimateMinutes: null,
      estimateUnit: "hours",
      ...overrides,
    };
  }

  const edge = (
    id: string,
    sourceTaskId: string,
    targetTaskId: string,
    dependencyType = "fs",
    lagDays = 0,
  ) => ({ id, sourceTaskId, targetTaskId, dependencyType, lagDays });

  function byId(rows: ReturnType<typeof buildPortfolioRows>) {
    return new Map(rows.flatMap((row) => row.tasks).map((t) => [t.id, t]));
  }

  it("places an undated task with an estimate after its dated predecessor, as a read-only derived bar", () => {
    // Mon 12 - Wed 14 Jan 2026; the successor starts the next day (Thu 15)
    // and spans 2 working days (960 min).
    const rows = buildPortfolioRows(
      [
        project({
          id: "alpha",
          tasks: [
            task("a", { startDate: "2026-01-12", dueDate: "2026-01-14" }),
            task("b", { estimateMinutes: 960 }),
          ],
        }),
      ],
      {
        derivationDependencies: [edge("r1", "a", "b")],
        isWorkingDay: MON_FRI,
      },
    );

    const b = byId(rows).get("b");
    expect(b?.isDerived).toBe(true);
    expect(key(b?.scheduleStart as Date)).toBe("2026-01-15");
    expect(key(b?.scheduleEnd as Date)).toBe("2026-01-16");
    expect(b?.estimateMinutes).toBe(960);
    expect(rows[0].unscheduledCount).toBe(0);
  });

  it("uses exactly the project Gantt derivation (same inputs, same dates)", () => {
    const projects = [
      project({
        id: "alpha",
        tasks: [
          task("a", { startDate: "2026-01-09", dueDate: "2026-01-09" }),
          task("b", { estimateMinutes: 1500 }),
          task("c", { estimateMinutes: 60 }),
        ],
      }),
      project({
        id: "beta",
        tasks: [task("d", { startDate: "2026-01-13", dueDate: "2026-01-20" })],
      }),
    ];
    const dependencies = [
      edge("r1", "a", "b", "fs", 1),
      edge("r2", "d", "b", "ff", 0),
      edge("r3", "b", "c"),
    ];
    const rows = buildPortfolioRows(projects, {
      derivationDependencies: dependencies,
      isWorkingDay: MON_FRI,
    });

    // The project Gantt's own call, fed the same dated spans and estimates.
    const dated = new Map<string, { start: Date; end: Date }>();
    for (const p of projects) {
      for (const t of p.tasks) {
        const span = deriveTaskScheduleWithEstimate(t, MON_FRI);
        if (span) dated.set(t.id, span);
      }
    }
    const expected = deriveUndatedSuccessorSchedules({
      edges: dependencies.map((d) => ({
        sourceTaskId: d.sourceTaskId,
        targetTaskId: d.targetTaskId,
        dependencyType: d.dependencyType as "fs" | "ff",
        lagDays: d.lagDays,
      })),
      datedScheduleById: dated,
      undatedCandidateIds: ["b", "c"],
      isWorkingDay: MON_FRI,
      estimateMinutesById: new Map([
        ["b", 1500],
        ["c", 60],
      ]),
    });

    const tasks = byId(rows);
    expect(expected.size).toBe(2);
    for (const id of ["b", "c"]) {
      expect(tasks.get(id)?.scheduleStart).toEqual(expected.get(id)?.start);
      expect(tasks.get(id)?.scheduleEnd).toEqual(expected.get(id)?.end);
    }
  });

  it("draws an undated task without an estimate as a single-day marker", () => {
    const rows = buildPortfolioRows(
      [
        project({
          id: "alpha",
          tasks: [
            task("a", { startDate: "2026-01-12", dueDate: "2026-01-14" }),
            task("b"),
          ],
        }),
      ],
      {
        derivationDependencies: [edge("r1", "a", "b")],
        isWorkingDay: MON_FRI,
      },
    );
    const b = byId(rows).get("b");
    expect(b?.isDerived).toBe(true);
    expect(key(b?.scheduleStart as Date)).toBe("2026-01-15");
    expect(b?.scheduleEnd).toEqual(b?.scheduleStart);
  });

  it("chains through a sized derived task, nudging onto a working day, but not through an unsized one", () => {
    const rows = buildPortfolioRows(
      [
        project({
          id: "alpha",
          tasks: [
            task("a", { startDate: "2026-01-12", dueDate: "2026-01-14" }),
            task("b", { estimateMinutes: 960 }),
            task("c"),
            task("m"),
            task("n"),
          ],
        }),
      ],
      {
        derivationDependencies: [
          edge("r1", "a", "b"),
          edge("r2", "b", "c"),
          // m is an unsized marker, so n (after m) stays unplaced.
          edge("r3", "a", "m"),
          edge("r4", "m", "n"),
        ],
        isWorkingDay: MON_FRI,
      },
    );
    const tasks = byId(rows);
    // b: Thu 15 - Fri 16; c: day after = Sat 17, nudged to Mon 19.
    expect(key(tasks.get("c")?.scheduleStart as Date)).toBe("2026-01-19");
    expect(tasks.has("m")).toBe(true);
    expect(tasks.has("n")).toBe(false);
    expect(rows[0].unscheduledCount).toBe(1);
  });

  it("anchors on a predecessor in another project", () => {
    const rows = buildPortfolioRows(
      [
        project({
          id: "alpha",
          tasks: [
            task("gate", { startDate: "2026-01-12", dueDate: "2026-01-12" }),
          ],
        }),
        project({
          id: "beta",
          tasks: [task("cutover", { estimateMinutes: 480 })],
        }),
      ],
      {
        derivationDependencies: [edge("r1", "gate", "cutover", "fs", 2)],
        isWorkingDay: MON_FRI,
      },
    );
    // end Mon 12 + 1 + lag 2 = Thu 15.
    expect(key(byId(rows).get("cutover")?.scheduleStart as Date)).toBe(
      "2026-01-15",
    );
    expect(rows[1].tasks.map((t) => t.id)).toEqual(["cutover"]);
  });

  it("leaves an undated task without a placed predecessor unscheduled", () => {
    const rows = buildPortfolioRows(
      [
        project({
          id: "alpha",
          tasks: [
            task("lonely", { estimateMinutes: 480 }),
            task("x"),
            task("y"),
          ],
        }),
      ],
      { derivationDependencies: [edge("r1", "x", "y")] },
    );
    expect(rows[0].tasks).toEqual([]);
    expect(rows[0].unscheduledCount).toBe(3);
  });

  it("never derives over a task that has a date, and rolls derived rows up into the project summary", () => {
    const rows = buildPortfolioRows(
      [
        project({
          id: "alpha",
          tasks: [
            task("a", { startDate: "2026-01-12", dueDate: "2026-01-12" }),
            task("own", { startDate: "2026-01-30", dueDate: "2026-01-30" }),
            task("b", { estimateMinutes: 12000 }),
          ],
        }),
      ],
      {
        derivationDependencies: [edge("r1", "a", "own"), edge("r2", "a", "b")],
        isWorkingDay: MON_FRI,
      },
    );
    const tasks = byId(rows);
    expect(tasks.get("own")?.isDerived).toBe(false);
    expect(key(tasks.get("own")?.scheduleStart as Date)).toBe("2026-01-30");
    // b spans 25 working days from Tue 13 (well past Jan 30), and the summary
    // extends to its end.
    expect(
      (tasks.get("b")?.scheduleEnd as Date) >
        (tasks.get("own")?.scheduleEnd as Date),
    ).toBe(true);
    expect(key(rows[0].summarySpan?.start as Date)).toBe("2026-01-12");
    expect(key(rows[0].summarySpan?.end as Date)).toBe(
      key(tasks.get("b")?.scheduleEnd as Date),
    );
    expect(rows[0].tasks.map((t) => t.id)).toEqual(["a", "own", "b"]);
  });

  it("gives a project with only derived tasks a summary span covering them", () => {
    // Beta holds the dated predecessor; alpha has only dateless, estimated
    // tasks: b (2 working days) then c (1 working day) chained after it.
    const rows = buildPortfolioRows(
      [
        project({
          id: "alpha",
          tasks: [
            task("b", { estimateMinutes: 960 }),
            task("c", { estimateMinutes: 480 }),
          ],
        }),
        project({
          id: "beta",
          tasks: [
            task("a", { startDate: "2026-01-12", dueDate: "2026-01-14" }),
          ],
        }),
      ],
      {
        derivationDependencies: [edge("r1", "a", "b"), edge("r2", "b", "c")],
        isWorkingDay: MON_FRI,
      },
    );
    const tasks = byId(rows);
    expect(tasks.get("b")?.isDerived).toBe(true);
    expect(tasks.get("c")?.isDerived).toBe(true);
    const alpha = rows.find((r) => r.id === "alpha");
    expect(alpha?.unscheduledCount).toBe(0);
    expect(key(alpha?.summarySpan?.start as Date)).toBe(
      key(tasks.get("b")?.scheduleStart as Date),
    );
    expect(key(alpha?.summarySpan?.end as Date)).toBe(
      key(tasks.get("c")?.scheduleEnd as Date),
    );
    expect(alpha?.summaryProgress).not.toBeNull();
  });

  it("weights the project summary progress by derived tasks too", () => {
    // a: 1 working day at 0%; b: derived, 3 working days at 100%.
    const rows = buildPortfolioRows(
      [
        project({
          id: "alpha",
          tasks: [
            task("a", {
              startDate: "2026-01-12",
              dueDate: "2026-01-12",
              progress: 0,
            }),
            task("b", { estimateMinutes: 1440, progress: 100 }),
          ],
        }),
      ],
      {
        derivationDependencies: [edge("r1", "a", "b")],
        isWorkingDay: MON_FRI,
      },
    );
    const tasks = byId(rows);
    const durationDays = (id: string) => {
      const t = tasks.get(id);
      if (!t) throw new Error(`missing task ${id}`);
      return (
        Math.round(
          (t.scheduleEnd.getTime() - t.scheduleStart.getTime()) / 86_400_000,
        ) + 1
      );
    };
    const da = durationDays("a");
    const db = durationDays("b");
    expect(rows[0].summaryProgress).toBeCloseTo((100 * db) / (da + db), 5);
  });

  it("does not feed derived spans back into the derivation input", () => {
    // c is blocked only by the undated, unsized b: b anchors nothing, so c
    // stays unplaced even though b now rolls up into the summary.
    const rows = buildPortfolioRows(
      [
        project({
          id: "alpha",
          tasks: [
            task("a", { startDate: "2026-01-12", dueDate: "2026-01-12" }),
            task("b"),
            task("c", { estimateMinutes: 480 }),
          ],
        }),
      ],
      {
        derivationDependencies: [edge("r1", "a", "b"), edge("r2", "b", "c")],
        isWorkingDay: MON_FRI,
      },
    );
    const tasks = byId(rows);
    expect(tasks.get("b")?.isDerived).toBe(true);
    expect(tasks.has("c")).toBe(false);
    expect(rows[0].unscheduledCount).toBe(1);
  });

  it("orders derived rows after the dated ones, by derived start", () => {
    const rows = buildPortfolioRows(
      [
        project({
          id: "alpha",
          tasks: [
            task("a", { startDate: "2026-01-12", dueDate: "2026-01-12" }),
            task("zlate", { estimateMinutes: 480 }),
            task("early", { estimateMinutes: 480 }),
          ],
        }),
      ],
      {
        derivationDependencies: [
          edge("r1", "a", "zlate", "fs", 5),
          edge("r2", "a", "early"),
        ],
        isWorkingDay: MON_FRI,
      },
    );
    expect(rows[0].tasks.map((t) => t.id)).toEqual(["a", "early", "zlate"]);
  });

  it("sizes an estimated single-date task by its estimate, like the project Gantt", () => {
    const rows = buildPortfolioRows(
      [
        project({
          id: "alpha",
          tasks: [
            task("start-only", {
              startDate: "2026-01-12",
              estimateMinutes: 1440,
            }),
            task("due-only", { dueDate: "2026-01-16", estimateMinutes: 960 }),
            task("milestone", {
              dueDate: "2026-01-16",
              estimateMinutes: 960,
              isMilestone: true,
            }),
          ],
        }),
      ],
      { isWorkingDay: MON_FRI },
    );
    const tasks = byId(rows);
    expect(key(tasks.get("start-only")?.scheduleEnd as Date)).toBe(
      "2026-01-14",
    );
    expect(key(tasks.get("due-only")?.scheduleStart as Date)).toBe(
      "2026-01-15",
    );
    expect(tasks.get("start-only")?.isDerived).toBe(false);
    // A milestone is a point marker and is not sized.
    expect(tasks.get("milestone")?.scheduleStart).toEqual(
      tasks.get("milestone")?.scheduleEnd,
    );
  });

  it("anchors a derived successor on the span of an estimated single-date predecessor", () => {
    const rows = buildPortfolioRows(
      [
        project({
          id: "alpha",
          tasks: [
            task("a", { startDate: "2026-01-12", estimateMinutes: 1440 }),
            task("b"),
          ],
        }),
      ],
      {
        derivationDependencies: [edge("r1", "a", "b")],
        isWorkingDay: MON_FRI,
      },
    );
    // a spans Mon 12 - Wed 14, so b starts Thu 15.
    expect(key(byId(rows).get("b")?.scheduleStart as Date)).toBe("2026-01-15");
  });
});
