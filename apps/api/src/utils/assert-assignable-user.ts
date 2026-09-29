import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { filterUsersWithProjectAccess } from "./project-scope-filters";

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
