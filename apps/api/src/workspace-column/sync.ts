import { asc, count, eq, inArray, sql } from "drizzle-orm";
import type db from "../database";
import {
  columnTable,
  projectTable,
  taskTable,
  workflowRuleTable,
  workspaceColumnTable,
} from "../database/schema";
import type { Transaction } from "./enforcement-lock";
import {
  type ColumnMatchSource,
  isNoopPlan,
  type ProjectColumnData,
  type ProjectColumnSyncPlan,
  planProjectColumnSync,
  type WorkspaceColumnData,
} from "./sync-plan";

export * from "./sync-plan";

type Executor = Pick<typeof db, "select">;

// Appended to the target column, in their old order, so that positions do not
// collide with the tasks already there.
export async function appendTasksToColumn(
  tx: Transaction,
  {
    projectId,
    where,
    target,
  }: {
    projectId: string;
    where: ReturnType<typeof sql>;
    target: { id: string; slug: string };
  },
): Promise<number> {
  // Written as raw SQL: Drizzle cannot express the per-row rank. `updated_at`
  // is set by hand because raw SQL bypasses `$onUpdate`. No event is published
  // for the moved tasks on purpose: integrations must not react to a workspace
  // setting (for example by closing issues).
  const result = await tx.execute(sql`
    WITH moved AS (
      SELECT ${taskTable.id} AS id,
        row_number() OVER (ORDER BY ${taskTable.position}, ${taskTable.createdAt}, ${taskTable.id}) AS rn
      FROM ${taskTable}
      WHERE ${taskTable.projectId} = ${projectId} AND (${where})
    ), base AS (
      SELECT COALESCE(MAX(${taskTable.position}), 0) AS max_position
      FROM ${taskTable}
      WHERE ${taskTable.projectId} = ${projectId}
        AND ${taskTable.columnId} = ${target.id}
    )
    UPDATE ${taskTable}
    SET column_id = ${target.id},
        status = ${target.slug},
        position = (base.max_position + moved.rn)::integer,
        updated_at = now()
    FROM moved, base
    WHERE ${taskTable.id} = moved.id
  `);
  return result.rowCount ?? 0;
}

// Tasks that belong to a project column: those pointing at it, and legacy
// tasks without a column whose status is the column's slug.
export function tasksOfColumnsSql(columns: { id: string; slug: string }[]) {
  const ids = columns.map((column) => column.id);
  const slugs = columns.map((column) => column.slug);
  return sql`${inArray(taskTable.columnId, ids)} OR (${taskTable.columnId} IS NULL AND ${inArray(taskTable.status, slugs)})`;
}

export type ProjectColumnSyncResult = {
  columnsCreated: number;
  columnsUpdated: number;
  columnsRemoved: number;
  tasksMoved: number;
  tasksRestatused: number;
  workflowRulesDeleted: number;
  // True when the subtask counters of parent boards may change: a final flag
  // changed, or tasks changed column or status.
  subtaskParentsAffected: boolean;
};

/**
 * Writes a plan for one project, inside the caller's transaction. Order: create
 * missing columns, move the tasks of removed columns to the fallback, update
 * matched columns (and the status of their tasks), delete removed columns
 * (workflow rules on them go with them through the foreign key cascade).
 */
