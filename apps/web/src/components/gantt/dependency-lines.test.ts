import { describe, expect, it } from "vitest";
import {
  buildDependencyEdges,
  buildElbowPoints,
  type DependencyEdgeInput,
  roundedPolylinePath,
  type TaskBarBox,
} from "./dependency-lines";

// Where an L route leaves the source bar: the row centre plus/minus the
// assumed bar half height, min(22, rowHeight / 2) (dir 1 = down, -1 = up).
const barEdgeY = (centreY: number, rowHeight: number, dir: 1 | -1) =>
  centreY + dir * Math.min(22, rowHeight / 2);

describe("buildElbowPoints", () => {
  it("draws a single straight hop when source and target share a row", () => {
    const source: TaskBarBox = { left: 0, right: 100, top: 0, height: 40 };
    const target: TaskBarBox = { left: 200, right: 300, top: 0, height: 40 };

    expect(buildElbowPoints(source, target)).toEqual([
      { x: 100, y: 20 },
      { x: 200, y: 20 },
    ]);
  });

  it("steps through the row gutter (out, across, in) when the target is clearly ahead", () => {
    const source: TaskBarBox = { left: 0, right: 100, top: 0, height: 40 };
    const target: TaskBarBox = { left: 200, right: 300, top: 80, height: 40 };

    const points = buildElbowPoints(source, target);

    expect(points[0]).toEqual({ x: 100, y: 20 });
    expect(points[points.length - 1]).toEqual({ x: 200, y: 100 });
    // The step's vertical run sits strictly between the two bars
    // horizontally (never at x=100 or x=200, where it would clip a bar
    // edge) and visits both rows' y levels along the way.
    const midX = points[1].x;
    expect(midX).toBeGreaterThan(100);
    expect(midX).toBeLessThan(200);
    expect(points.map((p) => p.y)).toEqual([20, 20, 100, 100]);
  });

  it("never routes the horizontal step through where a mid-height obstacle would sit — it stays clear of both bar x-ranges", () => {
    const source: TaskBarBox = { left: 0, right: 100, top: 0, height: 40 };
    const target: TaskBarBox = { left: 400, right: 500, top: 80, height: 40 };

    const [, { x: midX }] = buildElbowPoints(source, target);
    expect(midX).toBeGreaterThanOrEqual(114); // >= source.right + EXIT_GAP
    expect(midX).toBeLessThanOrEqual(386); // <= target.left - EXIT_GAP
  });

  it("loops around clear of both bars when the target sits behind the source", () => {
    const source: TaskBarBox = { left: 200, right: 260, top: 0, height: 40 };
    const target: TaskBarBox = { left: 0, right: 60, top: 80, height: 40 };

    const points = buildElbowPoints(source, target);

    expect(points[0]).toEqual({ x: 260, y: 20 });
    expect(points[points.length - 1]).toEqual({ x: 0, y: 100 });
    // The long horizontal run (the two middle points, once the path has
    // exited the source row and before it approaches the target row) clears
    // both bars' rows entirely — below the lower bar's bottom, since that's
    // the shorter detour here — rather than cutting back across either one
    // at bar height.
    expect(points[2].y).toBeGreaterThanOrEqual(134); // max(bottom) + EXIT_GAP
    expect(points[3].y).toBe(points[2].y);
  });

  it("steps aside to clear an intermediate task's bar sitting between the two endpoints, instead of cutting straight through it", () => {
    const source: TaskBarBox = { left: 0, right: 100, top: 0, height: 40 };
    const target: TaskBarBox = { left: 400, right: 500, top: 80, height: 40 };
    // Sits in the row between source and target, spanning the default
    // midpoint (250) the un-obstructed case would otherwise pick.
    const intermediate: TaskBarBox = {
      left: 200,
      right: 300,
      top: 40,
      height: 40,
    };

    const [, { x: midXWithObstacle }] = buildElbowPoints(source, target, [
      intermediate,
    ]);
    const [, { x: midXWithoutObstacle }] = buildElbowPoints(source, target);

    // Without the obstacle the default midpoint (250) sits inside it.
    expect(midXWithoutObstacle).toBeGreaterThan(200);
    expect(midXWithoutObstacle).toBeLessThan(300);
    // With it, the vertical run steps clear of the intermediate bar's
    // x-range entirely (plus its small clearance margin).
    expect(midXWithObstacle <= 196 || midXWithObstacle >= 304).toBe(true);
    // Still a valid, routable position between the two endpoints.
    expect(midXWithObstacle).toBeGreaterThanOrEqual(114);
    expect(midXWithObstacle).toBeLessThanOrEqual(386);
  });

  it("ignores an obstacle whose row doesn't fall between the two endpoints", () => {
    const source: TaskBarBox = { left: 0, right: 100, top: 0, height: 40 };
    const target: TaskBarBox = { left: 400, right: 500, top: 80, height: 40 };
    // Below the target's row entirely — outside [sourceY, targetY], so it
    // can't be crossed by the elbow's vertical run.
    const belowBothRows: TaskBarBox = {
      left: 200,
      right: 300,
      top: 200,
      height: 40,
    };

    const [, { x: midX }] = buildElbowPoints(source, target, [belowBothRows]);
    const [, { x: defaultMidX }] = buildElbowPoints(source, target);
    expect(midX).toBe(defaultMidX);
  });

  it("falls back to the default midpoint when every position between the endpoints is blocked (residual case — full obstacle avoidance is out of scope)", () => {
    const source: TaskBarBox = { left: 0, right: 100, top: 0, height: 40 };
    const target: TaskBarBox = { left: 400, right: 500, top: 80, height: 40 };
    // Covers the entire routable span between the two bars.
    const wallToWallObstacle: TaskBarBox = {
      left: 100,
      right: 400,
      top: 40,
      height: 40,
    };

    const [, { x: midX }] = buildElbowPoints(source, target, [
      wallToWallObstacle,
    ]);
    const [, { x: defaultMidX }] = buildElbowPoints(source, target);
    expect(midX).toBe(defaultMidX);
  });

  it("enters an overlapping pair (target starts a little before the source ends) with the compact drop, not a near-vertical cut or a U-turn", () => {
    // Mirrors the reported "overlapping pair": the target starts 20px before
    // the source ends (short tasks), which is within the compact tolerance.
    const source: TaskBarBox = { left: 40, right: 120, top: 0, height: 44 };
    const target: TaskBarBox = { left: 100, right: 180, top: 44, height: 44 };

    const points = buildElbowPoints(source, target);

    // Drops from the source's own bottom edge, inside its x-range and left of
    // the target's start, then runs the ARROW_RUN straight into the target.
    expect(points).toEqual([
      { x: 88, y: barEdgeY(22, 44, 1) },
      { x: 88, y: 66 },
      { x: 100, y: 66 },
    ]);
  });

  it("still loops around a pair whose target starts well left of the source's exit", () => {
    const source: TaskBarBox = { left: 40, right: 220, top: 0, height: 44 };
    const target: TaskBarBox = { left: 100, right: 180, top: 44, height: 44 };

    const points = buildElbowPoints(source, target);

    expect(points[0]).toEqual({ x: 220, y: 22 });
    expect(points[points.length - 1]).toEqual({ x: 100, y: 66 });
    expect(points.length).toBeGreaterThan(3);
  });

  it("never routes a backward detour above the first row, where the sticky header would hide it, even when that detour is shorter", () => {
    // Mirrors the reported chart: the source (an own task, in a slightly
    // taller bottom row) finishes after the target (a cross-project task in
    // the FIRST row, top 0) starts. The "above" lane is the shorter detour
    // here (217.5 vs 222.5px of vertical travel), but it would sit at y=-14 —
    // under the opaque timeline header — so the connector looked cut off.
    const source: TaskBarBox = { left: 900, right: 960, top: 125, height: 67 };
    const target: TaskBarBox = { left: 440, right: 830, top: 0, height: 62 };

    const points = buildElbowPoints(source, target);

    // Every point stays inside the overlay (at or below the first row's top).
    for (const point of points) expect(point.y).toBeGreaterThanOrEqual(0);
    // The detour takes the lane under the lower box instead.
    expect(points[2].y).toBe(125 + 67 + 14);
    expect(points[3].y).toBe(points[2].y);
    // Endpoints are unchanged: source end to target start.
    expect(points[0]).toEqual({ x: 960, y: 125 + 67 / 2 });
    expect(points[points.length - 1]).toEqual({ x: 440, y: 31 });
  });

  it("still takes a shorter above lane when that lane stays below the first row", () => {
    // Neither box is in the first row, so the lane above the higher box (y=48)
    // is inside the overlay and, being the shorter detour, is still used.
    const source: TaskBarBox = { left: 900, right: 960, top: 200, height: 70 };
    const target: TaskBarBox = { left: 440, right: 830, top: 62, height: 62 };

    const points = buildElbowPoints(source, target);

    expect(points[2].y).toBe(62 - 14);
    expect(points[3].y).toBe(points[2].y);
  });
});

