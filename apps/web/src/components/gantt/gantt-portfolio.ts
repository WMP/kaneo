// Pure data-shaping for the portfolio (multi-project) timeline: turns the
// raw GET /project/portfolio payload into per-project rows the route can
// render, reusing the same schedule-derivation and rollup math the
// per-project Gantt already relies on (timeline.ts, gantt-hierarchy.ts)
// rather than re-deriving either. Kept free of React and the DOM, like the
// rest of this folder's pure modules, so it's unit-testable directly.

import type { DependencyEdgeInput } from "./dependency-lines";
import type {
  CascadeDependencyType,
  CascadeEdge,
} from "./gantt-dependency-cascade";
import { deriveUndatedSuccessorSchedules } from "./gantt-derived-schedule";
import { deriveTaskScheduleWithEstimate } from "./gantt-estimated-span";
import {
  computeParentSummaryProgress,
  computeParentSummarySpans,
  type GanttHierarchy,
  type ScheduleSpan,
} from "./gantt-hierarchy";

export type PortfolioTaskInput = {
  id: string;
  title: string;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  /** Effort estimate in minutes (null/omitted = none). Sizes an estimated
   * single-date task and a derived (dateless) successor, like on the project
   * Gantt. */
  estimateMinutes?: number | null;
  estimateUnit?: string;
  isMilestone: boolean;
  status: string;
};

export type PortfolioProjectInput = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  tasks: PortfolioTaskInput[];
};

export type ScheduledPortfolioTask = {
  id: string;
  title: string;
  progress: number;
  isMilestone: boolean;
  status: string;
  scheduleStart: Date;
  scheduleEnd: Date;
  /** True when the task has NO dates of its own and its position was derived
   * from its incoming `blocks` dependencies (display only, nothing is stored;
   * see gantt-derived-schedule.ts). Such a task is drawn read-only with the
   * project Gantt's dotted treatment and is left out of the project rollup. */
  isDerived: boolean;
  estimateMinutes: number | null;
  estimateUnit: string | undefined;
};

export type PortfolioProjectRow = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  /** This project's tasks that have a schedule, in the order the API returns
   * them (start date, due date, title), followed by the derived (dateless)
   * successors ordered by their derived start. A task with neither date and no
   * placed predecessor has no position to plot and is left out — same as the
   * per-project Gantt. */
  tasks: ScheduledPortfolioTask[];
  /** Tasks left out of `tasks` because they have no schedule at all (the
   * server already excludes archived tasks entirely). Lets the route say
   * "3 tasks, none scheduled yet" instead of reading as an empty project. */
  unscheduledCount: number;
  /** The project's overall rolled-up span across its own DATED tasks (derived
   * rows are display-only and never roll up, as on the per-project Gantt) —
   * the same duration-weighted rollup the per-project Gantt uses for a
   * parent task's summary bar (gantt-hierarchy.ts), applied here by treating
   * the project itself as the "parent" and its tasks as the "children". Null
   * when the project has no scheduled tasks at all. */
  summarySpan: ScheduleSpan | null;
  /** Duration-weighted average progress across the same scheduled tasks;
   * null under the same condition as summarySpan. */
  summaryProgress: number | null;
};

/** A project's tasks are hidden from the shared timeline once archived
 * (matches the board/per-project Gantt hiding archived work by default);
 * the server already drops these, but the check is kept here too so this
 * module has one source of truth regardless of caller. */
const HIDDEN_TASK_STATUS = "archived";

export type BuildPortfolioRowsOptions = {
  /** The payload's `undatedSuccessorDependencies`: `blocks` edges (same- or
   * cross-project) into tasks that have no dates. Without them no task is
   * derived. */
  derivationDependencies?: readonly PortfolioDependencyInput[];
  /** Workspace working-calendar predicate (gantt-working-calendar.ts), shared
   * with the per-project Gantt so a task lands on the same days in both. */
  isWorkingDay?: (d: Date) => boolean;
};

