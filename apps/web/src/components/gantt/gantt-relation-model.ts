// The schedule and relation inputs the project Gantt and the dependency
// neighborhood card are both built from, as pure functions (no React, no DOM).
//
// The Gantt route and `useTaskNeighborhoodData` call the SAME functions on the
// same cached queries (the project's tasks, its relations and the workspace
// calendar), so a task sits on the same days, in the same row kind, with the
// same violated edges on every view. Do not re-derive any of this in a view.

import type getProjectTaskRelations from "@/fetchers/task-relation/get-project-task-relations";
import type { DependencyEdgeInput } from "./dependency-lines";
import type { CriticalPathEdgeInput } from "./gantt-critical-path";
import {
  buildCriticalPathInput,
  type CriticalPathInput,
} from "./gantt-critical-path-input";
import type { CascadeEdge } from "./gantt-dependency-cascade";
import { computeViolatedDependencyEdgeIds } from "./gantt-dependency-violations";
import { deriveUndatedSuccessorSchedules } from "./gantt-derived-schedule";
import { deriveTaskScheduleWithEstimate } from "./gantt-estimated-span";
import type { ExternalGanttTask } from "./gantt-external-task-bar";
import {
  buildTaskHierarchy,
  computeParentSummarySpans,
  type GanttHierarchy,
  type ScheduleSpan,
} from "./gantt-hierarchy";

export type ProjectTaskRelation = Awaited<
  ReturnType<typeof getProjectTaskRelations>
>[number];

type WorkingDayPredicate = (date: Date) => boolean;

type TaskWithDates = {
  id: string;
  startDate: string | null;
  dueDate: string | null;
  estimateMinutes?: number | null;
  isMilestone?: boolean;
};

type DependencyKind = "fs" | "ss" | "ff" | "sf";

/** Parent -> children from this project's own "subtask" relations (see
 * gantt-hierarchy.ts). */
export function buildHierarchyFromRelations(
  taskIds: Iterable<string>,
  relations: readonly ProjectTaskRelation[],
): GanttHierarchy {
  return buildTaskHierarchy(
    taskIds,
    relations.flatMap((relation) =>
      relation.relationType === "subtask"
        ? [
            {
              sourceTaskId: relation.sourceTaskId,
              targetTaskId: relation.targetTaskId,
            },
          ]
        : [],
    ),
  );
}

/** Every task's OWN derived schedule (own dates, or the span an estimate gives
 * a task with exactly one date) in working days. Never a rolled-up span. */
export function buildOwnScheduleByTaskId(
  tasks: readonly TaskWithDates[],
  isWorkingDay: WorkingDayPredicate,
): Map<string, ScheduleSpan> {
  const map = new Map<string, ScheduleSpan>();
  for (const task of tasks) {
    const schedule = deriveTaskScheduleWithEstimate(task, isWorkingDay);
    if (schedule) map.set(task.id, schedule);
  }
  return map;
}

/** The span each own task is drawn with: a summary parent's rolled-up span
 * when it has one, its own schedule otherwise. A task with neither is absent. */
export function buildOwnRowScheduleById(
  taskIds: Iterable<string>,
  summarySpanByParentId: ReadonlyMap<string, ScheduleSpan>,
  ownScheduleByTaskId: ReadonlyMap<string, ScheduleSpan>,
): Map<string, ScheduleSpan> {
  const map = new Map<string, ScheduleSpan>();
  for (const id of taskIds) {
    const schedule =
      summarySpanByParentId.get(id) ?? ownScheduleByTaskId.get(id);
    if (schedule) map.set(id, schedule);
  }
  return map;
}

/** "blocks" and "related" relations as dependency edges ("subtask" is
 * hierarchy, not a line). */
export function buildDependencyEdgeInputs(
  relations: readonly ProjectTaskRelation[],
): DependencyEdgeInput[] {
  return relations.flatMap((relation) => {
    if (
      relation.relationType !== "blocks" &&
      relation.relationType !== "related"
    ) {
      return [];
    }
    return [
      {
        id: relation.id,
        sourceTaskId: relation.sourceTaskId,
        targetTaskId: relation.targetTaskId,
        relationType: relation.relationType,
        dependencyType: relation.dependencyType as DependencyKind,
        lagDays: relation.lagDays,
      },
    ];
  });
}

/** Only "blocks" edges are scheduling constraints. */
export function buildBlocksEdges(
  relations: readonly ProjectTaskRelation[],
): CascadeEdge[] {
  return relations.flatMap((relation) =>
    relation.relationType === "blocks"
      ? [
          {
            sourceTaskId: relation.sourceTaskId,
            targetTaskId: relation.targetTaskId,
            dependencyType: relation.dependencyType as DependencyKind,
            lagDays: relation.lagDays,
          },
        ]
      : [],
  );
}

/** The "blocks" edges with each relation's own id (the critical path needs one
 * to say which edges came out critical). */
