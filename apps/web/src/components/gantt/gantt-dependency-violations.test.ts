import { describe, expect, it } from "vitest";
import { computeViolatedDependencyEdgeIds } from "./gantt-dependency-violations";

const day = (n: number) => new Date(Date.UTC(2026, 7, n));
const schedules = new Map([
  ["a", { start: day(3), end: day(7) }],
  ["ok", { start: day(8), end: day(10) }],
  ["early", { start: day(5), end: day(9) }],
]);

describe("computeViolatedDependencyEdgeIds", () => {
  it("flags an FS edge whose target starts before the day after the source ends", () => {
    const result = computeViolatedDependencyEdgeIds(
      [
        {
          id: "good",
          relationType: "blocks",
          sourceTaskId: "a",
          targetTaskId: "ok",
          dependencyType: "fs",
          lagDays: 0,
        },
        {
          id: "bad",
          relationType: "blocks",
          sourceTaskId: "a",
          targetTaskId: "early",
          dependencyType: "fs",
          lagDays: 0,
        },
      ],
      schedules,
    );
    expect([...result]).toEqual(["bad"]);
  });

  it("respects lag and the other dependency types", () => {
    const result = computeViolatedDependencyEdgeIds(
      [
        {
          id: "lag",
          relationType: "blocks",
          sourceTaskId: "a",
          targetTaskId: "ok",
          dependencyType: "fs",
          lagDays: 2,
        },
        {
          id: "ss",
          relationType: "blocks",
          sourceTaskId: "a",
          targetTaskId: "early",
          dependencyType: "ss",
          lagDays: 0,
        },
        {
          id: "ff",
          relationType: "blocks",
          sourceTaskId: "a",
          targetTaskId: "early",
          dependencyType: "ff",
          lagDays: 0,
        },
      ],
      schedules,
    );
    expect([...result]).toEqual(["lag"]);
  });

  it("ignores related edges and edges with an unscheduled endpoint", () => {
    const result = computeViolatedDependencyEdgeIds(
      [
        {
          id: "rel",
          relationType: "related",
          sourceTaskId: "a",
          targetTaskId: "early",
          dependencyType: "fs",
          lagDays: 0,
        },
        {
          id: "missing",
          relationType: "blocks",
          sourceTaskId: "a",
          targetTaskId: "nope",
          dependencyType: "fs",
          lagDays: 0,
        },
      ],
      schedules,
    );
    expect(result.size).toBe(0);
  });
});
