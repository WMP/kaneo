import { eq, isNotNull, isNull, ne, not, or } from "drizzle-orm";
import { projectTable, taskTable } from "../database/schema";
import { taskIsCompleted } from "../task/task-is-completed";

/**
 * The workspace-scoped, dated, not-done task conditions shared by the
 * aggregate workload view and its per-assignee task drill-through. Callers
 * still need to `innerJoin(projectTable, ...)` and add their own date-range
 * condition on top of this. Pass `projectId` to restrict to a single project.
 */
export function notDoneDatedTaskConditions(
  workspaceId: string,
  projectId?: string,
) {
  return [
    eq(projectTable.workspaceId, workspaceId),
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
