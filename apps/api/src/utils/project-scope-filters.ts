import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import db, { schema } from "../database";
import {
  accessibleProjectIds,
  createFullAccessChecker,
  projectRoleStatements,
} from "./project-access";

// Filters for endpoints that return data of MANY projects (lists, search,
// workload, activity, notifications ...). A user without full access must not
// receive anything from a project they are not a member of: not rows, not
// counts, not names, not the existence of a task at the far end of a relation.
// `accessibleProjectIds` (project-access.ts) decides WHICH projects; this file
// turns that decision into SQL and answers the "who" questions that need the
// same rules for many users at once. See docs/plans/project-membership.md.

// `null` (full access) adds no condition. An EMPTY list must match nothing,
// never "no filter": `sql\`false\`` makes that explicit instead of trusting the
// driver's handling of an empty `IN ()`.
export function projectScopeCondition(
  column: PgColumn,
  projectIds: string[] | null,
): SQL | undefined {
  if (projectIds === null) return undefined;
  if (projectIds.length === 0) return sql`false`;
  return inArray(column, projectIds);
}

// The projects a caller may read in one workspace, or `null` for all of them.
export function callerProjectScope(userId: string, workspaceId: string) {
  return accessibleProjectIds(userId, workspaceId);
}

// A user's reach across every workspace they belong to, for predicates that
// span workspaces (notifications). `fullWorkspaceIds` are workspaces where the
// user has full access; `projectIds` are the projects they are a member of in
// all the other workspaces.
export type UserProjectScope = {
  fullWorkspaceIds: string[];
  projectIds: string[];
};

export async function resolveUserProjectScope(
  userId: string,
): Promise<UserProjectScope> {
  const memberships = await db
    .select({
      workspaceId: schema.workspaceUserTable.workspaceId,
      workspaceRole: schema.workspaceUserTable.role,
      userRole: schema.userTable.role,
    })
    .from(schema.workspaceUserTable)
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.workspaceUserTable.userId),
    )
    .where(eq(schema.workspaceUserTable.userId, userId));

  const fullWorkspaceIds: string[] = [];
  const restrictedWorkspaceIds: string[] = [];
  for (const membership of memberships) {
    const isFull = await createFullAccessChecker(membership.workspaceId)(
      membership.userRole,
      membership.workspaceRole,
    );
    (isFull ? fullWorkspaceIds : restrictedWorkspaceIds).push(
      membership.workspaceId,
    );
  }

  if (restrictedWorkspaceIds.length === 0) {
    return { fullWorkspaceIds, projectIds: [] };
  }

  const rows = await db
    .select({
      projectId: schema.projectMemberTable.projectId,
      role: schema.projectMemberTable.role,
      workspaceId: schema.projectTable.workspaceId,
    })
    .from(schema.projectMemberTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.projectMemberTable.projectId),
    )
    .where(
      and(
        eq(schema.projectMemberTable.userId, userId),
        inArray(schema.projectTable.workspaceId, restrictedWorkspaceIds),
      ),
    );

  const projectIds: string[] = [];
  const usable = new Map<string, boolean>();
  for (const row of rows) {
    const key = `${row.workspaceId}|${row.role}`;
    let ok = usable.get(key);
    if (ok === undefined) {
      ok = (await projectRoleStatements(row.workspaceId, row.role)) !== null;
      usable.set(key, ok);
    }
    if (ok) projectIds.push(row.projectId);
  }
  return { fullWorkspaceIds, projectIds };
}

// Which of these users can reach the project? Same decision as
// `resolveProjectAccess` (workspace membership first, then full access, then a
// usable project role; an instance administrator always qualifies) for many
// users in one query plus one role resolution per distinct role.
export async function filterUsersWithProjectAccess(
  userIds: string[],
  projectId: string,
): Promise<Set<string>> {
  const allowed = new Set<string>();
  if (userIds.length === 0) return allowed;

  const [project] = await db
    .select({ workspaceId: schema.projectTable.workspaceId })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, projectId))
    .limit(1);
  if (!project) return allowed;
  const { workspaceId } = project;

  const rows = await db
    .select({
      userId: schema.userTable.id,
      userRole: schema.userTable.role,
      workspaceRole: schema.workspaceUserTable.role,
      projectRole: schema.projectMemberTable.role,
    })
    .from(schema.userTable)
    .leftJoin(
      schema.workspaceUserTable,
      and(
        eq(schema.workspaceUserTable.userId, schema.userTable.id),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .leftJoin(
      schema.projectMemberTable,
      and(
        eq(schema.projectMemberTable.userId, schema.userTable.id),
        eq(schema.projectMemberTable.projectId, projectId),
      ),
    )
    .where(inArray(schema.userTable.id, userIds));

  const isFullAccess = createFullAccessChecker(workspaceId);
  const usableRoles = new Map<string, boolean>();
  for (const row of rows) {
    if (row.userRole === "admin") {
      allowed.add(row.userId);
      continue;
    }
    // A stale project row never grants access without workspace membership.
    if (!row.workspaceRole) continue;
    if (await isFullAccess(row.userRole, row.workspaceRole)) {
      allowed.add(row.userId);
      continue;
    }
    if (!row.projectRole) continue;
    let ok = usableRoles.get(row.projectRole);
    if (ok === undefined) {
      ok = (await projectRoleStatements(workspaceId, row.projectRole)) !== null;
      usableRoles.set(row.projectRole, ok);
    }
    if (ok) allowed.add(row.userId);
  }
  return allowed;
}
