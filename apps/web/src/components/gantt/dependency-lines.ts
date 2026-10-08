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
  /** The task's real start lies before the visible window, so `left` is the
   * window edge, not the start. Only read when off-window stubs are enabled
   * (see BuildDependencyEdgesOptions). */
  startClipped?: boolean;
  /** The task's real end lies after the visible window, so `right` is the
   * window edge, not the end. Only read when off-window stubs are enabled. */
  endClipped?: boolean;
};

/** Where a task that has no measurable bar lies relative to the visible time
 * window: entirely before it (left) or entirely after it (right). */
export type OffWindowSide = "before" | "after";

export type BuildDependencyEdgesOptions = {
  /** Tasks that have a row but no bar inside the visible time window, by the
   * side of the window they lie on. Passing this map (even an empty one)
   * turns on off-window handling: an edge with ONE such endpoint, or one whose
   * anchored date is clipped by the window edge (TaskBarBox.startClipped /
   * endClipped), is drawn as a short stub on the endpoint that is on screen
   * (see DependencyEdgeStub) instead of a long line to the window edge. An
   * edge with both endpoints off-window is not drawn. Without this option an
   * edge with a missing box is skipped and clipped anchors are used as-is. */
  offWindowTasks?: ReadonlyMap<string, OffWindowSide>;
};

/** An edge whose far endpoint is not on screen: only the stub at the endpoint
 * that is on screen is drawn, and the overlay renders a jump chip for the
 * off-window task at `chipPoint`. */
