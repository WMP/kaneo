import { describe, expect, it } from "vitest";
import {
  computeFanInCollapse,
  FAN_IN_COLLAPSE_THRESHOLD,
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

describe("computeFanInCollapse", () => {
  const point = { x: 200, y: 50 };
  const into = (count: number, target = "t") =>
    Array.from({ length: count }, (_, i) => ({
      id: `${target}-${i}`,
      sourceTaskId: `s${i}`,
      targetTaskId: target,
      relationType: "blocks" as const,
      targetPoint: point,
    }));
  const none = { hoveredTaskId: null, pinnedTaskId: null };

  it("collapses only targets with more incoming edges than the threshold", () => {
    expect(
      computeFanInCollapse(into(FAN_IN_COLLAPSE_THRESHOLD), none).badges,
    ).toEqual([]);
    const result = computeFanInCollapse(
      into(FAN_IN_COLLAPSE_THRESHOLD + 1),
      none,
    );
    expect(result.collapsedEdgeIds.size).toBe(FAN_IN_COLLAPSE_THRESHOLD + 1);
    expect(result.badges).toEqual([
      {
        key: "t|start",
        targetTaskId: "t",
        side: "start",
        count: FAN_IN_COLLAPSE_THRESHOLD + 1,
        point,
      },
    ]);
  });

  it("keeps focused, critical and violated edges out of the collapse", () => {
    const list = into(FAN_IN_COLLAPSE_THRESHOLD + 3);
    const result = computeFanInCollapse(list, {
      hoveredTaskId: "s0",
      pinnedTaskId: null,
      criticalEdgeIds: new Set(["t-1"]),
      violatedEdgeIds: new Set(["t-2"]),
    });
    expect(result.collapsedEdgeIds.has("t-0")).toBe(false);
    expect(result.collapsedEdgeIds.has("t-1")).toBe(false);
    expect(result.collapsedEdgeIds.has("t-2")).toBe(false);
    expect(result.badges[0].count).toBe(FAN_IN_COLLAPSE_THRESHOLD);
  });

  it("collapses nothing while the target itself is focused", () => {
    const result = computeFanInCollapse(into(FAN_IN_COLLAPSE_THRESHOLD + 1), {
      hoveredTaskId: null,
      pinnedTaskId: "t",
    });
    expect(result.collapsedEdgeIds.size).toBe(0);
    expect(result.badges).toEqual([]);
  });

  it("groups per target and per bar edge", () => {
    const list = [
      ...into(FAN_IN_COLLAPSE_THRESHOLD + 1, "a"),
      ...into(FAN_IN_COLLAPSE_THRESHOLD, "b"),
    ];
    const result = computeFanInCollapse(list, none);
    expect(result.badges.map((badge) => badge.targetTaskId)).toEqual(["a"]);
  });
});
