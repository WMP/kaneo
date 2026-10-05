// Pure "derive a display position for an undated dependency successor" math for
// the Gantt. Kept free of React, the DOM and the network — like the rest of
// this folder's pure modules (gantt-dependency-cascade.ts, dependency-lines.ts,
// ...) — so it is unit-testable directly and the Gantt route only turns its
// result into extra read-only rows.
//
// WHY THIS EXISTS
// A "blocks" relation is directional: with the default Finish-to-Start (FS)
// dependency the successor starts once its predecessor finishes, so a user can
// legitimately leave the successor with NO start date of its own and expect the
// Gantt to place it right after the predecessor. Before this module the Gantt
// simply dropped every task with no own dates (see deriveTaskSchedule returning
// null), so such a dependency — including a cross-project one whose far end has
// no dates — had no bar to land its line on and was invisible. This module
// computes a DISPLAY-ONLY schedule for those undated successors from their
// dated predecessors.
//
// MODEL (deliberately the simplest one that stays correct — see AGENTS.md):
//  - DISPLAY ONLY. Nothing here is persisted. The successor keeps having no
//    stored dates; this only decides where to DRAW its read-only bar so the
//    dependency line is visible. Server-side cross-project scheduling is a
//    separate, still-pending decision (DEC-SCHED-03).
//  - A successor is placed only when it has NO own schedule at all (neither
//    start nor due — a task with either already gets a real bar via
//    deriveTaskSchedule) AND at least one of its incoming "blocks" predecessors
//    has a schedule. The candidate may belong to the project on screen or to
//    another project of the workspace; the math is the same.
//  - CHAINING. A predecessor may itself be a derived (undated) successor, but
//    only a SIZED one: A (dated) -> B (undated, with an estimate) -> C
//    (undated) places B first, then C from B's derived span. A derived marker
//    with no estimate has no known span, so it is a placeholder to draw, not a
//    schedule to build on: its own successors are not placed from it (they stay
//    unplaced, exactly as before chaining existed). Candidates are processed in
//    dependency order (Kahn's algorithm over the candidate-to-candidate edges).
//    A candidate that sits on a cycle — or downstream of one — is never reached
//    and stays unplaced; "blocks" creation rejects cycles, so this is only a
//    defensive bound.
//  - DURATION. With no estimate the candidate is a ZERO-DURATION POINT: a
//    single-day marker at its derived anchor (start === end), rendered like
//    any other single-date task. With an effort estimate the bar spans
//    `max(1, ceil(estimateMinutes / WORK_DAY_MINUTES))` days — working days
//    only when `isWorkingDay` is given (non-working days are skipped when
//    extending the end), plain calendar days otherwise. The estimate never
//    touches a task that has dates of its own.
//  - ANCHORS match edgeForcedDeltaDays in gantt-dependency-cascade.ts, i.e.
//    the same day arithmetic the cascade uses when it pushes a dated
//    successor. Finish-to-start therefore means the successor STARTS ON the
//    predecessor's end day plus the lag (end + lag, not end + 1 + lag): with
//    lag 0 they share that calendar day, exactly like a cascaded bar.
//      fs: successor start = predecessor.end   + lag
//      ss: successor start = predecessor.start + lag
//      ff: successor end   = predecessor.end   + lag  (start counted backwards)
//      sf: successor end   = predecessor.start + lag  (start counted backwards)
//  - LATEST CONSTRAINT WINS. With several predecessors every edge is turned
//    into the earliest START it allows (an end-anchored edge counts the
//    duration backwards) and the latest start wins — the same forward-only
//    intuition as the cascade: a successor can't start before every
//    predecessor's constraint is met.
//  - WORKING-CALENDAR NUDGE (opt-in via `isWorkingDay`): an anchor that lands
//    on a non-working day is nudged FORWARD to the next working day, matching
//    computeDependencyCascade's own nudge so a derived bar and a cascaded one
//    sit on the same day grid. Omitted: no nudging.

import { estimateToWorkingDays } from "@/lib/estimate";
import type {
  CascadeDependencyType,
  CascadeEdge,
} from "./gantt-dependency-cascade";
import { addWorkingDays, MAX_WALK_DAYS } from "./gantt-estimated-span";

export type DerivedScheduleSource = {
  start: Date;
  end: Date;
};

