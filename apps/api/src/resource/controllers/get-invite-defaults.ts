import { and, asc, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import db from "../../database";
import {
  projectTable,
  taskAssignmentTable,
  taskTable,
} from "../../database/schema";
import {
  accessibleProjectIds,
  projectAccessSatisfies,
  resolveProjectAccess,
} from "../../utils/project-access";
import { projectScopeCondition } from "../../utils/project-scope-filters";
import { apiKeyAllows } from "../../utils/require-workspace-permission";

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

  const scope = await accessibleProjectIds(actorUserId, workspaceId);
  const scopeCondition = projectScopeCondition(projectTable.id, scope);
  const projects = await db
    .select({ id: projectTable.id, name: projectTable.name })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.archivedAt),
        ...(scopeCondition ? [scopeCondition] : []),
      ),
    )
    .orderBy(asc(projectTable.name), asc(projectTable.id));

  const assigned = new Set(
    (
      await db
        .selectDistinct({ projectId: taskTable.projectId })
        .from(taskAssignmentTable)
        .innerJoin(taskTable, eq(taskAssignmentTable.taskId, taskTable.id))
        .where(eq(taskAssignmentTable.resourceId, resourceId))
    ).map((row) => row.projectId),
  );

  // Full access to one project is full access to the whole workspace with the
  // same statements, so one decision covers every project; anybody else holds a
  // role per project and is asked per project (a restricted person has few).
  const allowed: typeof projects = [];
  let fullDecision: boolean | null = null;
  for (const project of projects) {
    if (fullDecision !== null) {
      if (fullDecision) allowed.push(project);
      continue;
    }
    const access = await resolveProjectAccess(actorUserId, project.id);
    if (!access) continue;
    const may = projectAccessSatisfies(access, INVITE);
    if (access.mode === "full") fullDecision = may;
    if (may) allowed.push(project);
  }

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
