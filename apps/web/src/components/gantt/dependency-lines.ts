// Pure geometry for the Gantt dependency-line overlay. Kept free of the DOM
// and of React so the curve math is unit-testable without rendering
// anything: callers measure pixel boxes for each visible task bar, and this
// module turns relation edges into SVG path data between them.

export type GanttDependencyRelationType = "blocks" | "related";

// The four standard project-management dependency types. Only meaningful on
// a "blocks" edge (see resolveDependencyType below); a "related" edge always
// anchors finish-to-start, same as before this type existed.
export type GanttDependencyType = "fs" | "ss" | "ff" | "sf";

export type DependencyEdgeInput = {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationType: GanttDependencyRelationType;
  dependencyType?: GanttDependencyType;
  /** Lag (positive) or lead (negative) in days. Only rendered as a small
   * "+Nd"/"-Nd" label; it doesn't otherwise change the anchoring. */
  lagDays?: number;
};

export type TaskBarBox = {
  /** Pixels from the overlay's left edge to the bar's start (left) edge. */
  left: number;
  /** Pixels from the overlay's left edge to the bar's end (right) edge. */
  right: number;
  /** Pixels from the overlay's top edge to the row's top edge. */
  top: number;
  /** The row's rendered height in pixels. */
  height: number;
};

export type DependencyEdgeGeometry = DependencyEdgeInput & {
  path: string;
  sourcePoint: { x: number; y: number };
  targetPoint: { x: number; y: number };
  /** Where to draw a lag/lead label, or null when there's nothing to show
   * (a zero lag, or a "related" edge, which never carries one). */
  lagLabelPoint: { x: number; y: number } | null;
  /** Where to draw the dependency-TYPE label (FS/SS/FF/SF, see
   * GanttDependencyOverlay) — present for every "blocks" edge regardless of
   * lag (null for "related", which never carries a meaningful type). Offset
   * vertically from lagLabelPoint's own position when more than one
   * "blocks" edge fans out from the same source task, so a single gate
   * blocking many dependents stacks its labels in a readable list instead of
   * on top of one another — see the fan-out index in buildDependencyEdges. */
  typeLabelPoint: { x: number; y: number } | null;
};

type Point = { x: number; y: number };
type AnchorSide = "start" | "end";

// How far a connector travels out of a bar's edge (into the row's own
// horizontal gutter — the empty space in that row before/after the bar)
// before it's allowed to turn. Keeping this small but non-zero is what makes
// the line visibly "leave" the bar rather than touching a corner exactly at
// its edge.
const EXIT_GAP = 14;
// Corner rounding radius for the elbow's turns.
const CORNER_RADIUS = 8;
// Horizontal run kept straight in front of the target's start edge in the
// "drop, then enter" route (see buildElbowPoints): enough for the arrowhead
// (about 6.5 stroke widths long) plus a little, so the arrow always sits on a
// straight horizontal segment, never on the rounded corner.
const ARROW_RUN = 12;
// Vertical room a "below" detour lane needs under the LAST row: the lane sits
// EXIT_GAP past that row's bottom, plus a little for the stroke, arrowhead and
// rounded corners. Charts reserve this much empty space after their last row
// (see the Gantt and Portfolio row containers) so a backward connector routed
// under the bottom row stays inside the scrollable area instead of being
// clipped by the scroll container's own bottom edge.
export const DEPENDENCY_LANE_CLEARANCE_PX = EXIT_GAP + 10;
// Type labels (GanttDependencyOverlay) are centered on their point and are
// about 60px wide. Each label sits in its TARGET's row, on the outer side of
// the last vertical run into that row (the corner where the connector turns
// toward the target), so it is clearly attached to its own target even when
// several edges leave one source. LABEL_HALF_WIDTH_PX/LABEL_GAP_PX place the
// label's near edge LABEL_GAP_PX away from that vertical run.
const LABEL_HALF_WIDTH_PX = 30;
const LABEL_GAP_PX = 4;
// The overlay draws the label box from (point.y - 14) to (point.y + 2); shift
// the point down by this much so the box is vertically centered on the row.
const LABEL_CENTER_Y_OFFSET_PX = 6;
// Minimum clearance (px) kept between a same-row edge's type label and the
// source bar's own box. Same-row edges have no vertical run to hang the label
// on, so they keep the label beside the source (about half its width plus a
// buffer, so the label's far side never reaches back over the bar).
const LABEL_CLEAR_MARGIN_PX = 40;
// Horizontal spacing between the vertical drops of several L-shaped edges
// that share one source (see the fan-out in buildDependencyEdges).
const DROP_FAN_STEP_PX = 7;
// The measured box is the whole row, not the bar. An L route starts on the
// source bar's top/bottom edge. Task bars are `h-11` (44px; see
// gantt-task-bar.tsx and gantt-external-task-bar.tsx), so half is 22px, capped
// at the row's own half height so it never leaves the row.
const ASSUMED_BAR_HALF_HEIGHT_PX = 22;

