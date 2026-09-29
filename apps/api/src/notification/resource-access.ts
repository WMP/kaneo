import { and, eq, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import db from "../database";
import { taskTable, userTable } from "../database/schema";
import { resolveProjectAccess } from "../utils/project-access";
import type { UserProjectScope } from "../utils/project-scope-filters";

function idList(ids: string[]) {
  // `IN (NULL)` matches nothing, which is what an empty scope must do.
  return ids.length === 0
    ? sql`NULL`
    : sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      );
}

function resourceAccessSql(
  userId: string,
  resourceId: string | null | SQLWrapper,
  resourceType: string | null | SQLWrapper,
  // Extra condition on `notification_task` / `notification_project` for a task
  // resource: access to the task's project.
  projectAccess: SQL,
) {
  return sql<boolean>`(
    (${resourceId}::text IS NULL AND ${resourceType}::text IS NULL)
    OR (${resourceType}::text = 'task' AND EXISTS (
      SELECT 1 FROM task AS notification_task
      JOIN project AS notification_project ON notification_project.id = notification_task.project_id
      JOIN workspace_member AS notification_member ON notification_member.workspace_id = notification_project.workspace_id
      WHERE notification_task.id = ${resourceId} AND notification_member.user_id = ${userId}
        AND ${projectAccess}
    ))
    OR (${resourceType}::text = 'workspace' AND EXISTS (
      SELECT 1 FROM workspace_member AS notification_member
      WHERE notification_member.workspace_id = ${resourceId} AND notification_member.user_id = ${userId}
    ))
  )`;
}

// Membership, rather than public visibility or global admin privileges, defines
// who may be subscribed to private task activity. Use the same predicate when
// reading notifications, including historical rows. Workspace membership is
// necessary but not enough for a task: the user also needs access to the task's
// PROJECT. `scope` (from `resolveUserProjectScope`) lists the workspaces where
// the user has full access and the projects they are a member of elsewhere, so
// a notification about a task they can no longer open is neither listed nor
// markable. Creation and delivery use `canReceiveResourceNotification`, which
// applies the same rule through `resolveProjectAccess`.
export function notificationResourceAccess(
  userId: string,
  resourceId: string | null | SQLWrapper,
  resourceType: string | null | SQLWrapper,
  scope: UserProjectScope,
) {
  return resourceAccessSql(
    userId,
    resourceId,
    resourceType,
    sql`(
      notification_project.workspace_id IN (${idList(scope.fullWorkspaceIds)})
      OR notification_task.project_id IN (${idList(scope.projectIds)})
    )`,
  );
}

// The same rule for one notification about to be created or delivered (both
// go through here, including mention notifications and external channels).
export async function canReceiveResourceNotification(
  userId: string,
  resourceId?: string | null,
  resourceType?: string | null,
) {
  if (resourceType === "task") {
    if (!resourceId) return false;
    const [task] = await db
      .select({ projectId: taskTable.projectId })
      .from(taskTable)
      .where(eq(taskTable.id, resourceId))
      .limit(1);
    if (!task || !(await resolveProjectAccess(userId, task.projectId))) {
      return false;
    }
  }

  const [user] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(
      and(
        eq(userTable.id, userId),
        resourceAccessSql(
          userId,
          resourceId ?? null,
          resourceType ?? null,
          sql`true`,
        ),
      ),
    )
    .limit(1);
  return Boolean(user);
}
