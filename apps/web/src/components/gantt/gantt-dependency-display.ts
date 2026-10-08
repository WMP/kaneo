// Pure display rules for the Gantt dependency overlay: which edges are drawn
// for a display mode, which edges are "focused", when the dependency-type
// label is shown, and when the chart is dense enough to quiet unfocused
// edges. Kept free of React and the DOM so each rule is unit-testable.

import type { GanttDependencyType } from "./dependency-lines";

export const GANTT_DEPENDENCY_DISPLAY_MODES = [
  "all",
  "focused",
  "critical",
  "hidden",
] as const;
export type GanttDependencyDisplayMode =
  (typeof GANTT_DEPENDENCY_DISPLAY_MODES)[number];

export const DEFAULT_GANTT_DEPENDENCY_DISPLAY_MODE: GanttDependencyDisplayMode =
  "all";

export function isGanttDependencyDisplayMode(
  value: unknown,
): value is GanttDependencyDisplayMode {
  return GANTT_DEPENDENCY_DISPLAY_MODES.includes(
    value as GanttDependencyDisplayMode,
  );
}

/** Above this many rendered edges, unfocused edges rest at a lower opacity. */
export const DENSE_EDGE_THRESHOLD = 30;

/**
 * A target with MORE incoming edges than this (in the rendered set) does not
 * draw its unfocused incoming branches one by one: a small badge at its start
 * edge stands for them instead (see computeFanInCollapse).
 */
export const FAN_IN_COLLAPSE_THRESHOLD = 5;

type DisplayEdge = {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationType: "blocks" | "related";
  dependencyType?: GanttDependencyType;
  lagDays?: number;
};

/** An edge is focused when it touches the hovered or the pinned task. */
export function isEdgeFocused(
  edge: Pick<DisplayEdge, "sourceTaskId" | "targetTaskId">,
  hoveredTaskId: string | null,
  pinnedTaskId: string | null,
): boolean {
  for (const taskId of [hoveredTaskId, pinnedTaskId]) {
    if (
      taskId !== null &&
      (edge.sourceTaskId === taskId || edge.targetTaskId === taskId)
    ) {
      return true;
    }
  }
  return false;
}

/** The edges a display mode draws. */
export function filterEdgesForDisplayMode<T extends DisplayEdge>(
  edges: readonly T[],
  mode: GanttDependencyDisplayMode,
  context: {
    hoveredTaskId: string | null;
    pinnedTaskId: string | null;
    criticalEdgeIds?: ReadonlySet<string>;
  },
): T[] {
  switch (mode) {
    case "hidden":
      return [];
    case "focused":
      return edges.filter((edge) =>
        isEdgeFocused(edge, context.hoveredTaskId, context.pinnedTaskId),
      );
    case "critical":
      return edges.filter(
        (edge) => context.criticalEdgeIds?.has(edge.id) ?? false,
      );
    default:
      return [...edges];
  }
}

/**
 * Whether an edge's dependency-type label is rendered. A plain finish-to-start
 * edge with no lag is the default and says nothing, so its label is only shown
 * while the edge is focused (so it stays editable from the chart).
 */
export function shouldShowTypeLabel(
  edge: Pick<DisplayEdge, "dependencyType" | "lagDays">,
  focused: boolean,
): boolean {
  const isPlainFinishToStart =
    (edge.dependencyType ?? "fs") === "fs" && (edge.lagDays ?? 0) === 0;
  return focused || !isPlainFinishToStart;
}

export type FanInBadge = {
  /** Stable key: the target and the bar edge its branches arrive at. */
  key: string;
  targetTaskId: string;
  side: "start" | "end";
  /** How many incoming edges the badge stands for (the collapsed ones). */
  count: number;
  /** Where the collapsed branches would have arrived: the target's anchor. */
  point: { x: number; y: number };
};

type FanInEdge = DisplayEdge & {
  targetSide?: "start" | "end";
  targetPoint: { x: number; y: number };
  /** An edge whose TARGET is off-window is only a stub out of its source:
   * there is no target anchor to fold it into. */
  stub?: { endpoint: "source" | "target" } | null;
};

/**
 * Which incoming edges are folded into a fan-in badge. A target (per bar edge)
 * with more than FAN_IN_COLLAPSE_THRESHOLD incoming edges among `edges` (the
 * rendered set) collapses every incoming edge that is not focused (touching
 * the hovered or pinned task, so hovering the target or one of its sources
 * shows that edge in full), not on the critical path and not violated. Those
 * three kinds are never collapsed. Linear in the number of edges.
 */
export function computeFanInCollapse<T extends FanInEdge>(
  edges: readonly T[],
  context: {
    hoveredTaskId: string | null;
    pinnedTaskId: string | null;
    criticalEdgeIds?: ReadonlySet<string>;
    violatedEdgeIds?: ReadonlySet<string>;
  },
): { collapsedEdgeIds: Set<string>; badges: FanInBadge[] } {
  const byTarget = new Map<string, T[]>();
  for (const edge of edges) {
    if (edge.stub?.endpoint === "target") continue;
    const key = `${edge.targetTaskId}|${edge.targetSide ?? "start"}`;
    const group = byTarget.get(key);
    if (group) group.push(edge);
    else byTarget.set(key, [edge]);
  }

  const collapsedEdgeIds = new Set<string>();
  const badges: FanInBadge[] = [];
  for (const [key, group] of byTarget) {
    if (group.length <= FAN_IN_COLLAPSE_THRESHOLD) continue;
    const collapsed = group.filter(
      (edge) =>
        !isEdgeFocused(edge, context.hoveredTaskId, context.pinnedTaskId) &&
        !(context.criticalEdgeIds?.has(edge.id) ?? false) &&
        !(
          edge.relationType === "blocks" &&
          (context.violatedEdgeIds?.has(edge.id) ?? false)
        ),
    );
    if (collapsed.length === 0) continue;
    for (const edge of collapsed) collapsedEdgeIds.add(edge.id);
    badges.push({
      key,
      targetTaskId: collapsed[0].targetTaskId,
      side: collapsed[0].targetSide ?? "start",
      count: collapsed.length,
      point: collapsed[0].targetPoint,
    });
  }
  return { collapsedEdgeIds, badges };
}
