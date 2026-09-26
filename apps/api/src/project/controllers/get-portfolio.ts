import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import db from "../../database";
import { projectTable, taskTable } from "../../database/schema";

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

// Archived tasks are hidden everywhere else in the app by default (the board,
// the per-project Gantt's own task list), so they're left out of the shared
// timeline too rather than cluttering it with closed-out work.
const HIDDEN_TASK_STATUS = "archived";

// One query for every project's tasks, scoped by workspaceId through a join
// (the same shape getProjects' own statistics rollup uses), rather than the
// per-project getTasks controller called once per project: a portfolio can
// span many projects, and a route that fans out N paginated task-list calls
// to build one screen would scale with project count instead of staying flat.
async function getPortfolio(
  workspaceId: string,
  includeArchived = false,
): Promise<PortfolioProject[]> {
  const projects = await db.query.projectTable.findMany({
    where: includeArchived
      ? eq(projectTable.workspaceId, workspaceId)
      : and(
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.archivedAt),
        ),
    orderBy: (project, { asc }) => [
      asc(project.position),
      asc(project.createdAt),
      asc(project.id),
    ],
  });

  if (projects.length === 0) return [];

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
    .where(inArray(taskTable.projectId, projectIds))
    .orderBy(asc(taskTable.position), asc(taskTable.id));

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

  return projects.map((project) => ({
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    slug: project.slug,
    icon: project.icon,
    tasks: tasksByProject.get(project.id) ?? [],
  }));
}

export default getPortfolio;