describe("buildElbowPoints — finish-to-start drop-then-enter route", () => {
  // The reported case: the predecessor ends on Thu and the successor starts
  // on Fri of the next row. The one-day gap (here 20px) is smaller than the
  // two exit gaps a clean step needs (28px), which used to wrap the line
  // around both bars and enter the target from the left.
  const source: TaskBarBox = { left: 0, right: 100, top: 0, height: 40 };

  it("drops straight down at the source's end, then runs right into the target", () => {
    const target: TaskBarBox = { left: 120, right: 220, top: 40, height: 40 };

    const points = buildElbowPoints(source, target);

    // Starts on the source bar's bottom edge (row centre plus the assumed
    // bar half height) at the drop x: no horizontal stub at the source.
    expect(points).toEqual([
      { x: 100, y: barEdgeY(20, 40, 1) },
      { x: 100, y: 60 },
      { x: 120, y: 60 },
    ]);
    expect(points[1].x).toBe(points[0].x);
    // Never wraps: x never goes left of the source's own box nor right of
    // the target's start, and the final approach moves right.
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(source.left);
      expect(point.x).toBeLessThanOrEqual(target.left);
    }
    expect(points[2].x).toBeGreaterThan(points[1].x);
  });

  it("keeps a straight arrow run before the target when the gap is tighter than the arrowhead", () => {
    // Gap of 5px: the drop moves just inside the source's end.
    const target: TaskBarBox = { left: 105, right: 205, top: 40, height: 40 };

    const points = buildElbowPoints(source, target);

    expect(points[1]).toEqual({ x: 93, y: 60 }); // 105 - ARROW_RUN (12)
    expect(points[2]).toEqual({ x: 105, y: 60 });
    expect(points[1].x).toBeLessThan(source.right);
  });

  it("handles a target starting exactly at the source's end", () => {
    const target: TaskBarBox = { left: 100, right: 200, top: 40, height: 40 };

    const points = buildElbowPoints(source, target);

    expect(points[2]).toEqual({ x: 100, y: 60 });
    // Drop inside the source (88), before the arrow's 12px run.
    expect(points[0]).toEqual({ x: 88, y: barEdgeY(20, 40, 1) });
    expect(points[1]).toEqual({ x: 88, y: 60 });
  });

  it("never drops left of the source's own box, even for a very short bar", () => {
    const tiny: TaskBarBox = { left: 96, right: 100, top: 0, height: 40 };
    const target: TaskBarBox = { left: 100, right: 160, top: 40, height: 40 };

    const points = buildElbowPoints(tiny, target);

    expect(points[1].x).toBe(96);
  });

  it("goes straight up, then right, for a target in the row above", () => {
    const below: TaskBarBox = { left: 0, right: 100, top: 80, height: 40 };
    const target: TaskBarBox = { left: 120, right: 220, top: 40, height: 40 };

    const points = buildElbowPoints(below, target);

    // Starts on the source's TOP edge (row centre minus the assumed bar half height) and goes up.
    expect(points.map((p) => p.y)).toEqual([barEdgeY(100, 40, -1), 60, 60]);
    expect(points.map((p) => p.x)).toEqual([100, 100, 120]);
  });

  it("keeps the normal step once the gap fits both exit gaps", () => {
    const target: TaskBarBox = { left: 128, right: 228, top: 40, height: 40 };

    const points = buildElbowPoints(source, target);

    // exit 114, entry 114: forwardProgress 0 -> the step with a vertical run
    // between the two bars, not the drop route.
    expect(points[1].x).toBe(114);
    expect(points[2].x).toBe(114);
  });

  it("keeps the detour for a genuinely backward edge", () => {
    const target: TaskBarBox = { left: 40, right: 140, top: 40, height: 40 };

    const points = buildElbowPoints(source, target);

    expect(points).toHaveLength(6);
  });

  it("does not change the routes of the other dependency types", () => {
    const target: TaskBarBox = { left: 120, right: 220, top: 40, height: 40 };

    for (const type of ["ss", "ff", "sf"] as const) {
      const points = buildElbowPoints(source, target, [], type);
      expect(points.length, type).toBeGreaterThanOrEqual(4);
    }
    // ss still exits the START edge to the left; ff still steps between the
    // two exit gaps (114..234) instead of dropping at the source's end.
    expect(buildElbowPoints(source, target, [], "ss")[1].x).toBe(-14);
    const ffStepX = buildElbowPoints(source, target, [], "ff")[1].x;
    expect(ffStepX).toBeGreaterThanOrEqual(114);
    expect(ffStepX).toBeLessThanOrEqual(234);
  });
});