export type DeriveUndatedSuccessorSchedulesInput = {
  /** "blocks" edges only — any other relation type (e.g. "related", "subtask")
   * must be filtered out by the caller, exactly like the cascade's `edges`. */
  edges: readonly CascadeEdge[];
  /** Every task that has a REAL (dated) schedule, keyed by id — this project's
   * own dated tasks plus every dated cross-project relation endpoint. Only
   * these can anchor a derivation. */
  datedScheduleById: ReadonlyMap<string, DerivedScheduleSource>;
  /** The ids of tasks that have NO own schedule but are relation endpoints the
   * caller could draw if a position were found (own undated tasks and undated
   * cross-project endpoints). A candidate present in `datedScheduleById` is
   * ignored — it already has a real bar. */
  undatedCandidateIds: Iterable<string>;
  /** Workspace working-calendar predicate (see gantt-working-calendar.ts).
   * When set, a derived anchor on a non-working day is nudged forward to the
   * next working day. Omitted: no nudge. */
  isWorkingDay?: (d: Date) => boolean;
  /** Effort estimate in minutes per candidate id (null/undefined/invalid = no
   * estimate). Gives a candidate a bar length instead of a single-day marker. */
  estimateMinutesById?: ReadonlyMap<string, number | null | undefined>;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDaysExact(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

// How a "blocks" edge constrains its successor, from a placed predecessor:
// either the successor's START may not be earlier than `date` ("start"), or its
// END may not be earlier than `date` ("end"). Matches edgeForcedDeltaDays in
// gantt-dependency-cascade.ts:
//   fs: start >= predecessor.end   + lag
//   ss: start >= predecessor.start + lag
//   ff: end   >= predecessor.end   + lag
//   sf: end   >= predecessor.start + lag
type EdgeConstraint = { kind: "start" | "end"; date: Date };

function edgeConstraint(
  dependencyType: CascadeDependencyType,
  source: DerivedScheduleSource,
  lagDays: number,
): EdgeConstraint | null {
  switch (dependencyType) {
    case "fs":
      return { kind: "start", date: addDaysExact(source.end, lagDays) };
    case "ss":
      return { kind: "start", date: addDaysExact(source.start, lagDays) };
    case "ff":
      return { kind: "end", date: addDaysExact(source.end, lagDays) };
    case "sf":
      return { kind: "end", date: addDaysExact(source.start, lagDays) };
    default:
      // Unreachable for the typed union, but a relation's dependencyType is
      // cast from a server string at the call site, so skip an unknown type
      // (dropping the edge) rather than guessing a wrong anchor — matching how
      // the cascade's edgeForcedDeltaDays ignores an unrecognized type.
      return null;
  }
}

// A valid estimate is a finite, non-negative number of minutes; anything else
// (null, undefined, NaN, negative) means "no estimate" and keeps the marker.
function usableEstimate(minutes: number | null | undefined): number | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) return null;
  return minutes >= 0 ? minutes : null;
}

/**
 * Computes a display-only schedule for each undated candidate that is the
 * successor of at least one placed "blocks" predecessor (dated, or itself
 * derived earlier in dependency order). Returns a map of taskId ->
 * { start, end }: a single-day marker (start === end) without an estimate, or
 * a bar spanning the estimate in working days with one. A candidate with no
 * placed predecessor — or one that already has a real schedule — is absent from
 * the result, so the caller leaves it out exactly as before.
 */
