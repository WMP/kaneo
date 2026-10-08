import { describe, expect, it } from "vitest";
import {
  filterEdgesForDisplayMode,
  isEdgeFocused,
  isGanttDependencyDisplayMode,
  shouldShowTypeLabel,
} from "./gantt-dependency-display";

const edges = [
  {
    id: "1",
    sourceTaskId: "a",
    targetTaskId: "b",
    relationType: "blocks" as const,
  },
  {
    id: "2",
    sourceTaskId: "b",
    targetTaskId: "c",
    relationType: "blocks" as const,
  },
  {
    id: "3",
    sourceTaskId: "x",
    targetTaskId: "y",
    relationType: "related" as const,
  },
];
const ids = (list: { id: string }[]) => list.map((edge) => edge.id);
const none = { hoveredTaskId: null, pinnedTaskId: null };

describe("filterEdgesForDisplayMode", () => {
  it("all keeps every edge", () => {
    expect(ids(filterEdgesForDisplayMode(edges, "all", none))).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("hidden keeps none", () => {
    expect(
      filterEdgesForDisplayMode(edges, "hidden", {
        ...none,
        hoveredTaskId: "a",
      }),
    ).toEqual([]);
  });

  it("focused keeps edges incident to the hovered or pinned task", () => {
    expect(filterEdgesForDisplayMode(edges, "focused", none)).toEqual([]);
    expect(
      ids(
        filterEdgesForDisplayMode(edges, "focused", {
          ...none,
          hoveredTaskId: "b",
        }),
      ),
    ).toEqual(["1", "2"]);
    expect(
      ids(
        filterEdgesForDisplayMode(edges, "focused", {
          hoveredTaskId: "a",
          pinnedTaskId: "y",
        }),
      ),
    ).toEqual(["1", "3"]);
  });

  it("critical keeps only critical edges and none without a critical set", () => {
    expect(
      ids(
        filterEdgesForDisplayMode(edges, "critical", {
          ...none,
          criticalEdgeIds: new Set(["2"]),
        }),
      ),
    ).toEqual(["2"]);
    expect(filterEdgesForDisplayMode(edges, "critical", none)).toEqual([]);
  });
});

describe("isEdgeFocused", () => {
  it("is false with nothing hovered or pinned", () => {
    expect(isEdgeFocused(edges[0], null, null)).toBe(false);
  });
});

describe("shouldShowTypeLabel", () => {
  it("hides a plain FS edge at rest and shows it when focused", () => {
    expect(shouldShowTypeLabel({}, false)).toBe(false);
    expect(
      shouldShowTypeLabel({ dependencyType: "fs", lagDays: 0 }, false),
    ).toBe(false);
    expect(shouldShowTypeLabel({}, true)).toBe(true);
  });

  it("always shows SS/FF/SF and a lagged or led FS edge", () => {
    for (const dependencyType of ["ss", "ff", "sf"] as const) {
      expect(shouldShowTypeLabel({ dependencyType }, false)).toBe(true);
    }
    expect(
      shouldShowTypeLabel({ dependencyType: "fs", lagDays: 2 }, false),
    ).toBe(true);
    expect(
      shouldShowTypeLabel({ dependencyType: "fs", lagDays: -1 }, false),
    ).toBe(true);
  });
});

describe("isGanttDependencyDisplayMode", () => {
  it("accepts the four modes and rejects anything else", () => {
    for (const mode of ["all", "focused", "critical", "hidden"]) {
      expect(isGanttDependencyDisplayMode(mode)).toBe(true);
    }
    expect(isGanttDependencyDisplayMode("none")).toBe(false);
    expect(isGanttDependencyDisplayMode(undefined)).toBe(false);
  });
});
