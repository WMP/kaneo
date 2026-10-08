// Pure assembly of the critical-path (CPM) input for the project Gantt. Kept
// free of React and the DOM so the participation rules are unit-testable.
//
// PROJECTION. The critical path runs over three kinds of rows:
//  - this project's own scheduled tasks (own dates, or an estimate plus
//    exactly one own date);
//  - dated cross-project far ends of "blocks" edges;
//  - DERIVED rows: tasks with no dates of their own whose display position is
//    computed from their predecessors plus estimate (gantt-derived-schedule.ts)
//    — the same spans the chart draws. Their schedule is a projection, never
//    persisted, and they take part in the critical path only (not in the
//    cascade or in violated-edge detection).
//
// A row that is not an own scheduled task (a far end or a derived row) only
// participates when a "blocks" edge connects it to another participating row.
// Otherwise it would reach computeCriticalPath with no in-scope edge, and a
// lone task is never a meaningful critical link. The edge is then simply
// counted as dropped (CriticalPathResult.droppedEdgeCount), which is also how
// an endpoint that cannot be placed at all (no dates and no placed
// predecessor, a cycle, archived) is reported.

import type {
  CriticalPathEdgeInput,
  CriticalPathResult,
  CriticalPathTaskInput,
} from "./gantt-critical-path";

export type CriticalPathExternalRow = {
  id: string;
  scheduleStart: Date;
  scheduleEnd: Date;
  /** True for a row placed by dependency + estimate rather than by dates. */
  isDerived?: boolean;
};

export type CriticalPathInput = {
  tasks: CriticalPathTaskInput[];
  /** Ids of the participating rows whose schedule is a projection. */
  derivedTaskIds: ReadonlySet<string>;
};

export function buildCriticalPathInput({
  ownSchedules,
  externalRows,
  edges,
}: {
  ownSchedules: ReadonlyMap<string, { start: Date; end: Date }>;
  externalRows: readonly CriticalPathExternalRow[];
  edges: readonly CriticalPathEdgeInput[];
}): CriticalPathInput {
  const candidates = new Map<string, CriticalPathTaskInput>();
  for (const [id, schedule] of ownSchedules) {
    candidates.set(id, {
      id,
      scheduleStart: schedule.start,
      scheduleEnd: schedule.end,
    });
  }
  const derivedCandidateIds = new Set<string>();
  for (const row of externalRows) {
    // An own dated task is already a candidate and keeps its real schedule.
    if (candidates.has(row.id)) continue;
    candidates.set(row.id, {
      id: row.id,
      scheduleStart: row.scheduleStart,
      scheduleEnd: row.scheduleEnd,
    });
    if (row.isDerived) derivedCandidateIds.add(row.id);
  }

  // Rows connected to another candidate by a "blocks" edge. A removed row has,
  // by definition, no edge to a candidate, so no other row loses its only
  // neighbor and one pass is exact.
  const connected = new Set<string>();
  for (const edge of edges) {
    if (edge.sourceTaskId === edge.targetTaskId) continue;
    if (!candidates.has(edge.sourceTaskId)) continue;
    if (!candidates.has(edge.targetTaskId)) continue;
    connected.add(edge.sourceTaskId);
    connected.add(edge.targetTaskId);
  }

  const tasks: CriticalPathTaskInput[] = [];
  const derivedTaskIds = new Set<string>();
  for (const [id, task] of candidates) {
    const isOwn = ownSchedules.has(id);
    if (!isOwn && !connected.has(id)) continue;
    tasks.push(task);
    if (derivedCandidateIds.has(id)) derivedTaskIds.add(id);
  }
  return { tasks, derivedTaskIds };
}

/** Whether the highlighted critical path runs through at least one derived
 * (projected) row. */
export function isCriticalPathProjected(
  result: Pick<CriticalPathResult, "criticalTaskIds"> | null,
  derivedTaskIds: ReadonlySet<string>,
): boolean {
  if (!result) return false;
  for (const id of result.criticalTaskIds) {
    if (derivedTaskIds.has(id)) return true;
  }
  return false;
}
