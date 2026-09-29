import { HTTPException } from "hono/http-exception";
import { filterUsersWithProjectAccess } from "../utils/project-scope-filters";

export async function assertProjectAssignee(projectId: string, userId: string) {
  // Workspace membership alone is not enough: the assignee must be able to open
  // the project (a project membership, or full access).
  const allowed = await filterUsersWithProjectAccess([userId], projectId);
  if (!allowed.has(userId)) {
    throw new HTTPException(400, {
      message: "Assignee must be a current member of the project",
    });
  }
}
