import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  jiraStatusProposalTable,
  projectTable,
  taskTable,
} from "../database/schema";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { assertProjectAccess } from "../utils/workspace-access-middleware";

// Route middleware for `/proposal/{proposalId}/...`. A proposal belongs to a
// task, so the caller must be a member of that task's workspace and have access
// to that task's PROJECT; the permission (`task:update`) that follows is then
// evaluated on that project's statements, like every task route. An unknown
// proposal answers 404.
export async function proposalAccess(c: Context, next: Next) {
  const userId = c.get("userId");
  if (!userId) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const proposalId = c.req.param("proposalId");
  const [scope] = proposalId
    ? await db
        .select({
          workspaceId: projectTable.workspaceId,
          projectId: taskTable.projectId,
        })
        .from(jiraStatusProposalTable)
        .innerJoin(taskTable, eq(jiraStatusProposalTable.taskId, taskTable.id))
        .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
        .where(eq(jiraStatusProposalTable.id, proposalId))
        .limit(1)
    : [];
  if (!scope) {
    throw new HTTPException(404, { message: "Status proposal not found" });
  }

  await validateWorkspaceAccess(userId, scope.workspaceId, c.get("apiKey")?.id);
  await assertProjectAccess(c, userId, { projectId: scope.projectId });
  c.set("workspaceId", scope.workspaceId);
  return next();
}

// The task a `/task/{taskId}/...` route acts on, inside the workspace the
// access middleware authorized. `workspaceAccess.fromTaskId` falls back to
// `?workspaceId=` for a task that does not exist, so this is where an unknown
// task becomes a 404.
export async function requireTaskInWorkspace(
  taskId: string,
  workspaceId: string,
) {
  const [row] = await db
    .select({ task: taskTable })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(eq(taskTable.id, taskId), eq(projectTable.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!row) {
    throw new HTTPException(404, { message: "Task not found" });
  }
  return row.task;
}