export function buildCriticalPathEdges(
  relations: readonly ProjectTaskRelation[],
): CriticalPathEdgeInput[] {
  return relations.flatMap((relation) =>
    relation.relationType === "blocks"
      ? [
          {
            id: relation.id,
            sourceTaskId: relation.sourceTaskId,
            targetTaskId: relation.targetTaskId,
            dependencyType: relation.dependencyType as DependencyKind,
            lagDays: relation.lagDays,
          },
        ]
      : [],
  );
}

/** Which project each relation endpoint belongs to. */
export function buildProjectIdByRelatedTaskId(
  relations: readonly ProjectTaskRelation[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const relation of relations) {
    for (const task of [relation.sourceTask, relation.targetTask]) {
      if (task) map.set(task.id, task.projectId);
    }
  }
  return map;
}

export type ExternalScheduledTask = ExternalGanttTask & { isExternal: true };

/**
 * Relation endpoints that are not an own task with a row: dated cross-project
 * far ends, and DERIVED rows (tasks without dates placed from a placed
 * predecessor plus estimate; own or cross-project). Display only, nothing is
 * persisted.
 */
export function buildExternalRelatedTasks({
  relations,
  projectId,
  ownScheduleByTaskId,
  ownRowIds,
  blocksEdges,
  isWorkingDay,
}: {
  relations: readonly ProjectTaskRelation[];
  projectId: string;
  ownScheduleByTaskId: ReadonlyMap<string, ScheduleSpan>;
  /** Own tasks that already have a row (own dates or a rolled-up span); they
   * are never derived candidates. */
  ownRowIds: ReadonlySet<string>;
  blocksEdges: readonly CascadeEdge[];
  isWorkingDay: WorkingDayPredicate;
}): ExternalScheduledTask[] {
  const external = new Map<string, ExternalScheduledTask>();

  // Dated schedules that can ANCHOR a derivation: this project's own dated
  // tasks plus every dated relation endpoint (own or cross-project).
  const datedScheduleById = new Map(ownScheduleByTaskId);
  // Endpoints with no dates of their own: candidates to place by deriving from
  // a placed predecessor below.
  const undatedCandidates = new Map<
    string,
    NonNullable<ProjectTaskRelation["sourceTask"]>
  >();

  for (const relation of relations) {
    if (relation.relationType === "subtask") continue;
    for (const candidate of [relation.sourceTask, relation.targetTask]) {
      if (!candidate) continue;
      const schedule = deriveTaskScheduleWithEstimate(candidate, isWorkingDay);
      if (schedule) {
        if (!datedScheduleById.has(candidate.id)) {
          datedScheduleById.set(candidate.id, schedule);
        }
        if (candidate.projectId !== projectId && !external.has(candidate.id)) {
          external.set(candidate.id, {
            id: candidate.id,
            title: candidate.title,
            number: candidate.number,
            projectName: candidate.projectName,
            projectSlug: candidate.projectSlug,
            scheduleStart: schedule.start,
            scheduleEnd: schedule.end,
            isMilestone: candidate.isMilestone,
            isExternal: true as const,
            isDerived: false,
            estimateMinutes: candidate.estimateMinutes,
            estimateUnit: candidate.estimateUnit,
            status: candidate.status,
            projectId: candidate.projectId,
          });
        }
        continue;
      }
      // No dates of its own: a candidate for a derived row, unless it is an
      // own task that already has a row.
      if (candidate.projectId !== projectId || !ownRowIds.has(candidate.id)) {
        undatedCandidates.set(candidate.id, candidate);
      }
    }
  }

  const estimateMinutesById = new Map<string, number | null>();
  for (const [id, candidate] of undatedCandidates) {
    estimateMinutesById.set(id, candidate.estimateMinutes);
  }

  const derived = deriveUndatedSuccessorSchedules({
    edges: [...blocksEdges],
    datedScheduleById,
    undatedCandidateIds: undatedCandidates.keys(),
    isWorkingDay,
    estimateMinutesById,
  });
  for (const [id, schedule] of derived) {
    if (external.has(id)) continue;
    const candidate = undatedCandidates.get(id);
    if (!candidate) continue;
    external.set(id, {
      id,
      title: candidate.title,
      number: candidate.number,
      projectName: candidate.projectName,
      projectSlug: candidate.projectSlug,
      scheduleStart: schedule.start,
      scheduleEnd: schedule.end,
      isMilestone: candidate.isMilestone,
      isExternal: true as const,
      isDerived: true,
      isOwnProject: candidate.projectId === projectId,
      estimateMinutes: candidate.estimateMinutes,
      estimateUnit: candidate.estimateUnit,
      status: candidate.status,
      projectId: candidate.projectId,
    });
  }

  return [...external.values()];
}

/** "blocks" edges whose constraint the current dates break. Own tasks plus the
 * dated cross-project far ends count; derived rows have no dates of their own
 * and never do. */