export function buildPortfolioRows(
  projects: readonly PortfolioProjectInput[],
  { derivationDependencies = [], isWorkingDay }: BuildPortfolioRowsOptions = {},
): PortfolioProjectRow[] {
  // One fake "hierarchy" for the whole call: each project is a parent, its
  // scheduled tasks are children. This lets computeParentSummarySpans/
  // computeParentSummaryProgress (built for a parent *task*'s rollup bar)
  // compute each *project*'s rollup here too, instead of a second
  // hand-rolled average.
  const childrenByParentId = new Map<string, string[]>();
  const ownSpanByTaskId = new Map<string, ScheduleSpan>();
  const progressByTaskId = new Map<string, number>();

  // Dateless tasks: candidates for a derived position, resolved in ONE pass
  // over every project below (a predecessor may sit in another project).
  const undatedByTaskId = new Map<
    string,
    { task: PortfolioTaskInput; projectIndex: number }
  >();
  const estimateMinutesById = new Map<string, number | null | undefined>();

  const partialRows: Omit<
    PortfolioProjectRow,
    "summarySpan" | "summaryProgress"
  >[] = [];

  for (const project of projects) {
    const tasks: ScheduledPortfolioTask[] = [];
    const childIds: string[] = [];
    const projectIndex = partialRows.length;

    for (const task of project.tasks) {
      if (task.status === HIDDEN_TASK_STATUS) continue;
      // The same span the project Gantt draws: a task with an estimate and
      // exactly one own date is sized by the estimate, not a one-day marker.
      const schedule = deriveTaskScheduleWithEstimate(task, isWorkingDay);
      if (!schedule) {
        undatedByTaskId.set(task.id, { task, projectIndex });
        estimateMinutesById.set(task.id, task.estimateMinutes);
        continue;
      }
      tasks.push({
        id: task.id,
        title: task.title,
        progress: task.progress,
        isMilestone: task.isMilestone,
        status: task.status,
        scheduleStart: schedule.start,
        scheduleEnd: schedule.end,
        isDerived: false,
        estimateMinutes: task.estimateMinutes ?? null,
        estimateUnit: task.estimateUnit,
      });
      childIds.push(task.id);
      ownSpanByTaskId.set(task.id, schedule);
      progressByTaskId.set(task.id, task.progress);
    }

    if (childIds.length > 0) {
      childrenByParentId.set(project.id, childIds);
    }

    partialRows.push({
      id: project.id,
      name: project.name,
      slug: project.slug,
      icon: project.icon,
      tasks,
      unscheduledCount: 0,
    });
  }

  // Position each dateless successor from its placed predecessors with the
  // SAME pure derivation the project Gantt uses (estimate length, working
  // calendar, next-day FS rule, chaining through sized derived tasks).
  const derived =
    undatedByTaskId.size > 0 && derivationDependencies.length > 0
      ? deriveUndatedSuccessorSchedules({
          edges: derivationDependencies.map(
            (dependency): CascadeEdge => ({
              sourceTaskId: dependency.sourceTaskId,
              targetTaskId: dependency.targetTaskId,
              dependencyType:
                dependency.dependencyType as CascadeDependencyType,
              lagDays: dependency.lagDays,
            }),
          ),
          datedScheduleById: ownSpanByTaskId,
          undatedCandidateIds: undatedByTaskId.keys(),
          isWorkingDay,
          estimateMinutesById,
        })
      : new Map<string, ScheduleSpan>();

  const derivedByProject = new Map<number, ScheduledPortfolioTask[]>();
  for (const [id, { task, projectIndex }] of undatedByTaskId) {
    const span = derived.get(id);
    if (!span) {
      partialRows[projectIndex].unscheduledCount += 1;
      continue;
    }
    const entry: ScheduledPortfolioTask = {
      id,
      title: task.title,
      progress: task.progress,
      isMilestone: task.isMilestone,
      status: task.status,
      scheduleStart: span.start,
      scheduleEnd: span.end,
      isDerived: true,
      estimateMinutes: task.estimateMinutes ?? null,
      estimateUnit: task.estimateUnit,
    };
    const list = derivedByProject.get(projectIndex);
    if (list) list.push(entry);
    else derivedByProject.set(projectIndex, [entry]);
  }
  for (const [projectIndex, list] of derivedByProject) {
    // Stable: ties keep the API's (title, id) order.
    list.sort((a, b) => a.scheduleStart.getTime() - b.scheduleStart.getTime());
    partialRows[projectIndex].tasks.push(...list);
  }

  const hierarchy: GanttHierarchy = {
    childrenByParentId,
    parentIdByChildId: new Map(),
  };
  const spans = computeParentSummarySpans(hierarchy, ownSpanByTaskId);
  const progresses = computeParentSummaryProgress(
    hierarchy,
    ownSpanByTaskId,
    progressByTaskId,
  );

  return partialRows.map((row) => ({
    ...row,
    summarySpan: spans.get(row.id) ?? null,
    summaryProgress: progresses.get(row.id) ?? null,
  }));
}

/** Flattened schedule list across every project's scheduled tasks — the flat
 * list buildGanttRange (timeline.ts) needs to compute the one shared window
 * every project's rows plot against. */
export function flattenPortfolioSchedule(
  rows: readonly PortfolioProjectRow[],
): { scheduleStart: Date; scheduleEnd: Date }[] {
  return rows.flatMap((row) => row.tasks);
}

/** Total scheduled-task count across every project, used to drive the
 * "no tasks to show yet" empty state independent of "no projects at all". */
export function countScheduledTasks(
  rows: readonly PortfolioProjectRow[],
): number {
  let total = 0;
  for (const row of rows) total += row.tasks.length;
  return total;
}

export type PortfolioDependencyInput = {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  dependencyType: string;
  lagDays: number;
};

/** Turns the portfolio endpoint's cross-project `blocks` relations into the
 * same edge shape the per-project Gantt's dependency-line overlay draws
 * (see dependency-lines.ts/gantt-dependency-overlay.tsx) -- every one of
 * these is already a "blocks" edge (the endpoint only returns relations with
 * portfolio-relevant scheduling semantics), so relationType is fixed rather
 * than carried over the wire. */
export function buildPortfolioDependencyEdges(
  dependencies: readonly PortfolioDependencyInput[],
): DependencyEdgeInput[] {
  return dependencies.map((dependency) => ({
    id: dependency.id,
    sourceTaskId: dependency.sourceTaskId,
    targetTaskId: dependency.targetTaskId,
    relationType: "blocks",
    dependencyType: dependency.dependencyType as "fs" | "ss" | "ff" | "sf",
    lagDays: dependency.lagDays,
  }));
}
