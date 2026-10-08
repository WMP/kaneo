// Pure detection of "blocks" dependency edges whose constraint is currently
// broken by the tasks' dates (a successor scheduled earlier than its
// predecessor allows). Uses the same per-edge rule as the dependency cascade,
// so an edge is flagged exactly when the cascade would move its target later.

import {
  type CascadeEdge,
  type CascadeSchedule,
  edgeForcedDeltaDays,
} from "./gantt-dependency-cascade";

export type ViolationCheckEdge = CascadeEdge & {
  id: string;
  relationType: "blocks" | "related";
};

/**
 * Ids of "blocks" edges that violate their own constraint. An edge whose
 * endpoint has no resolved schedule is never flagged (nothing to compare), and
 * "related" edges carry no scheduling meaning.
 */
export function computeViolatedDependencyEdgeIds(
  edges: readonly ViolationCheckEdge[],
  scheduleByTaskId: ReadonlyMap<string, CascadeSchedule>,
): Set<string> {
  const violated = new Set<string>();
  for (const edge of edges) {
    if (edge.relationType !== "blocks") continue;
    if (edge.sourceTaskId === edge.targetTaskId) continue;
    const source = scheduleByTaskId.get(edge.sourceTaskId);
    const target = scheduleByTaskId.get(edge.targetTaskId);
    if (!source || !target) continue;
    if (edgeForcedDeltaDays(edge, source, target) > 0) violated.add(edge.id);
  }
  return violated;
}
