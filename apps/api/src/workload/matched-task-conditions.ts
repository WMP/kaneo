import { eq, isNotNull, isNull, ne, not, or } from "drizzle-orm";
import { projectTable, taskTable } from "../database/schema";
import { taskIsCompleted } from "../task/task-is-completed";
import { projectScopeCondition } from "../utils/project-scope-filters";

/**
 * The workspace-scoped, dated, not-done task conditions shared by the
 * aggregate workload view and its per-assignee task drill-through. Callers
 * still need to `innerJoin(projectTable, ...)` and add their own date-range
 * condition on top of this. Pass `projectId` to restrict to a single project.
 *
 * `visibleProjectIds` is the caller's project scope (`accessibleProjectIds`):
 * `null` for full access, otherwise the only projects whose tasks may be
 * counted. It is required so that no caller can forget it, and an empty list
 * matches nothing. `projectId` can only narrow it.
 */
export function notDoneDatedTaskConditions(
  workspaceId: string,
  visibleProjectIds: string[] | null,
  projectId?: string,
) {
  const scope = projectScopeCondition(projectTable.id, visibleProjectIds);
  return [
    eq(projectTable.workspaceId, workspaceId),
    ...(scope ? [scope] : []),
    // Archived projects are hidden from the active project list, so their
    // tasks must not surface here either.
    isNull(projectTable.archivedAt),
    ...(projectId ? [eq(taskTable.projectId, projectId)] : []),
    or(isNotNull(taskTable.startDate), isNotNull(taskTable.dueDate)),
    not(taskIsCompleted),
    // `taskIsCompleted` only recognizes final columns; the virtual
    // "archived" status has no column, so exclude it explicitly the way the
    // schedulers do.
    ne(taskTable.status, "archived"),
  ];
}