export function deriveUndatedSuccessorSchedules({
  edges,
  datedScheduleById,
  undatedCandidateIds,
  isWorkingDay,
  estimateMinutesById,
}: DeriveUndatedSuccessorSchedulesInput): Map<string, DerivedScheduleSource> {
  const derived = new Map<string, DerivedScheduleSource>();
  // Derived candidates that carry an estimate: the only derived tasks that may
  // anchor a further candidate.
  const sizedDerived = new Set<string>();

  const candidates = new Set<string>();
  for (const id of undatedCandidateIds) {
    // A candidate that already has a real bar is never overridden by a derived
    // one — its own dates always win.
    if (datedScheduleById.has(id)) continue;
    candidates.add(id);
  }
  if (candidates.size === 0) return derived;

  const nudgeToWorkingDay = (date: Date): Date => {
    if (!isWorkingDay) return date;
    let nudgeDays = 0;
    while (
      nudgeDays < MAX_WALK_DAYS &&
      !isWorkingDay(addDaysExact(date, nudgeDays))
    ) {
      nudgeDays++;
    }
    return nudgeDays > 0 ? addDaysExact(date, nudgeDays) : date;
  };

  // Moves `steps` WORKING days away from `date` (`direction` 1 = later, -1 =
  // earlier), landing on a working day; plain calendar days without a calendar.
  const stepWorkingDays = (
    date: Date,
    steps: number,
    direction: 1 | -1,
  ): Date => addWorkingDays(date, steps, direction, isWorkingDay);

  // Incoming "blocks" edges per candidate, and the candidate-to-candidate
  // successors used to process chains in dependency order. An edge whose
  // source is neither dated nor a candidate can never anchor anything and is
  // dropped.
  const incomingByTarget = new Map<string, CascadeEdge[]>();
  const outgoingToCandidates = new Map<string, string[]>();
  const pendingPredecessors = new Map<string, number>();
  for (const id of candidates) pendingPredecessors.set(id, 0);

  for (const edge of edges) {
    if (edge.sourceTaskId === edge.targetTaskId) continue;
    if (!candidates.has(edge.targetTaskId)) continue;
    const sourceIsCandidate = candidates.has(edge.sourceTaskId);
    if (!sourceIsCandidate && !datedScheduleById.has(edge.sourceTaskId)) {
      continue;
    }
    const list = incomingByTarget.get(edge.targetTaskId);
    if (list) list.push(edge);
    else incomingByTarget.set(edge.targetTaskId, [edge]);

    if (sourceIsCandidate) {
      const successors = outgoingToCandidates.get(edge.sourceTaskId);
      if (successors) successors.push(edge.targetTaskId);
      else outgoingToCandidates.set(edge.sourceTaskId, [edge.targetTaskId]);
      pendingPredecessors.set(
        edge.targetTaskId,
        (pendingPredecessors.get(edge.targetTaskId) ?? 0) + 1,
      );
    }
  }

  const placeCandidate = (taskId: string) => {
    const incoming = incomingByTarget.get(taskId);
    if (!incoming) return;

    const estimate = usableEstimate(estimateMinutesById?.get(taskId));
    const durationDays =
      estimate === null ? 1 : estimateToWorkingDays(estimate);
    // Working days the bar extends past its first day.
    const extraDays = durationDays - 1;

    // Latest constraint wins, compared as the earliest START each edge allows.
    let start: Date | null = null;
    for (const edge of incoming) {
      // A dated predecessor, or a derived one that has an estimate (see
      // CHAINING above); an unplaced or estimate-less one contributes nothing.
      const source = sizedDerived.has(edge.sourceTaskId)
        ? derived.get(edge.sourceTaskId)
        : datedScheduleById.get(edge.sourceTaskId);
      if (!source) continue;
      const constraint = edgeConstraint(
        edge.dependencyType,
        source,
        edge.lagDays,
      );
      if (constraint === null) continue;

      // Never land on a day nobody works: walk forward to the next working
      // day, then (for an end constraint) count the duration backwards.
      const nudged = nudgeToWorkingDay(constraint.date);
      const earliestStart =
        constraint.kind === "start"
          ? nudged
          : stepWorkingDays(nudged, extraDays, -1);
      if (start === null || earliestStart > start) start = earliestStart;
    }
    if (start === null) return;

    derived.set(taskId, {
      start,
      end: stepWorkingDays(start, extraDays, 1),
    });
    if (estimate !== null) sizedDerived.add(taskId);
  };

  // Kahn's algorithm over the candidate graph: a candidate is placed once every
  // candidate predecessor has been processed (placed or found unplaceable).
  const ready: string[] = [];
  for (const [id, pending] of pendingPredecessors) {
    if (pending === 0) ready.push(id);
  }
  for (let index = 0; index < ready.length; index++) {
    const taskId = ready[index];
    if (taskId === undefined) break;
    placeCandidate(taskId);
    for (const successor of outgoingToCandidates.get(taskId) ?? []) {
      const remaining = (pendingPredecessors.get(successor) ?? 0) - 1;
      pendingPredecessors.set(successor, remaining);
      if (remaining === 0) ready.push(successor);
    }
  }
  // Anything still pending sits on a cycle (or downstream of one) and is left
  // unplaced rather than guessed at.

  return derived;
}
