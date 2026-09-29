import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { filterUsersWithProjectAccess } from "./project-scope-filters";

const NOT_ASSIGNABLE = "Assignee is not a member of this workspace";
// One message for a missing user, a user outside the workspace and a workspace
// member without access to the project, so the endpoint cannot be used to probe
// which user ids exist or who belongs where.
export const NOT_PROJECT_ASSIGNABLE =
  "Assignee is not a member of this project";

// Assignment is decided per PROJECT: an assignee must be able to open the
// task's project (a project membership, or full access), which implies
// membership of its workspace. Instance administrators remain assignable, as
// before. Returns the subset of `userIds` that qualify.
export async function filterProjectAssignableUsers(
  userIds: string[],
  projectId: string,
): Promise<Set<string>> {
  return filterUsersWithProjectAccess([...new Set(userIds)], projectId);
}

export async function assertProjectAssignableUser(
  userId: string,
  projectId: string,
): Promise<void> {
  const assignable = await filterProjectAssignableUsers([userId], projectId);
  if (!assignable.has(userId)) {
    throw new HTTPException(403, { message: NOT_PROJECT_ASSIGNABLE });
  }
}

/**
 * Workspace-level check only: it does NOT look at project membership. Prefer
 * `filterProjectAssignableUsers` / `assertProjectAssignableUser` whenever the
 * task's project is known.
 */
export async function filterAssignableUsers(
  userIds: string[],
  workspaceId: string,
): Promise<Set<string>> {
  if (userIds.length === 0) {
    return new Set();
  }

  const memberships = await db
    .select({ userId: schema.workspaceUserTable.userId })
    .from(schema.workspaceUserTable)
    .where(
      and(
        inArray(schema.workspaceUserTable.userId, userIds),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    );

  const assignable = new Set(memberships.map((row) => row.userId));
  const remaining = userIds.filter((id) => !assignable.has(id));

  if (remaining.length === 0) {
    return assignable;
  }

  const admins = await db
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(
      and(
        inArray(schema.userTable.id, remaining),
        eq(schema.userTable.role, "admin"),
      ),
    );

  for (const admin of admins) {
    assignable.add(admin.id);
  }

  return assignable;
}

/** Workspace-level check only; see `filterAssignableUsers`. */
export async function assertAssignableUser(
  userId: string,
  workspaceId: string,
): Promise<void> {
  const assignable = await filterAssignableUsers([userId], workspaceId);

  if (!assignable.has(userId)) {
    throw new HTTPException(403, { message: NOT_ASSIGNABLE });
  }
}

export async function getProjectWorkspaceId(
  projectId: string,
): Promise<string> {
  const [project] = await db
    .select({ workspaceId: schema.projectTable.workspaceId })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, projectId))
    .limit(1);

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  return project.workspaceId;
}
