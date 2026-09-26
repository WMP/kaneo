import { describe, expect, it } from "vitest";
import {
  buildPortfolioRows,
  countScheduledTasks,
  flattenPortfolioSchedule,
  type PortfolioProjectInput,
} from "./gantt-portfolio";

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
