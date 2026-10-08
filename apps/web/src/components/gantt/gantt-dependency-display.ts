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