function verticalCenter(box: TaskBarBox) {
  return box.top + box.height / 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// Which edge of each bar a dependency type anchors to. `fs` (the default —
// also what a "related" edge always uses) is source-end to target-start,
// i.e. exactly the original finish-to-start behavior.
function anchorSides(dependencyType: GanttDependencyType): {
  source: AnchorSide;
  target: AnchorSide;
} {
  switch (dependencyType) {
    case "ss":
      return { source: "start", target: "start" };
    case "ff":
      return { source: "end", target: "end" };
    case "sf":
      return { source: "start", target: "end" };
    default:
      return { source: "end", target: "start" };
  }
}

function anchorX(box: TaskBarBox, side: AnchorSide) {
  return side === "end" ? box.right : box.left;
}

// The direction a connector travels leaving (source) or arriving at (target)
// a given anchor side: away from the bar past its "end" edge is +x, past its
// "start" edge is -x. Exit and entry points are both `anchor + GAP * dir`,
// which is why buildElbowPoints can compute either with the same formula.
function sideDir(side: AnchorSide): 1 | -1 {
  return side === "end" ? 1 : -1;
}

// A small margin added around an obstacle's x-range in pickClearMidX so the
// step's vertical run visibly clears the bar rather than grazing its edge.
const OBSTACLE_CLEARANCE = 4;

// Chooses the vertical run's x position for the "clear forward step" case
// below. Defaults to the midpoint of the gap, same as before, but steps
// aside when an intermediate task's bar — one that sits in a row between the
// source and target rows, not the source or target themselves — would
// otherwise have the line cut straight through it. This only avoids bars
// whose row lies between the two endpoints; it isn't full graph
// obstacle-avoidance, so a sufficiently cluttered chart can still fall back
// to the default midpoint (see the `best ?? defaultMid` below).
function pickClearMidX(
  rangeMin: number,
  rangeMax: number,
  obstacles: readonly TaskBarBox[],
): number {
  const defaultMid = clamp(
    rangeMin + (rangeMax - rangeMin) / 2,
    rangeMin,
    rangeMax,
  );
  if (obstacles.length === 0) return defaultMid;

  const blocked = obstacles
    .map(
      (box) =>
        [box.left - OBSTACLE_CLEARANCE, box.right + OBSTACLE_CLEARANCE] as [
          number,
          number,
        ],
    )
    .filter(([left, right]) => right > rangeMin && left < rangeMax)
    .sort((a, b) => a[0] - b[0]);

  const isBlocked = (x: number) =>
    blocked.some(([left, right]) => x > left && x < right);
  if (!isBlocked(defaultMid)) return defaultMid;

  // Merge overlapping/adjacent blocked intervals, then read off the open
  // gaps between them (clipped to the routable [rangeMin, rangeMax] span).
  const merged: [number, number][] = [];
  for (const [left, right] of blocked) {
    const last = merged[merged.length - 1];
    if (last && left <= last[1]) {
      last[1] = Math.max(last[1], right);
    } else {
      merged.push([left, right]);
    }
  }

  const gaps: [number, number][] = [];
  let cursor = rangeMin;
  for (const [left, right] of merged) {
    if (left > cursor) gaps.push([cursor, Math.min(left, rangeMax)]);
    cursor = Math.max(cursor, right);
  }
  if (cursor < rangeMax) gaps.push([cursor, rangeMax]);

  // Whichever open gap's closest point sits nearest the default midpoint —
  // keeps the elbow as close to a straight, centered step as the obstacles
  // allow, rather than always preferring the leftmost or rightmost gap.
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [left, right] of gaps) {
    if (right <= left) continue;
    const candidate = clamp(defaultMid, left, right);
    const distance = Math.abs(candidate - defaultMid);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best ?? defaultMid;
}

// The polyline a dependency connector travels, routed so it runs through the
// gaps around bars rather than diagonally across them:
//  - same row: a single straight hop, source edge to target edge.
//  - target clearly to the right: leave the source's end edge, run one
//    horizontal-then-vertical-then-horizontal "step" through the inter-row
//    gutter, and arrive at the target's start edge. The vertical run sits at
//    the gap's midpoint unless an intermediate task's bar occupies it, in
//    which case it steps aside to the nearest clear gap (pickClearMidX).
//  - finish-to-start target to the right of the source's end but closer than
//    the step needs (typically the next day, e.g. a predecessor ending Thu
//    and a successor starting Fri): an "L" — leave the source bar's bottom
//    (or top, for a target above) edge at x = min(source end, target start -
//    ARROW_RUN) - dropShift, clamped to stay within the source bar's own
//    x-range, go straight down/up, then run right into the target's start
//    edge. Nothing loops back over a bar and there is no horizontal stub at
//    the source. The drop stays at or just inside the source's end, so it
//    never crosses the target bar.
//  - target behind the source (a backward-scheduled edge): leave the source to the right, drop into a
//    horizontal lane that clears both bars entirely (above whichever box is
//    higher, or below whichever is lower — whichever is the shorter detour,
//    except that a lane above the first row is never used: see laneY below),
//    travel the length of that lane, then approach the target's start edge
//    from the left, the same direction every other edge arrives from.
export function buildElbowPoints(
  source: TaskBarBox,
  target: TaskBarBox,
  obstacles: readonly TaskBarBox[] = [],
  dependencyType: GanttDependencyType = "fs",
  dropShift = 0,
): Point[] {
  return routeElbow(source, target, obstacles, dependencyType, dropShift)
    .points;
}

type RouteKind = "straight" | "step" | "drop" | "detour";

// `dropShift` moves an L ("drop") route's vertical run that many pixels left
// of its default x (still clamped to the source bar's own x-range); it is how
// buildDependencyEdges fans out several L edges sharing a source.
function routeElbow(
  source: TaskBarBox,
  target: TaskBarBox,
  obstacles: readonly TaskBarBox[],
  dependencyType: GanttDependencyType,
  dropShift: number,
): { points: Point[]; kind: RouteKind } {
  const { source: sourceSide, target: targetSide } =
    anchorSides(dependencyType);
  const sourceAnchorX = anchorX(source, sourceSide);
  const targetAnchorX = anchorX(target, targetSide);
  const sourceY = verticalCenter(source);
  const targetY = verticalCenter(target);
  const sourcePoint = { x: sourceAnchorX, y: sourceY };
  const targetPoint = { x: targetAnchorX, y: targetY };

  if (Math.abs(sourceY - targetY) < 0.5) {
    return { points: [sourcePoint, targetPoint], kind: "straight" };
  }

  const sourceDir = sideDir(sourceSide);
  const targetDir = sideDir(targetSide);
  // Both exit (leaving the source) and entry (approaching the target) points
  // sit `EXIT_GAP` past the anchor, in the direction that anchor's own side
  // faces — an "end" anchor exits/enters from further right, a "start"
  // anchor from further left.
  const exitX = sourceAnchorX + EXIT_GAP * sourceDir;
  const entryX = targetAnchorX + EXIT_GAP * targetDir;

  // A clean forward step (out, across, in) only works when the whole
  // horizontal run keeps moving away from the source in the direction it
  // exits — otherwise it would double back across the source's own bar. For
  // the default finish-to-start case this is just "the target is clearly to
  // the right", same as before this function anchored anywhere else.
  const forwardProgress = (entryX - exitX) * sourceDir;
  if (forwardProgress >= 0) {
    const minY = Math.min(sourceY, targetY);
    const maxY = Math.max(sourceY, targetY);
    // Only bars whose row actually lies within the vertical run the elbow
    // travels through can be crossed by it — source/target themselves are
    // excluded here (rather than by the caller pre-filtering the whole
    // shared obstacle set per edge, an O(edges x boxes) allocation on every
    // call) since this same pass already has to walk every box to check its
    // row.
    const intermediateObstacles = obstacles.filter(
      (box) =>
        box !== source &&
        box !== target &&
        box.top < maxY &&
        box.top + box.height > minY,
    );
    const [rangeMin, rangeMax] =
      exitX <= entryX ? [exitX, entryX] : [entryX, exitX];
    const midX = pickClearMidX(rangeMin, rangeMax, intermediateObstacles);
    return {
      points: [
        sourcePoint,
        { x: midX, y: sourceY },
        { x: midX, y: targetY },
        targetPoint,
      ],
      kind: "step",
    };
  }

  // A finish-to-start target at or after the source's end but nearer than the
  // step's two exit gaps: the target is ahead, so go straight down/up and
  // then right into it instead of wrapping around both bars. Only the
  // end -> start anchoring qualifies; the other types keep their routes.
  if (
    sourceSide === "end" &&
    targetSide === "start" &&
    targetAnchorX >= sourceAnchorX
  ) {
    const dropX = Math.max(
      source.left,
      Math.min(sourceAnchorX, targetAnchorX - ARROW_RUN) - dropShift,
    );
    // Start on the source bar's own bottom (or top) edge at the drop x and go
    // straight vertically: no horizontal stub back toward the bar's end, which
    // would curl at the rounded corner.
    const goesDown = targetY > sourceY;
    const halfBar = Math.min(ASSUMED_BAR_HALF_HEIGHT_PX, source.height / 2);
    return {
      points: [
        { x: dropX, y: goesDown ? sourceY + halfBar : sourceY - halfBar },
        { x: dropX, y: targetY },
        targetPoint,
      ],
      kind: "drop",
    };
  }

  // Not enough clear room for a direct step: go around instead of through.
  // `below`/`above` are lanes that clear BOTH boxes entirely — below the
  // lower of the two bottoms, or above the higher of the two tops —
  // whichever is the shorter detour, so the long horizontal run never
  // crosses either bar regardless of which side each one is entered from.
  const below =
    Math.max(source.top + source.height, target.top + target.height) + EXIT_GAP;
  const above = Math.min(source.top, target.top) - EXIT_GAP;
  const belowTravel = Math.abs(below - sourceY) + Math.abs(below - targetY);
  const aboveTravel = Math.abs(above - sourceY) + Math.abs(above - targetY);
  // Box coordinates are relative to the overlay's top edge, which is the top
  // of the FIRST row: anything above y=0 lies under the chart's opaque sticky
  // timeline header, so a lane there renders but is hidden — the connector
  // looks cut off at the header. Whenever either endpoint sits in the first
  // row the "above" lane would be negative, so take the "below" lane instead;
  // the space under the last row is kept free for it (see
  // DEPENDENCY_LANE_CLEARANCE_PX). Otherwise keep the shorter detour, with a
  // tie still going below.
  const aboveIsVisible = above >= 0;
  const laneY = !aboveIsVisible || belowTravel <= aboveTravel ? below : above;

  return {
    points: [
      sourcePoint,
      { x: exitX, y: sourceY },
      { x: exitX, y: laneY },
      { x: entryX, y: laneY },
      { x: entryX, y: targetY },
      targetPoint,
    ],
    kind: "detour",
  };
}

// Turns a polyline into an SVG path with each interior corner rounded to
// `radius` (clamped so it never overruns a segment shorter than the radius
// itself). A straight 2-point line needs no rounding and is returned as a
// plain `M ... L ...`.
export function roundedPolylinePath(
  rawPoints: Point[],
  radius: number,
): string {
  // A zero-length segment (a route whose first turn sits exactly on the
  // anchor) has no direction to round; drop the repeated point.
  const points = rawPoints.filter(
    (point, index) =>
      index === 0 ||
      point.x !== rawPoints[index - 1].x ||
      point.y !== rawPoints[index - 1].y,
  );
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const inRatio = inLen === 0 ? 0 : r / inLen;
    const outRatio = outLen === 0 ? 0 : r / outLen;
    const before = {
      x: corner.x - (corner.x - prev.x) * inRatio,
      y: corner.y - (corner.y - prev.y) * inRatio,
    };
    const after = {
      x: corner.x + (next.x - corner.x) * outRatio,
      y: corner.y + (next.y - corner.y) * outRatio,
    };
    d += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y}, ${after.x} ${after.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

// Anchors each edge by its dependency type (finish-to-start by default —
// also always used for a "related" edge) and routes it as a rounded elbow
// through the gaps around bars (see buildElbowPoints) rather than a
// straight diagonal across them.
//
// Two rules keep several edges leaving one source readable:
//  - Fan-out: L ("drop") routes that leave the same source in the same
//    direction would all drop at the same x and overlap. Each gets its own
//    drop x, DROP_FAN_STEP_PX apart, ordered so the nearest target row keeps
//    the default (rightmost) x and each farther row sits further LEFT. A
//    farther edge's vertical run then passes left of every nearer edge's
//    horizontal run into its target, so no two lines cross. The shift is
//    clamped at the source bar's left edge, where overlap is then allowed.
//    Step and detour routes are not fanned out (their x depends on obstacle
//    avoidance, and shifting them could push a run onto a bar).
//  - Labels: the type label (and lag label point) sits in the TARGET's row
//    beside the last vertical run into it, on the side away from the target
//    bar, vertically centered on the row — never on the arrowhead or the
//    target bar. For a fanned-out group it hangs left of the group's leftmost
//    drop so no sibling's vertical run crosses it. A same-row edge has no
//    vertical run and keeps its label beside the source bar.
export function buildDependencyEdges(
  edges: DependencyEdgeInput[],
  taskBoxes: ReadonlyMap<string, TaskBarBox>,
): DependencyEdgeGeometry[] {
  // Built once and passed to every edge's route as-is (see routeElbow, which
  // narrows it to the bars between an edge's own endpoints): re-filtering per
  // edge would allocate O(edges x boxes) throwaway arrays on every zoom notch.
  const allBoxes = [...taskBoxes.values()];

  type Resolved = {
    edge: DependencyEdgeInput;
    source: TaskBarBox;
    target: TaskBarBox;
    dependencyType: GanttDependencyType;
    lagDays: number;
    route: { points: Point[]; kind: RouteKind };
  };
  const resolved: Resolved[] = [];
  for (const edge of edges) {
    const source = taskBoxes.get(edge.sourceTaskId);
    const target = taskBoxes.get(edge.targetTaskId);
    if (!source || !target) continue;
    // Dependency type/lag are only meaningful on a "blocks" edge — a
    // "related" edge keeps its original finish-to-start look regardless of
    // whatever the row it came from happens to store.
    const dependencyType: GanttDependencyType =
      edge.relationType === "blocks" ? (edge.dependencyType ?? "fs") : "fs";
    const lagDays = edge.relationType === "blocks" ? (edge.lagDays ?? 0) : 0;
    resolved.push({
      edge,
      source,
      target,
      dependencyType,
      lagDays,
      route: routeElbow(source, target, allBoxes, dependencyType, 0),
    });
  }

  // Fan-out of L routes sharing a source and a direction (see above).
  const dropGroups = new Map<string, Resolved[]>();
  for (const item of resolved) {
    if (item.route.kind !== "drop") continue;
    const goesDown = item.route.points[1].y > item.route.points[0].y;
    const key = `${item.edge.sourceTaskId}|${goesDown ? "down" : "up"}`;
    const group = dropGroups.get(key);
    if (group) group.push(item);
    else dropGroups.set(key, [item]);
  }
  const groupMinDropX = new Map<Resolved, number>();
  for (const group of dropGroups.values()) {
    const ranked = group
      .map((item, index) => ({ item, index }))
      .sort(
        (a, b) =>
          Math.abs(a.item.route.points[1].y - a.item.route.points[0].y) -
            Math.abs(b.item.route.points[1].y - b.item.route.points[0].y) ||
          a.index - b.index,
      );
    let minX = Number.POSITIVE_INFINITY;
    ranked.forEach(({ item }, rank) => {
      if (rank > 0) {
        item.route = routeElbow(
          item.source,
          item.target,
          allBoxes,
          item.dependencyType,
          rank * DROP_FAN_STEP_PX,
        );
      }
      minX = Math.min(minX, item.route.points[0].x);
    });
    for (const item of group) groupMinDropX.set(item, minX);
  }

  const geometry: DependencyEdgeGeometry[] = [];
  for (const item of resolved) {
    const { edge, source, dependencyType, lagDays, route } = item;
    const { points } = route;
    const path = roundedPolylinePath(points, CORNER_RADIUS);
    const sourcePoint = points[0];
    const targetPoint = points[points.length - 1];

    // Only "blocks" edges get a type label (a "related" edge's
    // dependencyType is never meaningful).
    let typeLabelPoint: Point | null = null;
    if (edge.relationType === "blocks") {
      const { source: sourceSide } = anchorSides(dependencyType);
      if (points.length === 2) {
        // Same row: no vertical run; clear of the source bar's own box so the
        // label never lands on (or steals the hover of) a narrow bar.
        const dir = sideDir(sourceSide);
        typeLabelPoint = {
          x:
            dir === 1
              ? Math.max(targetPoint.x, source.right + LABEL_CLEAR_MARGIN_PX)
              : Math.min(targetPoint.x, source.left - LABEL_CLEAR_MARGIN_PX),
          y: sourcePoint.y,
        };
      } else {
        // The last vertical run into the target's row is the second-to-last
        // point's x (the final segment is horizontal).
        const runX = groupMinDropX.get(item) ?? points[points.length - 2].x;
        // Away from the target along the final horizontal run: left of the
        // run when the connector arrives moving right, right of it otherwise.
        const outward = targetPoint.x >= runX ? -1 : 1;
        const offset = LABEL_GAP_PX + LABEL_HALF_WIDTH_PX;
        let x = runX + outward * offset;
        // Keep the label inside the chart's left edge.
        if (outward < 0) x = Math.max(x, LABEL_HALF_WIDTH_PX);
        typeLabelPoint = {
          x,
          y: targetPoint.y + LABEL_CENTER_Y_OFFSET_PX,
        };
      }
    }
    // The lag is part of the same label, so it shares its anchor.
    const lagLabelPoint = lagDays !== 0 ? typeLabelPoint : null;

    geometry.push({
      ...edge,
      path,
      sourcePoint,
      targetPoint,
      lagLabelPoint,
      typeLabelPoint,
    });
  }

  return geometry;
}