export async function applyProjectColumnSync(
  tx: Transaction,
  projectId: string,
  plan: ProjectColumnSyncPlan,
): Promise<ProjectColumnSyncResult> {
  const projectColumnIdByWorkspaceId = new Map<string, string>();
  const slugByWorkspaceId = new Map<string, string>();

  for (const match of plan.matches) {
    projectColumnIdByWorkspaceId.set(
      match.workspaceColumn.id,
      match.projectColumnId,
    );
    slugByWorkspaceId.set(match.workspaceColumn.id, match.workspaceColumn.slug);
  }

  for (const workspaceColumn of plan.create) {
    const [created] = await tx
      .insert(columnTable)
      .values({
        projectId,
        name: workspaceColumn.name,
        slug: workspaceColumn.slug,
        position: workspaceColumn.position,
        icon: workspaceColumn.icon,
        color: workspaceColumn.color,
        isFinal: workspaceColumn.isFinal,
        workspaceColumnId: workspaceColumn.id,
      })
      .returning({ id: columnTable.id });
    if (!created) throw new Error("Failed to create project column");
    projectColumnIdByWorkspaceId.set(workspaceColumn.id, created.id);
    slugByWorkspaceId.set(workspaceColumn.id, workspaceColumn.slug);
  }

  let tasksMoved = 0;
  let workflowRulesDeleted = 0;

  if (plan.remove.length > 0) {
    const fallbackId = projectColumnIdByWorkspaceId.get(
      plan.fallbackWorkspaceColumnId,
    );
    const fallbackSlug = slugByWorkspaceId.get(plan.fallbackWorkspaceColumnId);
    if (!fallbackId || !fallbackSlug) {
      throw new Error("The fallback column is missing from the plan");
    }

    const [rules] = await tx
      .select({ total: count() })
      .from(workflowRuleTable)
      .where(
        inArray(
          workflowRuleTable.columnId,
          plan.remove.map((column) => column.id),
        ),
      );
    workflowRulesDeleted = rules?.total ?? 0;

    tasksMoved = await appendTasksToColumn(tx, {
      projectId,
      where: tasksOfColumnsSql(plan.remove),
      target: { id: fallbackId, slug: fallbackSlug },
    });
  }

  let columnsUpdated = 0;
  let tasksRestatused = 0;
  let finalFlagChanged = false;

  for (const match of plan.matches) {
    if (!match.changed) continue;
    const { workspaceColumn, previous } = match;
    await tx
      .update(columnTable)
      .set({
        name: workspaceColumn.name,
        slug: workspaceColumn.slug,
        position: workspaceColumn.position,
        icon: workspaceColumn.icon,
        color: workspaceColumn.color,
        isFinal: workspaceColumn.isFinal,
        workspaceColumnId: workspaceColumn.id,
      })
      .where(eq(columnTable.id, match.projectColumnId));
    columnsUpdated++;
    if (previous.isFinal !== workspaceColumn.isFinal) finalFlagChanged = true;

    // Tasks in the column take the workspace slug as their status; legacy
    // tasks without a column are attached to it on the way.
    const restatused = await tx.execute(sql`
      UPDATE ${taskTable}
      SET status = ${workspaceColumn.slug},
          column_id = ${match.projectColumnId},
          updated_at = now()
      WHERE ${taskTable.projectId} = ${projectId}
        AND (
          (${taskTable.columnId} = ${match.projectColumnId}
            AND ${taskTable.status} <> ${workspaceColumn.slug})
          OR (${taskTable.columnId} IS NULL
            AND ${taskTable.status} IN (${previous.slug}, ${workspaceColumn.slug}))
        )
    `);
    tasksRestatused += restatused.rowCount ?? 0;
  }

  if (plan.remove.length > 0) {
    await tx.delete(columnTable).where(
      inArray(
        columnTable.id,
        plan.remove.map((column) => column.id),
      ),
    );
    if (plan.remove.some((column) => column.isFinal)) finalFlagChanged = true;
  }

  return {
    columnsCreated: plan.create.length,
    columnsUpdated,
    columnsRemoved: plan.remove.length,
    tasksMoved,
    tasksRestatused,
    workflowRulesDeleted,
    subtaskParentsAffected:
      finalFlagChanged || tasksMoved > 0 || tasksRestatused > 0,
  };
}

// ---------------------------------------------------------------------------
// Workspace-wide sync (preview and enforcement)
// ---------------------------------------------------------------------------

export async function loadWorkspaceColumns(
  executor: Executor,
  workspaceId: string,
): Promise<WorkspaceColumnData[]> {
  return executor
    .select({
      id: workspaceColumnTable.id,
      name: workspaceColumnTable.name,
      slug: workspaceColumnTable.slug,
      position: workspaceColumnTable.position,
      icon: workspaceColumnTable.icon,
      color: workspaceColumnTable.color,
      isFinal: workspaceColumnTable.isFinal,
    })
    .from(workspaceColumnTable)
    .where(eq(workspaceColumnTable.workspaceId, workspaceId))
    .orderBy(asc(workspaceColumnTable.position), asc(workspaceColumnTable.id));
}

export async function listWorkspaceProjectIds(
  executor: Executor,
  workspaceId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(eq(projectTable.workspaceId, workspaceId));
  return rows.map((row) => row.id);
}

type WorkspaceSyncState = {
  projects: { id: string; name: string }[];
  columnsByProject: Map<string, ProjectColumnData[]>;
  // Per project column: tasks that belong to it and workflow rules on it.
  taskCount: Map<string, number>;
  ruleCount: Map<string, number>;
};

