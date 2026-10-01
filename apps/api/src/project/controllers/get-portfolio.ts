import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db from "../../database";
import {
  projectTable,
  taskRelationTable,
  taskTable,
} from "../../database/schema";
import { accessibleProjectIds } from "../../utils/project-access";
import { projectScopeCondition } from "../../utils/project-scope-filters";

export type PortfolioTask = {
  id: string;
  title: string;
  startDate: Date | null;
  dueDate: Date | null;
  progress: number;
  isMilestone: boolean;
  status: string;
};

export type PortfolioProject = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  icon: string | null;
  tasks: PortfolioTask[];
};

export type PortfolioDependency = {
  id: string;
  sourceTaskId: string;
  sourceProjectId: string;
  targetTaskId: string;
  targetProjectId: string;
  dependencyType: string;
  lagDays: number;
};

export type Portfolio = {
  projects: PortfolioProject[];
  dependencies: PortfolioDependency[];
};

// Archived tasks are hidden everywhere else in the app by default (the board,
// the per-project Gantt's own task list), so they're left out of the shared
// timeline too rather than cluttering it with closed-out work.
const HIDDEN_TASK_STATUS = "archived";

// One query for every project's tasks (scoped by the already-resolved
// projectIds), rather than the per-project getTasks controller called once
// per project: a portfolio can span many projects, and a route that fans out
// N paginated task-list calls to build one screen would scale with project
// count instead of staying flat.
//
// A caller without full access sees only the projects they are a member of, and
// a dependency only when BOTH of its projects are among them, so the other end
// of a cross-project `blocks` edge never reveals a task they cannot open.
async function getPortfolio(
  workspaceId: string,
  userId: string,
  includeArchived = false,
): Promise<Portfolio> {
  const accessible = await accessibleProjectIds(userId, workspaceId);

  const projects = await db.query.projectTable.findMany({
    where: and(
      eq(projectTable.workspaceId, workspaceId),
      includeArchived ? undefined : isNull(projectTable.archivedAt),
      projectScopeCondition(projectTable.id, accessible),
    ),
    orderBy: (project, { asc }) => [
      asc(project.position),
      asc(project.createdAt),
      asc(project.id),
    ],
  });

  if (projects.length === 0) return { projects: [], dependencies: [] };

  const projectIds = projects.map((project) => project.id);

  const tasks = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      title: taskTable.title,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      progress: taskTable.progress,
      isMilestone: taskTable.isMilestone,
      status: taskTable.status,
    })
    .from(taskTable)
    .where(
      and(
        inArray(taskTable.projectId, projectIds),
        // Drop archived tasks in the database rather than fetching every
        // archived row only to discard it below — a long-lived board can
        // accumulate far more archived work than open work.
        ne(taskTable.status, HIDDEN_TASK_STATUS),
      ),
    )
    // Schedule order, not board order: `position` only ranks a task inside its
    // own column, so it says little across a whole project and ties fall back
    // to a random id. Sort by the effective start (a due-date-only task starts
    // where it ends), then due date, then title; undated tasks go last. The id
    // keeps the order deterministic for identical titles. The web timeline
    // keeps this order as-is (see buildPortfolioRows).
    .orderBy(
      sql`coalesce(${taskTable.startDate}, ${taskTable.dueDate}) asc nulls last`,
      sql`${taskTable.dueDate} asc nulls last`,
      asc(taskTable.title),
      asc(taskTable.id),
    );

  const tasksByProject = new Map<string, PortfolioTask[]>();
  for (const task of tasks) {
    if (task.status === HIDDEN_TASK_STATUS) continue;
    const entry: PortfolioTask = {
      id: task.id,
      title: task.title,
      startDate: task.startDate,
      dueDate: task.dueDate,
      progress: task.progress,
      isMilestone: task.isMilestone,
      status: task.status,
    };
    const existing = tasksByProject.get(task.projectId);
    if (existing) existing.push(entry);
    else tasksByProject.set(task.projectId, [entry]);
  }

  // Cross-project "blocks" relations only: a "related"/"subtask" relation
  // never carries a meaningful dependencyType/lagDays (see task-relation/
  // response.ts) and a same-project relation is already drawable from that
  // project's own Gantt, so neither belongs on the shared portfolio axis.
  // One query joining the relation to both its endpoint tasks (rather than
  // the per-project getTaskRelationsByProject's task-set-scoped OR, called
  // once per project) keeps this flat regardless of project count.
  const targetTaskTable = alias(taskTable, "portfolio_target_task");
  const dependencyRows = await db
    .select({
      id: taskRelationTable.id,
      sourceTaskId: taskRelationTable.sourceTaskId,
      sourceProjectId: taskTable.projectId,
      targetTaskId: taskRelationTable.targetTaskId,
      targetProjectId: targetTaskTable.projectId,
      dependencyType: taskRelationTable.dependencyType,
      lagDays: taskRelationTable.lagDays,
    })
    .from(taskRelationTable)
    .innerJoin(taskTable, eq(taskRelationTable.sourceTaskId, taskTable.id))
    .innerJoin(
      targetTaskTable,
      eq(taskRelationTable.targetTaskId, targetTaskTable.id),
    )
    .where(
      and(
        eq(taskRelationTable.relationType, "blocks"),
        inArray(taskTable.projectId, projectIds),
        inArray(targetTaskTable.projectId, projectIds),
        ne(taskTable.projectId, targetTaskTable.projectId),
        ne(taskTable.status, HIDDEN_TASK_STATUS),
        ne(targetTaskTable.status, HIDDEN_TASK_STATUS),
      ),
    );

  return {
    projects: projects.map((project) => ({
      id: project.id,
      workspaceId: project.workspaceId,
      name: project.name,
      slug: project.slug,
      icon: project.icon,
      tasks: tasksByProject.get(project.id) ?? [],
    })),
    dependencies: dependencyRows,
  };
}

export default getPortfolio;