export function buildViolatedEdgeIds(
  dependencyEdges: readonly DependencyEdgeInput[],
  criticalPathInput: Pick<CriticalPathInput, "tasks" | "derivedTaskIds">,
): Set<string> {
  const scheduleByTaskId = new Map<string, ScheduleSpan>();
  for (const task of criticalPathInput.tasks) {
    if (criticalPathInput.derivedTaskIds.has(task.id)) continue;
    scheduleByTaskId.set(task.id, {
      start: task.scheduleStart,
      end: task.scheduleEnd,
    });
  }
  return computeViolatedDependencyEdgeIds(
    dependencyEdges.map((edge) => ({
      id: edge.id,
      relationType: edge.relationType,
      sourceTaskId: edge.sourceTaskId,
      targetTaskId: edge.targetTaskId,
      dependencyType: edge.dependencyType ?? "fs",
      lagDays: edge.lagDays ?? 0,
    })),
    scheduleByTaskId,
  );
}

export type NeighborhoodTaskInfoEntry = {
  key: string;
  title: string;
  isDerived?: boolean;
};

/** Schedules the neighborhood card draws: each own row's span plus every
 * relation endpoint of another project (and derived row), own rows first. */
export function buildNeighborhoodScheduleById(
  ownRowScheduleById: ReadonlyMap<string, ScheduleSpan>,
  externalRows: readonly ExternalScheduledTask[],
): Map<string, ScheduleSpan> {
  const map = new Map<string, ScheduleSpan>(ownRowScheduleById);
  for (const task of externalRows) {
    if (!map.has(task.id)) {
      map.set(task.id, { start: task.scheduleStart, end: task.scheduleEnd });
    }
  }
  return map;
}

/** Key ("AFB-36") and title of every task the card can show. */
export function buildNeighborhoodTaskInfoById({
  relations,
  ownTasks,
  externalRows,
  projectId,
  projectSlug,
}: {
  relations: readonly ProjectTaskRelation[];
  ownTasks: readonly {
    id: string;
    number?: number | null;
    title: string;
  }[];
  externalRows: readonly ExternalScheduledTask[];
  projectId: string;
  projectSlug: string | undefined;
}): Map<string, NeighborhoodTaskInfoEntry> {
  const map = new Map<string, NeighborhoodTaskInfoEntry>();
  const keyOf = (slug: string | undefined, number: number | null) =>
    number ? `${slug ?? ""}-${number}` : "";
  for (const relation of relations) {
    for (const endpoint of [relation.sourceTask, relation.targetTask]) {
      if (!endpoint) continue;
      map.set(endpoint.id, {
        key:
          keyOf(
            endpoint.projectId === projectId
              ? projectSlug
              : endpoint.projectSlug,
            endpoint.number,
          ) || endpoint.title,
        title: endpoint.title,
      });
    }
  }
  for (const task of ownTasks) {
    map.set(task.id, {
      key: keyOf(projectSlug, task.number ?? null) || task.title,
      title: task.title,
    });
  }
  for (const task of externalRows) {
    const info = map.get(task.id);
    if (info && task.isDerived) map.set(task.id, { ...info, isDerived: true });
  }
  return map;
}

export type NeighborhoodData = {
  edges: DependencyEdgeInput[];
  scheduleByTaskId: Map<string, ScheduleSpan>;
  taskInfoById: Map<string, NeighborhoodTaskInfoEntry>;
  violatedEdgeIds: Set<string>;
  /** Project of every relation endpoint, to tell a neighbor of the open
   * project from one of another project. */
  projectIdByTaskId: Map<string, string>;
};

/** Everything the dependency neighborhood card needs, from the same inputs the
 * Gantt route uses (see the module comment). */
export function buildNeighborhoodData({
  tasks,
  relations,
  projectId,
  projectSlug,
  isWorkingDay,
}: {
  tasks: readonly (TaskWithDates & {
    number?: number | null;
    title: string;
  })[];
  relations: readonly ProjectTaskRelation[];
  projectId: string;
  projectSlug: string | undefined;
  isWorkingDay: WorkingDayPredicate;
}): NeighborhoodData {
  const hierarchy = buildHierarchyFromRelations(
    tasks.map((task) => task.id),
    relations,
  );
  const ownScheduleByTaskId = buildOwnScheduleByTaskId(tasks, isWorkingDay);
  const ownRowScheduleById = buildOwnRowScheduleById(
    tasks.map((task) => task.id),
    computeParentSummarySpans(hierarchy, ownScheduleByTaskId),
    ownScheduleByTaskId,
  );
  const blocksEdges = buildBlocksEdges(relations);
  const externalRows = buildExternalRelatedTasks({
    relations,
    projectId,
    ownScheduleByTaskId,
    ownRowIds: new Set(ownRowScheduleById.keys()),
    blocksEdges,
    isWorkingDay,
  });
  const edges = buildDependencyEdgeInputs(relations);
  const criticalPathInput = buildCriticalPathInput({
    ownSchedules: ownScheduleByTaskId,
    externalRows,
    edges: buildCriticalPathEdges(relations),
  });
  return {
    edges,
    scheduleByTaskId: buildNeighborhoodScheduleById(
      ownRowScheduleById,
      externalRows,
    ),
    taskInfoById: buildNeighborhoodTaskInfoById({
      relations,
      ownTasks: tasks,
      externalRows,
      projectId,
      projectSlug,
    }),
    violatedEdgeIds: buildViolatedEdgeIds(edges, criticalPathInput),
    projectIdByTaskId: buildProjectIdByRelatedTaskId(relations),
  };
}