describe("buildElbowPoints — dependency type anchoring", () => {
  // Same two boxes throughout, so only the anchor (and therefore the
  // resulting points) differ between the four types.
  const source: TaskBarBox = { left: 0, right: 100, top: 0, height: 40 };
  const target: TaskBarBox = { left: 200, right: 300, top: 80, height: 40 };

  it("fs (the default) anchors source-end to target-start", () => {
    const points = buildElbowPoints(source, target, [], "fs");
    expect(points[0]).toEqual({ x: 100, y: 20 });
    expect(points[points.length - 1]).toEqual({ x: 200, y: 100 });
  });

  it("ss anchors source-start to target-start", () => {
    const points = buildElbowPoints(source, target, [], "ss");
    expect(points[0]).toEqual({ x: 0, y: 20 });
    expect(points[points.length - 1]).toEqual({ x: 200, y: 100 });
  });

  it("ff anchors source-end to target-end", () => {
    const points = buildElbowPoints(source, target, [], "ff");
    expect(points[0]).toEqual({ x: 100, y: 20 });
    expect(points[points.length - 1]).toEqual({ x: 300, y: 100 });
  });

  it("sf anchors source-start to target-end", () => {
    const points = buildElbowPoints(source, target, [], "sf");
    expect(points[0]).toEqual({ x: 0, y: 20 });
    expect(points[points.length - 1]).toEqual({ x: 300, y: 100 });
  });

  it("leaves the source box in the anchor's own direction before it ever turns", () => {
    for (const type of ["fs", "ss", "ff", "sf"] as const) {
      const points = buildElbowPoints(source, target, [], type);
      // The first point after the source anchor (the exit point) sits on the
      // correct side of the source box for that anchor's direction — a
      // regression here would mean the elbow immediately doubles back across
      // the bar it just left.
      const exitsRight = type === "fs" || type === "ff";
      const exitPoint = points[1];
      if (exitsRight) {
        expect(exitPoint.x).toBeGreaterThanOrEqual(source.right);
      } else {
        expect(exitPoint.x).toBeLessThanOrEqual(source.left);
      }
    }
  });
});

describe("roundedPolylinePath", () => {
  it("returns a plain two-point line as-is", () => {
    expect(
      roundedPolylinePath(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        8,
      ),
    ).toBe("M 0 0 L 10 0");
  });

  it("rounds each interior corner of a multi-point path", () => {
    const path = roundedPolylinePath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      10,
    );
    expect(path).toBe(
      "M 0 0 L 90 0 Q 100 0, 100 10 L 100 90 Q 100 100, 110 100 L 200 100",
    );
  });

  it("clamps the radius so it never overruns a short segment", () => {
    const path = roundedPolylinePath(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 100 },
      ],
      10,
    );
    // radius is capped at half the 4px segment (2), not the requested 10.
    expect(path).toBe("M 0 0 L 2 0 Q 4 0, 4 2 L 4 100");
  });
});

