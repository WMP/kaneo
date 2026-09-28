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
//    has a real (dated) schedule.
//  - DATED PREDECESSORS ONLY. A derived schedule is computed from predecessors
//    that already have real dates; it deliberately does NOT chain through other
//    derived (undated) successors. A successor whose only predecessor is itself
//    undated stays unplaced — the same "no anchor, no row" fallback the Gantt
//    already applies. This keeps the pass single-level and free of ordering
//    questions; a deeper chain can be added later if a real need appears.
//  - ZERO-DURATION POINT. An undated successor has no known span, so it is
//    drawn as a single-day marker at its derived anchor rather than inventing a
//    duration. start === end; the caller renders that exactly like any other
//    single-date task (a one-day bar / a milestone diamond).
//  - LATEST CONSTRAINT WINS. With several dated predecessors the anchor is the
//    latest of each edge's required date — the same forward-only intuition as
//    the cascade (a successor can't start before every predecessor's constraint
//    is met).
//  - WORKING-CALENDAR NUDGE (opt-in via `isWorkingDay`): if the derived anchor
//    lands on a non-working day it is nudged FORWARD to the next working day,
//    matching computeDependencyCascade's own nudge so a derived bar and a
//    cascaded one sit on the same day grid. Omitted: no nudging.

import type {
  CascadeDependencyType,
  CascadeEdge,
} from "./gantt-dependency-cascade";

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
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDaysExact(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

// The single date an undated successor's marker should sit on for one edge from
// a dated predecessor. A zero-duration successor has start === end, so the two
// "finish-anchored" (ff/sf) and two "start-anchored" (fs/ss... ) cases all
// reduce to one point; the switch keeps each dependency type explicit and
// matches edgeForcedDeltaDays in gantt-dependency-cascade.ts:
//   fs: successor starts at predecessor.end + lag
//   ss: successor starts at predecessor.start + lag
//   ff: successor ends   at predecessor.end + lag   (== start, zero duration)
//   sf: successor ends   at predecessor.start + lag (== start, zero duration)
function edgeAnchorDate(
  dependencyType: CascadeDependencyType,
  source: DerivedScheduleSource,
  lagDays: number,
): Date {
  switch (dependencyType) {
    case "fs":
    case "ff":
      return addDaysExact(source.end, lagDays);
    case "ss":
    case "sf":
      return addDaysExact(source.start, lagDays);
    default:
      return source.end;
  }
}

/**
 * Computes a display-only single-day schedule for each undated candidate that
 * is the successor of at least one dated "blocks" predecessor. Returns a map of
 * taskId -> { start, end } with start === end (a zero-duration marker at the
 * derived anchor). A candidate with no dated predecessor — or one that already
 * has a real schedule — is absent from the result, so the caller leaves it out
 * exactly as before.
 */
export function deriveUndatedSuccessorSchedules({
  edges,
  datedScheduleById,
  undatedCandidateIds,
  isWorkingDay,
}: DeriveUndatedSuccessorSchedulesInput): Map<string, DerivedScheduleSource> {
  const derived = new Map<string, DerivedScheduleSource>();

  const candidates = new Set<string>();
  for (const id of undatedCandidateIds) {
    // A candidate that already has a real bar is never overridden by a derived
    // one — its own dates always win.
    if (datedScheduleById.has(id)) continue;
    candidates.add(id);
  }
  if (candidates.size === 0) return derived;

  // Incoming "blocks" edges per target, keeping only those whose SOURCE is
  // dated (an undated source can't anchor anything here — see the model note).
  const incomingByTarget = new Map<string, CascadeEdge[]>();
  for (const edge of edges) {
    if (edge.sourceTaskId === edge.targetTaskId) continue;
    if (!candidates.has(edge.targetTaskId)) continue;
    if (!datedScheduleById.has(edge.sourceTaskId)) continue;
    const list = incomingByTarget.get(edge.targetTaskId);
    if (list) list.push(edge);
    else incomingByTarget.set(edge.targetTaskId, [edge]);
  }

  for (const [taskId, incoming] of incomingByTarget) {
    // Latest constraint wins: a successor can only sit at or after the date
    // every one of its dated predecessors requires.
    let anchor: Date | null = null;
    for (const edge of incoming) {
      const source = datedScheduleById.get(edge.sourceTaskId);
      if (!source) continue; // Guarded above, but keeps the type narrowed.
      const candidateAnchor = edgeAnchorDate(
        edge.dependencyType,
        source,
        edge.lagDays,
      );
      if (anchor === null || candidateAnchor > anchor) anchor = candidateAnchor;
    }
    if (anchor === null) continue;

    // Working-calendar nudge: never land the marker on a day nobody works —
    // walk forward to the next working day, matching computeDependencyCascade.
    if (isWorkingDay) {
      let nudgeDays = 0;
      while (
        nudgeDays < 366 &&
        !isWorkingDay(addDaysExact(anchor, nudgeDays))
      ) {
        nudgeDays++;
      }
      if (nudgeDays > 0) anchor = addDaysExact(anchor, nudgeDays);
    }

    derived.set(taskId, { start: anchor, end: anchor });
  }

  return derived;
}
