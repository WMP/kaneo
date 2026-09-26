// Pure data-shaping for the portfolio (multi-project) timeline: turns the
// raw GET /project/portfolio payload into per-project rows the route can
// render, reusing the same schedule-derivation and rollup math the
// per-project Gantt already relies on (timeline.ts, gantt-hierarchy.ts)
// rather than re-deriving either. Kept free of React and the DOM, like the
// rest of this folder's pure modules, so it's unit-testable directly.

import {
  computeParentSummaryProgress,
  computeParentSummarySpans,
  type GanttHierarchy,
  type ScheduleSpan,
} from "./gantt-hierarchy";
import { deriveTaskSchedule } from "./timeline";

export type PortfolioTaskInput = {
  id: string;
  title: string;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
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
};

export type PortfolioProjectRow = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  /** This project's tasks that have a derivable schedule, in their original
   * (position) order. A task with neither startDate nor dueDate has no
   * position to plot and is left out — same as the per-project Gantt. */
  tasks: ScheduledPortfolioTask[];
  /** Tasks left out of `tasks` because they have no derivable schedule (the
   * server already excludes archived tasks entirely). Lets the route say
   * "3 tasks, none scheduled yet" instead of reading as an empty project. */
  unscheduledCount: number;
  /** The project's overall rolled-up span across its own scheduled tasks —
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

export function buildPortfolioRows(
  projects: readonly PortfolioProjectInput[],
): PortfolioProjectRow[] {
  // One fake "hierarchy" for the whole call: each project is a parent, its
  // scheduled tasks are children. This lets computeParentSummarySpans/
  // computeParentSummaryProgress (built for a parent *task*'s rollup bar)
  // compute each *project*'s rollup here too, instead of a second
  // hand-rolled average.
  const childrenByParentId = new Map<string, string[]>();
  const ownSpanByTaskId = new Map<string, ScheduleSpan>();
  const progressByTaskId = new Map<string, number>();

  const partialRows: Omit<
    PortfolioProjectRow,
    "summarySpan" | "summaryProgress"
  >[] = [];

  for (const project of projects) {
    const tasks: ScheduledPortfolioTask[] = [];
    const childIds: string[] = [];
    let unscheduledCount = 0;

    for (const task of project.tasks) {
      if (task.status === HIDDEN_TASK_STATUS) continue;
      const schedule = deriveTaskSchedule(task.startDate, task.dueDate);
      if (!schedule) {
        unscheduledCount += 1;
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
      unscheduledCount,
    });
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
