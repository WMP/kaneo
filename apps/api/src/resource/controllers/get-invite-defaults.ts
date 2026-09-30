import { eq } from "drizzle-orm";
import type { Context } from "hono";
import db from "../../database";
import { taskAssignmentTable, taskTable } from "../../database/schema";
import { apiKeyAllows } from "../../utils/require-workspace-permission";
import { projectsCallerMayInviteTo } from "../invitable-projects";

const INVITE = { invitation: ["create"] };

// The projects the caller can invite to (`invitation:create` in their effective
// statements of that project, and in the API key's scope), for the invite
// dialog of a resource: the projects the resource has tasks in first (the
// defaults to pre-select), then the others. Projects the caller cannot open or
// cannot invite to are not listed, and neither are archived projects.
async function getInviteDefaults({
  c,
  resourceId,
  workspaceId,
  actorUserId,
}: {
  c: Context;
  resourceId: string;
  workspaceId: string;
  actorUserId: string;
}) {
  if (!apiKeyAllows(c, INVITE)) return { projects: [] };

  const allowed = await projectsCallerMayInviteTo(actorUserId, workspaceId, {
    skipArchived: true,
  });

  const assigned = new Set(
    (
      await db
        .selectDistinct({ projectId: taskTable.projectId })
        .from(taskAssignmentTable)
        .innerJoin(taskTable, eq(taskAssignmentTable.taskId, taskTable.id))
        .where(eq(taskAssignmentTable.resourceId, resourceId))
    ).map((row) => row.projectId),
  );

  return {
    projects: allowed
      .map((project) => ({
        ...project,
        hasAssignments: assigned.has(project.id),
      }))
      .sort(
        (a, b) =>
          Number(b.hasAssignments) - Number(a.hasAssignments) ||
          a.name.localeCompare(b.name),
      ),
  };
}

export default getInviteDefaults;