async function loadWorkspaceSyncState(
  executor: Executor,
  workspaceId: string,
): Promise<WorkspaceSyncState> {
  const projects = await executor
    .select({ id: projectTable.id, name: projectTable.name })
    .from(projectTable)
    .where(eq(projectTable.workspaceId, workspaceId))
    .orderBy(asc(projectTable.position), asc(projectTable.id));

  const columnRows = await executor
    .select({
      id: columnTable.id,
      projectId: columnTable.projectId,
      name: columnTable.name,
      slug: columnTable.slug,
      position: columnTable.position,
      icon: columnTable.icon,
      color: columnTable.color,
      isFinal: columnTable.isFinal,
      workspaceColumnId: columnTable.workspaceColumnId,
    })
    .from(columnTable)
    .innerJoin(projectTable, eq(columnTable.projectId, projectTable.id))
    .where(eq(projectTable.workspaceId, workspaceId))
    .orderBy(asc(columnTable.position), asc(columnTable.id));

  const columnsByProject = new Map<string, ProjectColumnData[]>();
  for (const { projectId, ...column } of columnRows) {
    const list = columnsByProject.get(projectId) ?? [];
    list.push(column);
    columnsByProject.set(projectId, list);
  }

  const taskRows = await executor
    .select({
      projectId: taskTable.projectId,
      columnId: taskTable.columnId,
      status: taskTable.status,
      total: count(),
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(eq(projectTable.workspaceId, workspaceId))
    .groupBy(taskTable.projectId, taskTable.columnId, taskTable.status);

  const taskCount = new Map<string, number>();
  for (const row of taskRows) {
    const columns = columnsByProject.get(row.projectId) ?? [];
    const owner = row.columnId
      ? columns.find((column) => column.id === row.columnId)
      : columns.find((column) => column.slug === row.status);
    if (!owner) continue;
    taskCount.set(owner.id, (taskCount.get(owner.id) ?? 0) + row.total);
  }

  const ruleRows = await executor
    .select({ columnId: workflowRuleTable.columnId, total: count() })
    .from(workflowRuleTable)
    .innerJoin(projectTable, eq(workflowRuleTable.projectId, projectTable.id))
    .where(eq(projectTable.workspaceId, workspaceId))
    .groupBy(workflowRuleTable.columnId);
  const ruleCount = new Map(ruleRows.map((row) => [row.columnId, row.total]));

  return { projects, columnsByProject, taskCount, ruleCount };
}

export type ProjectSyncEntry = {
  projectId: string;
  projectName: string;
  changed: boolean;
  create: { workspaceColumnId: string; name: string; slug: string }[];
  remove: {
    columnId: string;
    name: string;
    slug: string;
    taskCount: number;
    workflowRuleCount: number;
  }[];
  update: {
    columnId: string;
    workspaceColumnId: string;
    name: string;
    slug: string;
    newName: string;
    newSlug: string;
    matchedBy: ColumnMatchSource;
    taskCount: number;
  }[];
  // Tasks that change column (removed columns) and workflow rules deleted with
  // them. Predicted in a preview, counted for real in the enforcement result.
  tasksMoved: number;
  workflowRulesDeleted: number;
};

export type WorkspaceSyncTotals = {
  projects: number;
  projectsChanged: number;
  columnsCreated: number;
  columnsRemoved: number;
  columnsUpdated: number;
  tasksMoved: number;
  workflowRulesDeleted: number;
};

type PlannedProject = {
  entry: ProjectSyncEntry;
  plan: ProjectColumnSyncPlan;
};

function describeProject(
  project: { id: string; name: string },
  plan: ProjectColumnSyncPlan,
  state: WorkspaceSyncState,
): PlannedProject {
  const remove = plan.remove.map((column) => ({
    columnId: column.id,
    name: column.name,
    slug: column.slug,
    taskCount: state.taskCount.get(column.id) ?? 0,
    workflowRuleCount: state.ruleCount.get(column.id) ?? 0,
  }));
  const update = plan.matches
    .filter((match) => match.changed)
    .map((match) => ({
      columnId: match.projectColumnId,
      workspaceColumnId: match.workspaceColumn.id,
      name: match.previous.name,
      slug: match.previous.slug,
      newName: match.workspaceColumn.name,
      newSlug: match.workspaceColumn.slug,
      matchedBy: match.matchedBy,
      taskCount: state.taskCount.get(match.projectColumnId) ?? 0,
    }));
  return {
    plan,
    entry: {
      projectId: project.id,
      projectName: project.name,
      changed: !isNoopPlan(plan),
      create: plan.create.map((column) => ({
        workspaceColumnId: column.id,
        name: column.name,
        slug: column.slug,
      })),
      remove,
      update,
      tasksMoved: remove.reduce((sum, column) => sum + column.taskCount, 0),
      workflowRulesDeleted: remove.reduce(
        (sum, column) => sum + column.workflowRuleCount,
        0,
      ),
    },
  };
}

function totalsOf(entries: ProjectSyncEntry[]): WorkspaceSyncTotals {
  return {
    projects: entries.length,
    projectsChanged: entries.filter((entry) => entry.changed).length,
    columnsCreated: entries.reduce((sum, e) => sum + e.create.length, 0),
    columnsRemoved: entries.reduce((sum, e) => sum + e.remove.length, 0),
    columnsUpdated: entries.reduce((sum, e) => sum + e.update.length, 0),
    tasksMoved: entries.reduce((sum, e) => sum + e.tasksMoved, 0),
    workflowRulesDeleted: entries.reduce(
      (sum, e) => sum + e.workflowRulesDeleted,
      0,
    ),
  };
}

export type WorkspaceSyncSummary = {
  fallbackColumnId: string;
  projects: ProjectSyncEntry[];
  totals: WorkspaceSyncTotals;
};

/**
 * Dry run of `enforceWorkspaceColumns`. `visibleProjectIds` limits the report
 * to the projects the caller may see (`null`: all of them).
 */
export async function previewWorkspaceColumnSync(
  executor: Executor,
  workspaceId: string,
  fallbackColumnId: string | null,
  visibleProjectIds: string[] | null,
): Promise<WorkspaceSyncSummary> {
  const workspaceColumns = await loadWorkspaceColumns(executor, workspaceId);
  const state = await loadWorkspaceSyncState(executor, workspaceId);
  const visible = visibleProjectIds ? new Set(visibleProjectIds) : null;

  let fallback = "";
  const entries: ProjectSyncEntry[] = [];
  for (const project of state.projects) {
    const plan = planProjectColumnSync(
      state.columnsByProject.get(project.id) ?? [],
      workspaceColumns,
      fallbackColumnId,
    );
    fallback = plan.fallbackWorkspaceColumnId;
    if (visible && !visible.has(project.id)) continue;
    entries.push(describeProject(project, plan, state).entry);
  }

  if (!fallback) {
    // No projects: still report which column would be the fallback.
    fallback = planProjectColumnSync(
      [],
      workspaceColumns,
      fallbackColumnId,
    ).fallbackWorkspaceColumnId;
  }

  return {
    fallbackColumnId: fallback,
    projects: entries,
    totals: totalsOf(entries),
  };
}

export type AppliedWorkspaceSync = WorkspaceSyncSummary & {
  changedProjectIds: string[];
  subtaskParentProjectIds: string[];
};

/**
 * Applies the match to every project of the workspace inside the caller's
 * transaction (which holds the workspace row lock). The summary counts what was
 * really written.
 */
export async function applyWorkspaceColumnSync(
  tx: Transaction,
  workspaceId: string,
  fallbackColumnId: string | null,
): Promise<AppliedWorkspaceSync> {
  const workspaceColumns = await loadWorkspaceColumns(tx, workspaceId);
  const state = await loadWorkspaceSyncState(tx, workspaceId);

  let fallback = "";
  const entries: ProjectSyncEntry[] = [];
  const changedProjectIds: string[] = [];
  const subtaskParentProjectIds: string[] = [];

  for (const project of state.projects) {
    const plan = planProjectColumnSync(
      state.columnsByProject.get(project.id) ?? [],
      workspaceColumns,
      fallbackColumnId,
    );
    fallback = plan.fallbackWorkspaceColumnId;
    const { entry } = describeProject(project, plan, state);

    if (entry.changed) {
      const result = await applyProjectColumnSync(tx, project.id, plan);
      entry.tasksMoved = result.tasksMoved;
      entry.workflowRulesDeleted = result.workflowRulesDeleted;
      changedProjectIds.push(project.id);
      if (result.subtaskParentsAffected)
        subtaskParentProjectIds.push(project.id);
    }
    entries.push(entry);
  }

  if (!fallback) {
    fallback = planProjectColumnSync(
      [],
      workspaceColumns,
      fallbackColumnId,
    ).fallbackWorkspaceColumnId;
  }

  return {
    fallbackColumnId: fallback,
    projects: entries,
    totals: totalsOf(entries),
    changedProjectIds,
    subtaskParentProjectIds,
  };
}

/**
 * Syncs one project (a project moved into an enforced workspace) with the
 * workspace columns, the first column by position being the fallback.
 */
export async function syncProjectToWorkspaceColumns(
  tx: Transaction,
  projectId: string,
  workspaceId: string,
): Promise<ProjectColumnSyncResult | null> {
  const workspaceColumns = await loadWorkspaceColumns(tx, workspaceId);
  if (workspaceColumns.length === 0) return null;

  const projectColumns = await tx
    .select({
      id: columnTable.id,
      name: columnTable.name,
      slug: columnTable.slug,
      position: columnTable.position,
      icon: columnTable.icon,
      color: columnTable.color,
      isFinal: columnTable.isFinal,
      workspaceColumnId: columnTable.workspaceColumnId,
    })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position), asc(columnTable.id));

  const plan = planProjectColumnSync(projectColumns, workspaceColumns, null);
  if (isNoopPlan(plan)) return null;
  return applyProjectColumnSync(tx, projectId, plan);
}
