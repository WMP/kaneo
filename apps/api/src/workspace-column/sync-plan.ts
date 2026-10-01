import { toSlug } from "../column/slug";

// Pure core of "turn enforcement on": decides, for one project, which project
// columns become which workspace columns. No database access, so the preview,
// the real sync and the unit tests all use the same decision.

export type WorkspaceColumnData = {
  id: string;
  name: string;
  slug: string;
  position: number;
  icon: string | null;
  color: string | null;
  isFinal: boolean;
};

export type ProjectColumnData = {
  id: string;
  name: string;
  slug: string;
  position: number;
  icon: string | null;
  color: string | null;
  isFinal: boolean;
  workspaceColumnId: string | null;
};

export type ColumnMatchSource = "link" | "slug" | "name";

export type ProjectColumnMatch = {
  projectColumnId: string;
  // The project column as it is now (its old slug decides which tasks follow a
  // rename, its old final flag whether the subtask counters may change).
  previous: ProjectColumnData;
  workspaceColumn: WorkspaceColumnData;
  matchedBy: ColumnMatchSource;
  // True when the link or any of name, slug, position, icon, color and final
  // flag differs from the workspace column.
  changed: boolean;
};

export type ProjectColumnSyncPlan = {
  // The workspace column that receives the tasks of removed project columns.
  fallbackWorkspaceColumnId: string;
  matches: ProjectColumnMatch[];
  // Workspace columns without a match: created in the project.
  create: WorkspaceColumnData[];
  // Project columns without a match: their tasks move to the fallback column,
  // then the column is deleted.
  remove: ProjectColumnData[];
};

export type ColumnSyncPlanErrorCode = "EMPTY_WORKSPACE" | "UNKNOWN_FALLBACK";

export class ColumnSyncPlanError extends Error {
  constructor(
    readonly code: ColumnSyncPlanErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ColumnSyncPlanError";
  }
}

function byPosition<T extends { position: number; id: string }>(a: T, b: T) {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function differs(project: ProjectColumnData, workspace: WorkspaceColumnData) {
  return (
    project.workspaceColumnId !== workspace.id ||
    project.name !== workspace.name ||
    project.slug !== workspace.slug ||
    project.position !== workspace.position ||
    project.icon !== workspace.icon ||
    project.color !== workspace.color ||
    project.isFinal !== workspace.isFinal
  );
}

/**
 * Matches a project's columns to the workspace columns.
 *
 * Per workspace column, in this order of priority (each pass runs for all
 * workspace columns before the next one starts):
 * 1. a project column linked to it,
 * 2. a project column with the same slug,
 * 3. a project column whose `toSlug(name)` equals the workspace slug.
 * The first candidate by position wins; a project column is used at most once.
 * Workspace columns without a match are created, project columns without a
 * match are removed and their tasks go to `fallbackWorkspaceColumnId` (default:
 * the first workspace column by position).
 */
export function planProjectColumnSync(
  projectColumns: readonly ProjectColumnData[],
  workspaceColumns: readonly WorkspaceColumnData[],
  fallbackWorkspaceColumnId?: string | null,
): ProjectColumnSyncPlan {
  const orderedWorkspace = [...workspaceColumns].sort(byPosition);
  const first = orderedWorkspace[0];
  if (!first) {
    throw new ColumnSyncPlanError(
      "EMPTY_WORKSPACE",
      "The workspace has no columns to apply",
    );
  }

  let fallback = first;
  if (fallbackWorkspaceColumnId) {
    const requested = orderedWorkspace.find(
      (column) => column.id === fallbackWorkspaceColumnId,
    );
    if (!requested) {
      throw new ColumnSyncPlanError(
        "UNKNOWN_FALLBACK",
        "The fallback column is not a workspace column",
      );
    }
    fallback = requested;
  }

  const candidates = [...projectColumns].sort(byPosition);
  const claimed = new Set<string>();
  const matched = new Map<
    string,
    { column: ProjectColumnData; by: ColumnMatchSource }
  >();

  const passes: [
    ColumnMatchSource,
    (p: ProjectColumnData, w: WorkspaceColumnData) => boolean,
  ][] = [
    ["link", (p, w) => p.workspaceColumnId === w.id],
    ["slug", (p, w) => p.slug === w.slug],
    ["name", (p, w) => toSlug(p.name) === w.slug],
  ];

  for (const [by, test] of passes) {
    for (const workspaceColumn of orderedWorkspace) {
      if (matched.has(workspaceColumn.id)) continue;
      const candidate = candidates.find(
        (column) => !claimed.has(column.id) && test(column, workspaceColumn),
      );
      if (!candidate) continue;
      claimed.add(candidate.id);
      matched.set(workspaceColumn.id, { column: candidate, by });
    }
  }

  const matches: ProjectColumnMatch[] = [];
  const create: WorkspaceColumnData[] = [];
  for (const workspaceColumn of orderedWorkspace) {
    const hit = matched.get(workspaceColumn.id);
    if (!hit) {
      create.push(workspaceColumn);
      continue;
    }
    matches.push({
      projectColumnId: hit.column.id,
      previous: hit.column,
      workspaceColumn,
      matchedBy: hit.by,
      changed: differs(hit.column, workspaceColumn),
    });
  }

  return {
    fallbackWorkspaceColumnId: fallback.id,
    matches,
    create,
    remove: candidates.filter((column) => !claimed.has(column.id)),
  };
}

/** True when applying the plan would write nothing. */
export function isNoopPlan(plan: ProjectColumnSyncPlan): boolean {
  return (
    plan.create.length === 0 &&
    plan.remove.length === 0 &&
    plan.matches.every((match) => !match.changed)
  );
}