describe("buildDependencyEdges", () => {
  it("connects a source bar's right edge to a target bar's left edge", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["a", { left: 0, right: 100, top: 0, height: 40 }],
      ["b", { left: 200, right: 300, top: 80, height: 40 }],
    ]);
    const edges: DependencyEdgeInput[] = [
      {
        id: "e1",
        sourceTaskId: "a",
        targetTaskId: "b",
        relationType: "blocks",
      },
    ];

    const [edge] = buildDependencyEdges(edges, boxes);

    expect(edge.sourcePoint).toEqual({ x: 100, y: 20 });
    expect(edge.targetPoint).toEqual({ x: 200, y: 100 });
    expect(edge.path.startsWith("M 100 20")).toBe(true);
    expect(edge.path.endsWith("200 100")).toBe(true);
    expect(edge.relationType).toBe("blocks");
  });

  it("skips an edge whose source task box is missing (off-screen or filtered out)", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["b", { left: 200, right: 300, top: 0, height: 40 }],
    ]);
    const edges: DependencyEdgeInput[] = [
      {
        id: "e1",
        sourceTaskId: "a",
        targetTaskId: "b",
        relationType: "related",
      },
    ];

    expect(buildDependencyEdges(edges, boxes)).toEqual([]);
  });

  it("skips an edge whose target task box is missing", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["a", { left: 0, right: 100, top: 0, height: 40 }],
    ]);
    const edges: DependencyEdgeInput[] = [
      {
        id: "e1",
        sourceTaskId: "a",
        targetTaskId: "b",
        relationType: "related",
      },
    ];

    expect(buildDependencyEdges(edges, boxes)).toEqual([]);
  });

  it("draws the reported one-day gap on a trunk just right of the predecessor's end: out, down, then right, with no leftward segment", () => {
    // DC-1 ends Thu; SOF-2 starts Fri on the next row, SOF-7 a row below.
    const boxes = new Map<string, TaskBarBox>([
      ["dc-1", { left: 0, right: 100, top: 0, height: 40 }],
      ["sof-2", { left: 120, right: 220, top: 40, height: 40 }],
      ["sof-7", { left: 120, right: 220, top: 80, height: 40 }],
    ]);
    const geometry = buildDependencyEdges(
      [
        {
          id: "e1",
          sourceTaskId: "dc-1",
          targetTaskId: "sof-2",
          relationType: "blocks",
        },
        {
          id: "e2",
          sourceTaskId: "dc-1",
          targetTaskId: "sof-7",
          relationType: "blocks",
          lagDays: 2,
        },
      ],
      boxes,
    );

    // The trunk sits EXIT_GAP past the source but not past the earliest
    // target's entry minus ARROW_RUN (120 - 12 = 108).
    expect(geometry[0].path).toBe(
      "M 100 20 L 104 20 Q 108 20, 108 24 L 108 54 Q 108 60, 114 60 L 120 60",
    );
    expect(geometry[0].sourcePoint).toEqual({ x: 100, y: 20 });
    expect(geometry[0].targetPoint).toEqual({ x: 120, y: 60 });
    for (const edge of geometry) {
      // Every x in the path stays within [source.left, target.left].
      const xs = [...edge.path.matchAll(/[ML] ([\d.-]+) /g)].map((m) =>
        Number(m[1]),
      );
      for (const x of xs) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(120);
      }
    }
    // Each label sits in its own target's row, left of the trunk, clear of
    // the target bar (which starts at 120) and not stacked with the other.
    expect(geometry[0].typeLabelPoint?.y).toBeGreaterThan(40);
    expect(geometry[0].typeLabelPoint?.y).toBeLessThan(80);
    expect(geometry[1].typeLabelPoint?.y).toBeGreaterThan(80);
    expect(geometry[1].typeLabelPoint?.y).toBeLessThan(120);
    for (const edge of geometry) {
      expect((edge.typeLabelPoint?.x ?? 0) + 30).toBeLessThan(120);
    }
    expect(geometry[1].lagLabelPoint).toEqual(geometry[1].typeLabelPoint);
  });

  it("still produces a routable path when the target sits before the source", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["a", { left: 200, right: 260, top: 0, height: 40 }],
      ["b", { left: 0, right: 60, top: 80, height: 40 }],
    ]);
    const edges: DependencyEdgeInput[] = [
      {
        id: "e1",
        sourceTaskId: "a",
        targetTaskId: "b",
        relationType: "blocks",
      },
    ];

    const [edge] = buildDependencyEdges(edges, boxes);

    expect(edge.sourcePoint.x).toBe(260);
    expect(edge.targetPoint.x).toBe(0);
    expect(edge.path).toMatch(/^M 260 20/);
  });

  // Proves the full data-shape used by the Gantt route: two same-project
  // tasks with overlapping dates, a "blocks" relation between them, and
  // measured boxes for both — exactly the case reported as "no line drawn".
  // If the boxes are present, buildDependencyEdges must always produce
  // exactly one red (blocking) edge; a regression here would mean the
  // geometry step itself is the reason nothing renders.
  it("draws exactly one blocking edge for two same-project tasks with overlapping dates once both are measured", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["task-a", { left: 40, right: 120, top: 0, height: 44 }],
      ["task-b", { left: 100, right: 180, top: 44, height: 44 }],
    ]);
    const edges: DependencyEdgeInput[] = [
      {
        id: "relation-1",
        sourceTaskId: "task-a",
        targetTaskId: "task-b",
        relationType: "blocks",
      },
    ];

    const geometry = buildDependencyEdges(edges, boxes);

    expect(geometry).toHaveLength(1);
    expect(geometry[0].relationType).toBe("blocks");
    // Compact route: leaves the source's bottom edge and enters the target.
    expect(geometry[0].sourcePoint).toEqual({ x: 88, y: barEdgeY(22, 44, 1) });
    expect(geometry[0].targetPoint).toEqual({ x: 100, y: 66 });
  });

  it("preserves relation type and id on the built edge", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["a", { left: 0, right: 100, top: 0, height: 40 }],
      ["b", { left: 200, right: 300, top: 0, height: 40 }],
    ]);
    const edges: DependencyEdgeInput[] = [
      {
        id: "rel-42",
        sourceTaskId: "a",
        targetTaskId: "b",
        relationType: "related",
      },
    ];

    const [edge] = buildDependencyEdges(edges, boxes);
    expect(edge.id).toBe("rel-42");
    expect(edge.relationType).toBe("related");
  });

  it("routes an edge's elbow around a third task's bar that sits between its two endpoints", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["a", { left: 0, right: 100, top: 0, height: 40 }],
      ["b", { left: 400, right: 500, top: 80, height: 40 }],
      ["c", { left: 200, right: 300, top: 40, height: 40 }],
    ]);
    const edges: DependencyEdgeInput[] = [
      {
        id: "e1",
        sourceTaskId: "a",
        targetTaskId: "b",
        relationType: "blocks",
      },
    ];

    const [edge] = buildDependencyEdges(edges, boxes);
    // Both interior corners of the elbow (source-row turn and target-row
    // turn) sit at the same x — the chosen vertical run's position — as the
    // first number after each rounded corner's `Q`.
    const cornerX = Number(edge.path.match(/Q ([\d.]+) /)?.[1]);
    expect(Number.isNaN(cornerX)).toBe(false);
    expect(cornerX <= 196 || cornerX >= 304).toBe(true);
  });

  it("anchors a 'blocks' edge by its stored dependencyType", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["a", { left: 0, right: 100, top: 0, height: 40 }],
      ["b", { left: 200, right: 300, top: 80, height: 40 }],
    ]);
    const edges: DependencyEdgeInput[] = [
      {
        id: "e1",
        sourceTaskId: "a",
        targetTaskId: "b",
        relationType: "blocks",
        dependencyType: "ss",
      },
    ];

    const [edge] = buildDependencyEdges(edges, boxes);
    expect(edge.sourcePoint).toEqual({ x: 0, y: 20 });
    expect(edge.targetPoint).toEqual({ x: 200, y: 100 });
  });

  it("ignores a 'related' edge's stored dependencyType and always anchors fs", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["a", { left: 0, right: 100, top: 0, height: 40 }],
      ["b", { left: 200, right: 300, top: 80, height: 40 }],
    ]);
    const edges: DependencyEdgeInput[] = [
      {
        id: "e1",
        sourceTaskId: "a",
        targetTaskId: "b",
        relationType: "related",
        // A "related" relation always stores the fs/0 defaults server-side,
        // but even a stray non-default value must never change its anchor.
        dependencyType: "ff",
      },
    ];

    const [edge] = buildDependencyEdges(edges, boxes);
    expect(edge.sourcePoint).toEqual({ x: 100, y: 20 });
    expect(edge.targetPoint).toEqual({ x: 200, y: 100 });
  });

  it("carries a lag label point only for a 'blocks' edge with a non-zero lag", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["a", { left: 0, right: 100, top: 0, height: 40 }],
      ["b", { left: 200, right: 300, top: 80, height: 40 }],
    ]);

    const [zeroLag] = buildDependencyEdges(
      [
        {
          id: "e1",
          sourceTaskId: "a",
          targetTaskId: "b",
          relationType: "blocks",
          lagDays: 0,
        },
      ],
      boxes,
    );
    expect(zeroLag.lagLabelPoint).toBeNull();

    const [withLag] = buildDependencyEdges(
      [
        {
          id: "e2",
          sourceTaskId: "a",
          targetTaskId: "b",
          relationType: "blocks",
          lagDays: 3,
        },
      ],
      boxes,
    );
    expect(withLag.lagLabelPoint).not.toBeNull();

    // A "related" edge never carries lag, even if the row happened to store
    // a non-zero value.
    const [related] = buildDependencyEdges(
      [
        {
          id: "e3",
          sourceTaskId: "a",
          targetTaskId: "b",
          relationType: "related",
          lagDays: 5,
        },
      ],
      boxes,
    );
    expect(related.lagLabelPoint).toBeNull();
  });

  it("carries a type label point for every 'blocks' edge regardless of lag, but never for 'related'", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["a", { left: 0, right: 100, top: 0, height: 40 }],
      ["b", { left: 200, right: 300, top: 80, height: 40 }],
    ]);

    const [zeroLag] = buildDependencyEdges(
      [
        {
          id: "e1",
          sourceTaskId: "a",
          targetTaskId: "b",
          relationType: "blocks",
          lagDays: 0,
        },
      ],
      boxes,
    );
    expect(zeroLag.typeLabelPoint).not.toBeNull();

    const [related] = buildDependencyEdges(
      [
        {
          id: "e2",
          sourceTaskId: "a",
          targetTaskId: "b",
          relationType: "related",
        },
      ],
      boxes,
    );
    expect(related.typeLabelPoint).toBeNull();
  });

  it("keeps a type label clear of the source bar's own box even when the raw corner point would fall on top of it", () => {
    // A tight lag between closely-scheduled tasks — the realistic shape at
    // Month/Quarter zoom, where many days compress into a couple of pixels
    // — puts the target's box (and so the elbow's own near-source corner)
    // almost flush against the source's. Without clearing, the label would
    // land back on top of the (narrow, MIN_BAR_HOVER_HIT_PX-clamped) source
    // bar itself, both misreading as belonging to it and stealing its hover.
    const boxes = new Map<string, TaskBarBox>([
      ["gate", { left: 0, right: 20, top: 0, height: 40 }],
      ["wave", { left: 24, right: 44, top: 80, height: 40 }],
    ]);
    const [edge] = buildDependencyEdges(
      [
        {
          id: "e1",
          sourceTaskId: "gate",
          targetTaskId: "wave",
          relationType: "blocks",
        },
      ],
      boxes,
    );

    expect(edge.typeLabelPoint).not.toBeNull();
    expect(edge.typeLabelPoint?.x).toBeGreaterThan(20);
  });

  it("clears the label on the correct side for a dependency type that exits the source's START edge", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["gate", { left: 100, right: 120, top: 0, height: 40 }],
      ["wave", { left: 10, right: 30, top: 80, height: 40 }],
    ]);
    const [edge] = buildDependencyEdges(
      [
        {
          id: "e1",
          sourceTaskId: "gate",
          targetTaskId: "wave",
          relationType: "blocks",
          // "ss"/"sf" anchor the source at its START edge, exiting to the
          // left — clearing must push the label further LEFT of that edge,
          // not right (which is what the default "fs" case above checks).
          dependencyType: "ss",
        },
      ],
      boxes,
    );

    expect(edge.typeLabelPoint).not.toBeNull();
    expect(edge.typeLabelPoint?.x).toBeLessThan(100);
  });

  it("puts each label in its own target's row, nearer that target than the shared source, one distinct point per edge", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["gate", { left: 0, right: 100, top: 0, height: 40 }],
      ["wave-1", { left: 200, right: 300, top: 80, height: 40 }],
      ["wave-2", { left: 200, right: 300, top: 160, height: 40 }],
      ["wave-3", { left: 100, right: 300, top: 240, height: 40 }],
    ]);
    const edges: DependencyEdgeInput[] = ["wave-1", "wave-2", "wave-3"].map(
      (target, i) => ({
        id: `e${i}`,
        sourceTaskId: "gate",
        targetTaskId: target,
        relationType: "blocks",
      }),
    );

    const geometry = buildDependencyEdges(edges, boxes);
    const targetCentres = [100, 180, 260];
    const sourceCentre = 20;
    geometry.forEach((edge, i) => {
      const label = edge.typeLabelPoint;
      expect(label).not.toBeNull();
      // Box spans y-14..y+2: centred on the target row, so the label's y is
      // far closer to the target row than to the source row.
      expect(Math.abs((label?.y ?? 0) - 6 - targetCentres[i])).toBeLessThan(1);
      expect(Math.abs((label?.y ?? 0) - targetCentres[i])).toBeLessThan(
        Math.abs((label?.y ?? 0) - sourceCentre),
      );
      // Never reaches the target bar: box right edge stays left of its start.
      expect((label?.x ?? 0) + 30).toBeLessThanOrEqual(
        boxes.get(edges[i].targetTaskId)?.left ?? 0,
      );
    });
    const ys = geometry.map((g) => g.typeLabelPoint?.y);
    expect(new Set(ys).size).toBe(3);
  });

  it("keeps a type label inside the chart's left edge", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["a", { left: 0, right: 20, top: 0, height: 40 }],
      ["b", { left: 30, right: 80, top: 40, height: 40 }],
    ]);
    const [edge] = buildDependencyEdges(
      [
        {
          id: "e",
          sourceTaskId: "a",
          targetTaskId: "b",
          relationType: "blocks",
        },
      ],
      boxes,
    );
    expect(edge.typeLabelPoint?.x).toBeGreaterThanOrEqual(30);
  });

  it("puts a label for a connector arriving from the right (sf) to the right of the last vertical run", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["a", { left: 300, right: 400, top: 0, height: 40 }],
      ["b", { left: 20, right: 100, top: 80, height: 40 }],
    ]);
    const [edge] = buildDependencyEdges(
      [
        {
          id: "e",
          sourceTaskId: "a",
          targetTaskId: "b",
          relationType: "blocks",
          dependencyType: "sf",
        },
      ],
      boxes,
    );
    // The sf route enters the target's end edge (100) from the right.
    expect((edge.typeLabelPoint?.x ?? 0) - 30).toBeGreaterThanOrEqual(100);
  });

  it("keeps the same-row label beside the source bar", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["a", { left: 0, right: 20, top: 0, height: 40 }],
      ["b", { left: 24, right: 44, top: 0, height: 40 }],
    ]);
    const [edge] = buildDependencyEdges(
      [
        {
          id: "e",
          sourceTaskId: "a",
          targetTaskId: "b",
          relationType: "blocks",
        },
      ],
      boxes,
    );
    expect(edge.typeLabelPoint?.x).toBeGreaterThan(20);
  });

  describe("shared trunk per source", () => {
    const source: TaskBarBox = { left: 0, right: 100, top: 80, height: 40 };
    const edgesTo = (ids: string[]): DependencyEdgeInput[] =>
      ids.map((id, i) => ({
        id: `e${i}`,
        sourceTaskId: "src",
        targetTaskId: id,
        relationType: "blocks",
      }));
    // The x of the edge's vertical trunk: the x shared by the points of its
    // only vertical segment.
    const trunkXs = (path: string) => {
      const points = [...path.matchAll(/(?:[MLQ]|,) ([\d.-]+) ([\d.-]+)/g)].map(
        (m) => ({ x: Number(m[1]), y: Number(m[2]) }),
      );
      const xs = new Set<number>();
      for (let i = 1; i < points.length; i++) {
        if (points[i].x === points[i - 1].x && points[i].y !== points[i - 1].y)
          xs.add(points[i].x);
      }
      return [...xs];
    };

    it("draws one exact trunk x for every edge leaving the same source, whatever the target rows", () => {
      const boxes = new Map<string, TaskBarBox>([
        ["src", { left: 0, right: 100, top: 0, height: 40 }],
        ["t1", { left: 120, right: 220, top: 40, height: 40 }],
        ["t2", { left: 150, right: 250, top: 80, height: 40 }],
        ["t3", { left: 300, right: 400, top: 120, height: 40 }],
      ]);
      const geometry = buildDependencyEdges(edgesTo(["t1", "t2", "t3"]), boxes);

      // Earliest target starts at 120: trunk at 120 - ARROW_RUN = 108.
      for (const edge of geometry) expect(trunkXs(edge.path)).toEqual([108]);
      // Each edge still ends in its own target, entered from the left.
      expect(geometry.map((edge) => edge.targetPoint)).toEqual([
        { x: 120, y: 60 },
        { x: 150, y: 100 },
        { x: 300, y: 140 },
      ]);
    });

    it("keeps the trunk at the preferred exit gap when every target is far enough ahead", () => {
      const boxes = new Map<string, TaskBarBox>([
        ["src", { left: 0, right: 100, top: 0, height: 40 }],
        ["t1", { left: 200, right: 300, top: 40, height: 40 }],
        ["t2", { left: 260, right: 360, top: 80, height: 40 }],
      ]);
      const geometry = buildDependencyEdges(edgesTo(["t1", "t2"]), boxes);
      for (const edge of geometry) expect(trunkXs(edge.path)).toEqual([114]);
    });

    it("shares the trunk for edges going up and edges going down", () => {
      const boxes = new Map<string, TaskBarBox>([
        ["src", source],
        ["up", { left: 120, right: 220, top: 40, height: 40 }],
        ["down", { left: 120, right: 220, top: 120, height: 40 }],
      ]);
      const [up, down] = buildDependencyEdges(edgesTo(["up", "down"]), boxes);
      expect(trunkXs(up.path)).toEqual(trunkXs(down.path));
    });

    it("starts a compact trunk on the source's own top edge for targets above", () => {
      // Both targets start 5px past the source's end: the trunk (105 - 12 =
      // 93) lies inside the source bar, so it starts on the bar's top edge.
      const boxes = new Map<string, TaskBarBox>([
        ["src", source],
        ["t1", { left: 105, right: 205, top: 40, height: 40 }],
        ["t2", { left: 105, right: 205, top: 0, height: 40 }],
      ]);
      const geometry = buildDependencyEdges(edgesTo(["t1", "t2"]), boxes);
      for (const edge of geometry) {
        expect(edge.sourcePoint).toEqual({
          x: 93,
          y: barEdgeY(100, 40, -1),
        });
      }
    });

    it("clamps a compact trunk at the source's left edge instead of leaving the bar", () => {
      const boxes = new Map<string, TaskBarBox>([
        ["src", { left: 90, right: 100, top: 0, height: 40 }],
        ["t1", { left: 110, right: 210, top: 40, height: 40 }],
        ["t2", { left: 110, right: 210, top: 80, height: 40 }],
        ["t3", { left: 110, right: 210, top: 120, height: 40 }],
      ]);
      const geometry = buildDependencyEdges(edgesTo(["t1", "t2", "t3"]), boxes);
      for (const edge of geometry) {
        expect(edge.sourcePoint.x).toBeGreaterThanOrEqual(90);
        expect(edge.sourcePoint.x).toBeLessThanOrEqual(100);
        expect(trunkXs(edge.path)).toEqual([98]);
      }
    });

    it("puts each edge's label beside the trunk in its own target's row", () => {
      const boxes = new Map<string, TaskBarBox>([
        ["src", { left: 0, right: 100, top: 0, height: 40 }],
        ["t1", { left: 200, right: 300, top: 40, height: 40 }],
        ["t2", { left: 200, right: 300, top: 80, height: 40 }],
      ]);
      const geometry = buildDependencyEdges(edgesTo(["t1", "t2"]), boxes);
      const [a, b] = geometry;
      // Left of the shared trunk (114), vertically in the target's row.
      expect(a.typeLabelPoint?.x).toBe(80);
      expect(b.typeLabelPoint?.x).toBe(80);
      expect(a.typeLabelPoint?.y).toBeGreaterThan(40);
      expect(a.typeLabelPoint?.y).toBeLessThan(80);
      expect(b.typeLabelPoint?.y).toBeGreaterThan(80);
      expect(b.typeLabelPoint?.y).toBeLessThan(120);
    });

    it("keeps one shared lane and exit column for the detours of one source", () => {
      // Both targets start well left of the source's exit.
      const boxes = new Map<string, TaskBarBox>([
        ["src", { left: 300, right: 400, top: 0, height: 40 }],
        ["t1", { left: 0, right: 100, top: 40, height: 40 }],
        ["t2", { left: 0, right: 100, top: 120, height: 40 }],
      ]);
      const geometry = buildDependencyEdges(edgesTo(["t1", "t2"]), boxes);
      const lanes = geometry.map((edge) => {
        const pts = [...edge.path.matchAll(/(?:[MLQ]|,) ([\d.-]+) ([\d.-]+)/g)];
        return pts.map((m) => `${m[1]},${m[2]}`);
      });
      // Both detours leave the source along the same exit column x = 414.
      for (const edge of geometry) {
        expect(edge.path).toContain("Q 414 20,");
      }
      // And run along the same lane y (below the lowest of the two targets).
      const laneYs = lanes.map(
        (pts) =>
          pts.map((p) => Number(p.split(",")[1])).sort((x, y) => y - x)[0],
      );
      expect(laneYs[0]).toBe(laneYs[1]);
    });
  });

  it("uses the compact drop for a short same-day pair instead of a U-turn", () => {
    // The successor starts on the predecessor's last day: 12px before the
    // predecessor's end, still inside its x-range.
    const boxes = new Map<string, TaskBarBox>([
      ["a", { left: 100, right: 126, top: 0, height: 40 }],
      ["b", { left: 114, right: 140, top: 40, height: 40 }],
    ]);
    const [edge] = buildDependencyEdges(
      [
        {
          id: "e",
          sourceTaskId: "a",
          targetTaskId: "b",
          relationType: "blocks",
        },
      ],
      boxes,
    );

    // Drop on the trunk (114 - ARROW_RUN = 102, inside the source), then the
    // straight arrow run into the target: no lane below the bars.
    expect(edge.sourcePoint).toEqual({ x: 102, y: barEdgeY(20, 40, 1) });
    expect(edge.targetPoint).toEqual({ x: 114, y: 60 });
    const ys = [...edge.path.matchAll(/(?:[MLQ]|,) ([\d.-]+) ([\d.-]+)/g)].map(
      (m) => Number(m[2]),
    );
    expect(Math.max(...ys)).toBeLessThanOrEqual(60);
  });

  describe("channels between different sources", () => {
    const edge = (id: string, source: string, target: string) => ({
      id,
      sourceTaskId: source,
      targetTaskId: target,
      relationType: "blocks" as const,
    });
    const trunkX = (path: string) => {
      const points = [...path.matchAll(/(?:[MLQ]|,) ([\d.-]+) ([\d.-]+)/g)].map(
        (m) => ({ x: Number(m[1]), y: Number(m[2]) }),
      );
      for (let i = 1; i < points.length; i++) {
        if (points[i].x === points[i - 1].x && points[i].y !== points[i - 1].y)
          return points[i].x;
      }
      return Number.NaN;
    };

    it("offsets the trunks of two sources that end on the same day and cover overlapping rows", () => {
      const boxes = new Map<string, TaskBarBox>([
        ["s1", { left: 0, right: 100, top: 0, height: 40 }],
        ["s2", { left: 0, right: 100, top: 40, height: 40 }],
        ["t1", { left: 300, right: 400, top: 80, height: 40 }],
        ["t2", { left: 300, right: 400, top: 120, height: 40 }],
      ]);
      const geometry = buildDependencyEdges(
        [edge("a", "s1", "t1"), edge("b", "s2", "t2")],
        boxes,
      );
      const [a, b] = geometry.map((g) => trunkX(g.path));
      expect(a).not.toBe(b);
      expect(Math.abs(a - b)).toBeGreaterThanOrEqual(5);
    });

    it("keeps the trunks identical when the sources' row spans do not overlap", () => {
      const boxes = new Map<string, TaskBarBox>([
        ["s1", { left: 0, right: 100, top: 0, height: 40 }],
        ["t1", { left: 300, right: 400, top: 40, height: 40 }],
        ["s2", { left: 0, right: 100, top: 200, height: 40 }],
        ["t2", { left: 300, right: 400, top: 240, height: 40 }],
      ]);
      const geometry = buildDependencyEdges(
        [edge("a", "s1", "t1"), edge("b", "s2", "t2")],
        boxes,
      );
      expect(trunkX(geometry[0].path)).toBe(trunkX(geometry[1].path));
    });

    it("keeps trunks that are already a channel step apart where they are", () => {
      const boxes = new Map<string, TaskBarBox>([
        ["s1", { left: 0, right: 100, top: 0, height: 40 }],
        ["s2", { left: 0, right: 106, top: 40, height: 40 }],
        ["t1", { left: 300, right: 400, top: 80, height: 40 }],
        ["t2", { left: 300, right: 400, top: 120, height: 40 }],
      ]);
      const geometry = buildDependencyEdges(
        [edge("a", "s1", "t1"), edge("b", "s2", "t2")],
        boxes,
      );
      expect(trunkX(geometry[0].path)).toBe(114);
      expect(trunkX(geometry[1].path)).toBe(120);
    });

    it("is deterministic: input order does not change the geometry", () => {
      const boxes = new Map<string, TaskBarBox>();
      const edges: DependencyEdgeInput[] = [];
      for (let i = 0; i < 12; i++) {
        boxes.set(`s${i}`, { left: 0, right: 100, top: i * 40, height: 40 });
        boxes.set(`t${i}`, {
          left: 300,
          right: 400,
          top: (i + 12) * 40,
          height: 40,
        });
        edges.push(edge(`e${i}`, `s${i}`, `t${i}`));
      }
      const forward = buildDependencyEdges(edges, boxes);
      const reversed = buildDependencyEdges([...edges].reverse(), boxes);
      const byId = (list: typeof forward) =>
        Object.fromEntries(list.map((g) => [g.id, g.path]));
      expect(byId(reversed)).toEqual(byId(forward));
      expect(buildDependencyEdges(edges, boxes)).toEqual(forward);
    });

    it("stays fast for about 500 edges (sorting plus bounded probes, no per-edge scan of every box)", () => {
      const boxes = new Map<string, TaskBarBox>();
      const edges: DependencyEdgeInput[] = [];
      const rows = 300;
      for (let i = 0; i < rows; i++) {
        boxes.set(`n${i}`, {
          left: (i % 7) * 30,
          right: (i % 7) * 30 + 60,
          top: i * 44,
          height: 44,
        });
      }
      for (let i = 0; i < 500; i++) {
        const from = i % (rows - 12);
        const to = from + 1 + (i % 11);
        edges.push(edge(`e${i}`, `n${from}`, `n${to}`));
      }
      const started = performance.now();
      const geometry = buildDependencyEdges(edges, boxes);
      const elapsed = performance.now() - started;
      expect(geometry.length).toBeGreaterThan(400);
      // Generous bound: the point is that it is nowhere near quadratic.
      expect(elapsed).toBeLessThan(1000);
    });
  });

  it("never routes to the left of the leftmost bar by more than the small exit gap, so the connector cannot bleed toward the task rail", () => {
    const source: TaskBarBox = { left: 500, right: 560, top: 0, height: 40 };
    const target: TaskBarBox = { left: 480, right: 540, top: 40, height: 40 };

    const points = buildElbowPoints(source, target);
    const minX = Math.min(...points.map((p) => p.x));
    expect(minX).toBeGreaterThanOrEqual(480 - 14 - 1);
  });

  // buildDependencyEdges shares one obstacle array (every visible box)
  // across every edge, rather than building a fresh "all-but-this-edge's-
  // own-two" array per edge — buildElbowPoints itself excludes an edge's own
  // source/target by reference (see its intermediateObstacles filter). This
  // proves that sharing doesn't leak one edge's own endpoints into another
  // edge's obstacle avoidance.
  it("computes correct, independent geometry for multiple edges sharing the same obstacle set", () => {
    const boxes = new Map<string, TaskBarBox>([
      ["a", { left: 0, right: 100, top: 0, height: 40 }],
      ["b", { left: 400, right: 500, top: 80, height: 40 }],
      ["c", { left: 0, right: 100, top: 160, height: 40 }],
      ["d", { left: 400, right: 500, top: 240, height: 40 }],
    ]);
    const edges: DependencyEdgeInput[] = [
      {
        id: "e1",
        sourceTaskId: "a",
        targetTaskId: "b",
        relationType: "blocks",
      },
      {
        id: "e2",
        sourceTaskId: "c",
        targetTaskId: "d",
        relationType: "related",
      },
    ];

    const geometry = buildDependencyEdges(edges, boxes);
    expect(geometry).toHaveLength(2);
    expect(geometry[0].sourcePoint).toEqual({ x: 100, y: 20 });
    expect(geometry[0].targetPoint).toEqual({ x: 400, y: 100 });
    expect(geometry[1].sourcePoint).toEqual({ x: 100, y: 180 });
    expect(geometry[1].targetPoint).toEqual({ x: 400, y: 260 });
  });
});
