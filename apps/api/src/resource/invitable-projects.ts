import { and, asc, eq, isNull } from "drizzle-orm";
import db from "../database";
import { projectTable } from "../database/schema";
import {
  accessibleProjectIds,
  projectAccessSatisfies,
  resolveProjectAccessMap,
} from "../utils/project-access";
import { projectScopeCondition } from "../utils/project-scope-filters";

const INVITE = { invitation: ["create"] };

// The projects of a workspace the caller can invite to: `invitation:create` in
// their effective statements of that project (the project invitation routes
// decide by them). Projects the caller cannot open are never listed. One
// definition for the invite dialog's project list and for "may this caller see
// invitation state at all"; the API key scope is the caller's to check first.
//
// - `skipArchived`: leave archived projects out (the dialog does; the mere
//   question "any project?" does not care).
// - `stopAtFirst`: return only the first qualifying project (the boolean
//   question). Access is still resolved for all candidates in one query.
// - `scope`: the caller's project scope when the caller has resolved it already
//   (`accessibleProjectIds`), so it is not resolved again.
export async function projectsCallerMayInviteTo(
  userId: string,
  workspaceId: string,
  {
    skipArchived = false,
    stopAtFirst = false,
    scope,
  }: {
    skipArchived?: boolean;
    stopAtFirst?: boolean;
    scope?: string[] | null;
  } = {},
): Promise<{ id: string; name: string }[]> {
  const visible =
    scope === undefined
      ? await accessibleProjectIds(userId, workspaceId)
      : scope;
  const scopeCondition = projectScopeCondition(projectTable.id, visible);
  const projects = await db
    .select({ id: projectTable.id, name: projectTable.name })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        ...(skipArchived ? [isNull(projectTable.archivedAt)] : []),
        ...(scopeCondition ? [scopeCondition] : []),
      ),
    )
    .orderBy(asc(projectTable.name), asc(projectTable.id));

  // One query resolves all of them (a project that stopped being accessible
  // meanwhile is left out on its own); the rest is in memory, in project order,
  // so the boolean question stops at the first project without further queries.
  const accesses = await resolveProjectAccessMap(
    userId,
    projects.map((project) => project.id),
  );
  const mayInvite = (project: { id: string }) => {
    const access = accesses.get(project.id);
    return access ? projectAccessSatisfies(access, INVITE) : false;
  };
  if (stopAtFirst) {
    const first = projects.find(mayInvite);
    return first ? [first] : [];
  }
  return projects.filter(mayInvite);
}