export type DependencyEdgeStub = {
  /** Which end of the edge is off-window (the chip's task). */
  endpoint: "source" | "target";
  /** The off-window task. */
  taskId: string;
  /** Where that task lies relative to the visible window. */
  taskSide: OffWindowSide;
  /** Which of that task's dates the edge anchors to (the chip shows it). */
  anchorSide: "start" | "end";
  /** The stub's outer end, where the chip attaches. */
  chipPoint: { x: number; y: number };
  /** The direction the chip extends from `chipPoint`: -1 left, 1 right. */
  chipDir: 1 | -1;
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
  /** Which edge of the TARGET bar the connector arrives at. */
  targetSide?: "start" | "end";
  /** Set when an endpoint is off-window: the path is just a short stub. */
  stub?: DependencyEdgeStub | null;
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
// Horizontal distance between the trunks of different sources that would
// otherwise share (almost) the same x over an overlapping stretch of rows.
const CHANNEL_STEP_PX = 5;
// How many channel steps (each way) a trunk may move to dodge another one.
const MAX_CHANNEL_OFFSETS = 4;
// A finish-to-start target that starts at most this far BEFORE the source's
// exit edge still gets the compact "drop, then enter" route (short tasks that
// end and start on the same day); only a target that starts further left than
// this needs the above/below lane detour.
const COMPACT_BACKSTEP_PX = 24;
// The least straight run the compact route keeps in front of the target.
const MIN_COMPACT_RUN_PX = 6;
// How far past its preferred exit gap a trunk may be pushed to serve a target
// that is entered from the far side (ff/sf, or a backward ss).
const SAME_SIDE_TRUNK_PUSH_MAX_PX = 2 * EXIT_GAP;
// Length of the straight stub drawn at the on-screen end of an edge whose
// other endpoint is outside the visible time window.
export const DEPENDENCY_STUB_LENGTH_PX = 24;
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
  obstacles: readonly { left: number; right: number }[],
  // Where to sit when nothing blocks it; the midpoint of the range by
  // default. A shared trunk prefers the near end instead.
  preferred: number = rangeMin + (rangeMax - rangeMin) / 2,
): number {
  const defaultMid = clamp(preferred, rangeMin, rangeMax);
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

  // A finish-to-start target at (or only slightly before) the source's end,
  // nearer than the step's two exit gaps: go straight down/up and then right
  // into it instead of wrapping around both bars. "Slightly before" is the
  // short-task case (same-day start): up to COMPACT_BACKSTEP_PX left of the
  // source's end, as long as the target still starts inside the source's own
  // x-range. Only the end -> start anchoring qualifies; the other types keep
  // their routes.
  if (
    sourceSide === "end" &&
    targetSide === "start" &&
    (targetAnchorX >= sourceAnchorX ||
      (targetAnchorX >= sourceAnchorX - COMPACT_BACKSTEP_PX &&
        targetAnchorX - source.left >= MIN_COMPACT_RUN_PX))
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

// ---------------------------------------------------------------------------
// Shared-trunk routing (buildDependencyEdges)

type Resolved = {
  edge: DependencyEdgeInput;
  index: number;
  source: TaskBarBox;
  target: TaskBarBox;
  dependencyType: GanttDependencyType;
  lagDays: number;
  sourceSide: AnchorSide;
  targetSide: AnchorSide;
  points: Point[];
  kind: RouteKind | "trunk";
};

type TrunkCandidate = { item: Resolved; lo: number; hi: number };

// All the non-straight edges that leave one source from one anchor side. They
// share a single vertical trunk (and, for detours, one exit column and one
// lane per side). Positions are tracked in "u-space": x multiplied by the
// exit direction, so +u always points away from the source bar and one
// implementation serves both the end-anchored (right) and start-anchored
// (left) sides.
type SourceGroup = {
  sourceId: string;
  source: TaskBarBox;
  sourceSide: AnchorSide;
  items: Resolved[];
  members: Resolved[];
  loopers: Resolved[];
  hasTrunk: boolean;
  // The trunk's preferred u, and the interval it may move within.
  baseU: number;
  lowU: number;
  highU: number;
  // The rows the group's vertical runs span (for channel allocation).
  yMin: number;
  yMax: number;
  // Shared detour lanes (absolute y), when the group has detours.
  belowLaneY: number | null;
  aboveLaneY: number | null;
  shiftU: number;
};

type RowIndex = { sorted: TaskBarBox[]; maxHeight: number };

function buildRowIndex(boxes: readonly TaskBarBox[]): RowIndex {
  const sorted = [...boxes].sort((a, b) => a.top - b.top);
  let maxHeight = 0;
  for (const box of sorted) maxHeight = Math.max(maxHeight, box.height);
  return { sorted, maxHeight };
}

// The boxes whose row overlaps the open band (minY, maxY). Rows are disjoint
// horizontal bands, so a binary search on `top` finds the first candidate and
// the walk stops at the first row below the band: output-sensitive instead of
// scanning every box per source.
function boxesInBand(index: RowIndex, minY: number, maxY: number) {
  const from = minY - index.maxHeight;
  let lo = 0;
  let hi = index.sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (index.sorted[mid].top < from) lo = mid + 1;
    else hi = mid;
  }
  const found: TaskBarBox[] = [];
  for (let i = lo; i < index.sorted.length; i++) {
    const box = index.sorted[i];
    if (box.top >= maxY) break;
    if (box.top + box.height > minY) found.push(box);
  }
  return found;
}

// Channel offsets tried for a trunk, in order: stay, then alternate inward
// (toward the source bar) and outward, one CHANNEL_STEP_PX at a time.
const CHANNEL_OFFSET_ORDER: number[] = [0];
for (let step = 1; step <= MAX_CHANNEL_OFFSETS; step++) {
  CHANNEL_OFFSET_ORDER.push(-step, step);
}

// Decides each group's trunk: which edges it serves, where it sits, and the
// shared detour lanes for the edges it cannot serve. Does not place channels.
function planGroup(
  group: SourceGroup,
  rowIndex: RowIndex,
  allBoxes: TaskBarBox[],
) {
  const { source, sourceSide } = group;
  const sd = sideDir(sourceSide);
  const sourceY = verticalCenter(source);
  const sxu = anchorX(source, sourceSide) * sd;
  const innerU = sd === 1 ? source.left : -source.right;
  const outerU = sxu + EXIT_GAP;

  // A trunk at u serves an edge when the branch from the trunk into the
  // target is a forward, straight horizontal run of at least the arrow's
  // length (the compact minimum for a target that starts inside the source's
  // own x-range).
  //  - Target ahead of the source (entered from the source's side): the trunk
  //    must lie at or before the target's entry (txu - ARROW_RUN), and may sit
  //    anywhere back to the source bar's inner edge. A target that starts at
  //    most COMPACT_BACKSTEP_PX before the exit still qualifies (short tasks).
  //  - Target entered from the far side (ff/sf, backward ss): the trunk must
  //    lie beyond that entry, which may push it a little past the exit gap.
  const ahead: TrunkCandidate[] = [];
  const same: TrunkCandidate[] = [];
  for (const item of group.items) {
    const td = sideDir(item.targetSide);
    const txu = anchorX(item.target, item.targetSide) * sd;
    if (td === -sd) {
      if (
        txu >= sxu ||
        (txu - sxu >= -COMPACT_BACKSTEP_PX &&
          txu - innerU >= MIN_COMPACT_RUN_PX)
      ) {
        ahead.push({
          item,
          lo: innerU,
          hi: Math.max(innerU, txu - ARROW_RUN),
        });
      }
    } else {
      const lo = txu + ARROW_RUN;
      if (lo - outerU <= SAME_SIDE_TRUNK_PUSH_MAX_PX) {
        same.push({ item, lo, hi: Number.POSITIVE_INFINITY });
      }
    }
  }
  let high = Number.POSITIVE_INFINITY;
  for (const candidate of ahead) high = Math.min(high, candidate.hi);
  // Ahead targets take priority; a far-side target the trunk cannot reach
  // without passing an ahead target's entry keeps its own route.
  const acceptedSame = same.filter((candidate) => candidate.lo <= high);
  let low = innerU;
  for (const candidate of acceptedSame) low = Math.max(low, candidate.lo);

  const memberSet = new Set<Resolved>();
  for (const candidate of ahead) memberSet.add(candidate.item);
  for (const candidate of acceptedSame) memberSet.add(candidate.item);
  group.members = group.items.filter((item) => memberSet.has(item));
  group.loopers = group.items.filter((item) => !memberSet.has(item));
  group.hasTrunk = group.members.length > 0;

  let yMin = sourceY;
  let yMax = sourceY;
  for (const item of group.items) {
    const y = verticalCenter(item.target);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }

  if (group.hasTrunk) {
    // Nearest to the source, but not past the earliest forward target's entry.
    const preferred = clamp(Math.min(outerU, high), low, high);
    // Step around bars that sit in the rows the trunk passes through (never
    // the source or the targets it serves, whose rows it only reaches).
    let trunkMinY = sourceY;
    let trunkMaxY = sourceY;
    const served = new Set<TaskBarBox>();
    for (const item of group.members) {
      served.add(item.target);
      const y = verticalCenter(item.target);
      trunkMinY = Math.min(trunkMinY, y);
      trunkMaxY = Math.max(trunkMaxY, y);
    }
    const blocked = boxesInBand(rowIndex, trunkMinY, trunkMaxY)
      .filter((box) => box !== source && !served.has(box))
      .map((box) =>
        sd === 1
          ? { left: box.left, right: box.right }
          : { left: -box.right, right: -box.left },
      );
    const rangeHigh = Number.isFinite(high)
      ? high
      : Math.max(preferred, low) + SAME_SIDE_TRUNK_PUSH_MAX_PX;
    group.baseU = pickClearMidX(low, rangeHigh, blocked, preferred);
    group.lowU = low;
    group.highU = high;
  } else {
    group.baseU = outerU;
    group.lowU = sxu + 2;
    group.highU = Number.POSITIVE_INFINITY;
  }

  // Detours: one lane per side for the whole group (the farthest edge sets
  // it), so detours from one source overlap instead of fanning out.
  let below: number | null = null;
  let above: number | null = null;
  const legacy = new Map<Resolved, { points: Point[]; kind: RouteKind }>();
  for (const item of group.loopers) {
    const route = routeElbow(
      item.source,
      item.target,
      allBoxes,
      item.dependencyType,
      0,
    );
    legacy.set(item, route);
    if (route.kind !== "detour") continue;
    const laneY = route.points[2].y;
    if (laneY >= Math.max(sourceY, verticalCenter(item.target))) {
      below = below === null ? laneY : Math.max(below, laneY);
    } else {
      above = above === null ? laneY : Math.min(above, laneY);
    }
  }
  group.belowLaneY = below;
  group.aboveLaneY = above;
  if (below !== null) yMax = Math.max(yMax, below);
  if (above !== null) yMin = Math.min(yMin, above);
  group.yMin = yMin;
  group.yMax = yMax;
  return legacy;
}

// Greedy channel allocation. Groups are visited in source-id order; each takes
// the first offset from CHANNEL_OFFSET_ORDER whose x is at least
// CHANNEL_STEP_PX away from every already-placed trunk whose rows overlap its
// own. Placed trunks are bucketed by x so a probe only looks at the three
// neighbouring buckets. Cost: one sort, O(G log G), plus at most
// 1 + 2 * MAX_CHANNEL_OFFSETS probes per group, each scanning the few trunks
// in its x band; nothing is quadratic in the number of edges.
function assignChannels(groups: SourceGroup[]) {
  const placed = new Map<number, { x: number; y0: number; y1: number }[]>();
  const bucketOf = (x: number) => Math.round(x / CHANNEL_STEP_PX);
  const conflicts = (x: number, y0: number, y1: number) => {
    const bucket = bucketOf(x);
    for (let b = bucket - 1; b <= bucket + 1; b++) {
      for (const other of placed.get(b) ?? []) {
        if (
          Math.abs(other.x - x) < CHANNEL_STEP_PX - 1e-6 &&
          y0 <= other.y1 &&
          other.y0 <= y1
        ) {
          return true;
        }
      }
    }
    return false;
  };
  const ordered = [...groups].sort((a, b) =>
    a.sourceId < b.sourceId
      ? -1
      : a.sourceId > b.sourceId
        ? 1
        : a.sourceSide < b.sourceSide
          ? -1
          : a.sourceSide > b.sourceSide
            ? 1
            : 0,
  );
  for (const group of ordered) {
    const sd = sideDir(group.sourceSide);
    let shift = 0;
    for (const offset of CHANNEL_OFFSET_ORDER) {
      const u = group.baseU + offset * CHANNEL_STEP_PX;
      if (u < group.lowU || u > group.highU) continue;
      if (!conflicts(u * sd, group.yMin, group.yMax)) {
        shift = offset * CHANNEL_STEP_PX;
        break;
      }
    }
    group.shiftU = shift;
    const x = (group.baseU + shift) * sd;
    const bucket = bucketOf(x);
    const list = placed.get(bucket);
    const entry = { x, y0: group.yMin, y1: group.yMax };
    if (list) list.push(entry);
    else placed.set(bucket, [entry]);
  }
}

// Anchors each edge by its dependency type (finish-to-start by default —
// also always used for a "related" edge) and routes it as a rounded elbow
// through the gaps around bars rather than a straight diagonal across them.
//
// Rules that keep a dense plan readable:
//  - Shared trunk: every edge that leaves the same source from the same anchor
//    side runs along ONE vertical trunk at one exact x, so a source blocking
//    ten tasks draws one line with ten short branches, not ten parallel
//    verticals. The trunk sits next to the source (EXIT_GAP past its edge) but
//    never past the earliest forward target's entry minus ARROW_RUN, and steps
//    around bars in the rows it crosses. Each edge is: exit, trunk, its own
//    horizontal branch into its target.
//  - Compact route: a target that starts at (or slightly before) the source's
//    end, as short same-day tasks do, is entered from the trunk with the
//    straight arrow run instead of a U-turn. Only a target that truly starts
//    left of the source's exit keeps the above/below lane detour, and the
//    detours of one source share their exit column and lane.
//  - Channels: trunks of DIFFERENT sources whose x is within CHANNEL_STEP_PX
//    over an overlapping stretch of rows are moved into distinct channels, so
//    two sources never draw on top of one another.
//  - Labels: the type label (and lag label point) sits in the TARGET's row
//    beside the vertical run its branch leaves, on the side away from the
//    target bar, vertically centered on the row — never on the arrowhead or
//    the target bar. A same-row edge has no vertical run and keeps its label
//    beside the source bar.
//  - Off-window endpoints (only with `options.offWindowTasks`): see
//    BuildDependencyEdgesOptions and DependencyEdgeStub.
//
// Complexity: O(E log E) for the grouping, sorts and channel allocation (see
// assignChannels), plus an output-sensitive obstacle lookup per trunk (a
// binary search into the rows, then only the rows the trunk crosses).
export function buildDependencyEdges(
  edges: DependencyEdgeInput[],
  taskBoxes: ReadonlyMap<string, TaskBarBox>,
  options: BuildDependencyEdgesOptions = {},
): DependencyEdgeGeometry[] {
  const offWindow = options.offWindowTasks;
  const allBoxes = [...taskBoxes.values()];
  const rowIndex = buildRowIndex(allBoxes);

  type Endpoint = { box: TaskBarBox } | { off: OffWindowSide } | null;
  const endpointFor = (taskId: string, side: AnchorSide): Endpoint => {
    const box = taskBoxes.get(taskId);
    if (box) {
      if (offWindow) {
        // The anchored date is outside the window even though part of the bar
        // is visible: the box edge is the window edge, not the anchor.
        if (side === "start" && box.startClipped) return { off: "before" };
        if (side === "end" && box.endClipped) return { off: "after" };
      }
      return { box };
    }
    const off = offWindow?.get(taskId);
    return off ? { off } : null;
  };

  const out: (DependencyEdgeGeometry | null)[] = edges.map(() => null);
  const resolved: Resolved[] = [];
  const groups = new Map<string, SourceGroup>();

  edges.forEach((edge, index) => {
    // Dependency type/lag are only meaningful on a "blocks" edge — a
    // "related" edge keeps its original finish-to-start look regardless of
    // whatever the row it came from happens to store.
    const dependencyType: GanttDependencyType =
      edge.relationType === "blocks" ? (edge.dependencyType ?? "fs") : "fs";
    const lagDays = edge.relationType === "blocks" ? (edge.lagDays ?? 0) : 0;
    const { source: sourceSide, target: targetSide } =
      anchorSides(dependencyType);
    const sourceEnd = endpointFor(edge.sourceTaskId, sourceSide);
    const targetEnd = endpointFor(edge.targetTaskId, targetSide);
    if (!sourceEnd || !targetEnd) return;
    if ("off" in sourceEnd && "off" in targetEnd) return;

    if ("off" in sourceEnd && "box" in targetEnd) {
      // Source off-window: a short stub entering the target, chip at its far end.
      const box = targetEnd.box;
      const dir = sideDir(targetSide);
      const y = verticalCenter(box);
      const end = { x: anchorX(box, targetSide), y };
      const start = { x: end.x + dir * DEPENDENCY_STUB_LENGTH_PX, y };
      out[index] = {
        ...edge,
        path: roundedPolylinePath([start, end], CORNER_RADIUS),
        sourcePoint: start,
        targetPoint: end,
        lagLabelPoint: null,
        typeLabelPoint: null,
        targetSide,
        stub: {
          endpoint: "source",
          taskId: edge.sourceTaskId,
          taskSide: sourceEnd.off,
          anchorSide: sourceSide,
          chipPoint: start,
          chipDir: dir,
        },
      };
      return;
    }
    if ("off" in targetEnd && "box" in sourceEnd) {
      // Target off-window: a short stub leaving the source, chip at its end.
      const box = sourceEnd.box;
      const dir = sideDir(sourceSide);
      const y = verticalCenter(box);
      const start = { x: anchorX(box, sourceSide), y };
      const end = { x: start.x + dir * DEPENDENCY_STUB_LENGTH_PX, y };
      out[index] = {
        ...edge,
        path: roundedPolylinePath([start, end], CORNER_RADIUS),
        sourcePoint: start,
        targetPoint: end,
        lagLabelPoint: null,
        typeLabelPoint: null,
        targetSide,
        stub: {
          endpoint: "target",
          taskId: edge.targetTaskId,
          taskSide: targetEnd.off,
          anchorSide: targetSide,
          chipPoint: end,
          chipDir: dir,
        },
      };
      return;
    }
    if (!("box" in sourceEnd) || !("box" in targetEnd)) return;

    const source = sourceEnd.box;
    const target = targetEnd.box;
    const item: Resolved = {
      edge,
      index,
      source,
      target,
      dependencyType,
      lagDays,
      sourceSide,
      targetSide,
      points: [],
      kind: "straight",
    };
    resolved.push(item);

    const sourceY = verticalCenter(source);
    const targetY = verticalCenter(target);
    if (Math.abs(sourceY - targetY) < 0.5) {
      item.points = [
        { x: anchorX(source, sourceSide), y: sourceY },
        { x: anchorX(target, targetSide), y: targetY },
      ];
      return;
    }
    const key = `${edge.sourceTaskId}|${sourceSide}`;
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
    } else {
      groups.set(key, {
        sourceId: edge.sourceTaskId,
        source,
        sourceSide,
        items: [item],
        members: [],
        loopers: [],
        hasTrunk: false,
        baseU: 0,
        lowU: 0,
        highU: 0,
        yMin: 0,
        yMax: 0,
        belowLaneY: null,
        aboveLaneY: null,
        shiftU: 0,
      });
    }
  });

  const groupList = [...groups.values()];
  const legacyRoutes = new Map<
    SourceGroup,
    Map<Resolved, { points: Point[]; kind: RouteKind }>
  >();
  for (const group of groupList) {
    legacyRoutes.set(group, planGroup(group, rowIndex, allBoxes));
  }
  assignChannels(groupList);

  for (const group of groupList) {
    const { source, sourceSide } = group;
    const sd = sideDir(sourceSide);
    const sourceY = verticalCenter(source);
    const sourceX = anchorX(source, sourceSide);
    const sxu = sourceX * sd;
    const trunkX = (group.baseU + group.shiftU) * sd;
    const halfBar = Math.min(ASSUMED_BAR_HALF_HEIGHT_PX, source.height / 2);

    for (const item of group.members) {
      const targetY = verticalCenter(item.target);
      const targetPoint = {
        x: anchorX(item.target, item.targetSide),
        y: targetY,
      };
      // A trunk inside the source bar (the compact route) starts on the bar's
      // own top/bottom edge, like the old L route; a trunk beyond the edge
      // leaves the anchor horizontally first.
      item.points =
        group.baseU + group.shiftU >= sxu
          ? [
              { x: sourceX, y: sourceY },
              { x: trunkX, y: sourceY },
              { x: trunkX, y: targetY },
              targetPoint,
            ]
          : [
              {
                x: trunkX,
                y: targetY > sourceY ? sourceY + halfBar : sourceY - halfBar,
              },
              { x: trunkX, y: targetY },
              targetPoint,
            ];
      item.kind = "trunk";
    }

    const legacy = legacyRoutes.get(group);
    const exitX = Math.max(sxu + 2, sxu + EXIT_GAP + group.shiftU) * sd;
    for (const item of group.loopers) {
      const route = legacy?.get(item);
      if (!route) continue;
      item.kind = route.kind;
      if (route.kind !== "detour") {
        item.points = route.points;
        continue;
      }
      const laneY =
        route.points[2].y >= Math.max(sourceY, verticalCenter(item.target))
          ? (group.belowLaneY ?? route.points[2].y)
          : (group.aboveLaneY ?? route.points[2].y);
      const entryX =
        anchorX(item.target, item.targetSide) +
        EXIT_GAP * sideDir(item.targetSide);
      item.points = [
        route.points[0],
        { x: exitX, y: sourceY },
        { x: exitX, y: laneY },
        { x: entryX, y: laneY },
        { x: entryX, y: verticalCenter(item.target) },
        route.points[route.points.length - 1],
      ];
    }
  }

  for (const item of resolved) {
    const { edge, source, dependencyType, lagDays, points } = item;
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
        // point's x (the final segment is the edge's own horizontal branch),
        // so the label stays beside its own target's branch even when the
        // trunk is shared with other edges.
        const runX = points[points.length - 2].x;
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

    out[item.index] = {
      ...edge,
      path,
      sourcePoint,
      targetPoint,
      lagLabelPoint,
      typeLabelPoint,
      targetSide: item.targetSide,
      stub: null,
    };
  }

  return out.filter(
    (geometry): geometry is DependencyEdgeGeometry => geometry !== null,
  );
}
