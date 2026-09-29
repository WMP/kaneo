import { and, eq, inArray, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import db, { schema } from "../database";
import {
  accessibleProjectIds,
  createFullAccessChecker,
  type ProjectAccess,
  projectRoleStatements,
  singleWorkspaceRole,
} from "./project-access";

// Filters for endpoints that return data of MANY projects (lists, search,
// workload, activity, notifications ...). A user without full access must not
// receive anything from a project they are not a member of: not rows, not
// counts, not names, not the existence of a task at the far end of a relation.
// `accessibleProjectIds` (project-access.ts) decides WHICH projects; this file
// turns that decision into SQL and answers the "who" questions that need the
// same rules for many users at once. See docs/plans/project-membership.md.

// The one convention for an empty scope: no values match nothing. It is spelled
// out (`false`) instead of trusting the driver's handling of an empty `IN ()`.
export function sqlIn(ref: SQLWrapper, values: string[]): SQL {
  return values.length === 0 ? sql`false` : inArray(ref as never, values);
}

// Groups rows by a key, pushing into one array per key. Queries that join a
// user to their workspace membership rows repeat the user once per row; grouping
// is the first step of collapsing them under `singleWorkspaceRole`.
export function groupRows<T>(
  rows: T[],
  keyOf: (row: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

// `null` (full access) adds no condition; an EMPTY list matches nothing.
export function projectScopeCondition(
  column: SQLWrapper,
  projectIds: string[] | null,
): SQL | undefined {
  return projectIds === null ? undefined : sqlIn(column, projectIds);
}

// A scope that cannot be left out by accident: `"all"` (full access, or a
// public board that is limited by `isPublic` instead) or the only projects that
// may be read. Prefer it to `string[] | null` in signatures where forgetting the
// scope would silently widen a read.
export type ProjectScope = "all" | string[];

export function toProjectScope(projectIds: string[] | null): ProjectScope {
  return projectIds ?? "all";
}

// The project scope of a request that already resolved access to one project
// (`workspaceAccess.from*` set `projectAccess`). Full access to one project is
// full access to the whole workspace, so no second resolution is needed then.
export async function visibleProjectIdsFor(
  access: ProjectAccess | undefined,
  userId: string,
  workspaceId: string,
): Promise<string[] | null> {
  return access?.mode === "full"
    ? null
    : accessibleProjectIds(userId, workspaceId);
}

// Memoised: does this project role resolve in the workspace's role catalog (it
// is not `owner`, and it still exists)? A membership whose role cannot be
// exercised grants nothing, exactly as in `resolveProjectAccess`.
export function createUsableProjectRoleChecker() {
  const cache = new Map<string, Promise<boolean>>();
  return (workspaceId: string, role: string): Promise<boolean> => {
    const key = `${workspaceId}\u0000${role}`;
    let result = cache.get(key);
    if (!result) {
      result = projectRoleStatements(workspaceId, role).then(
        (statements) => statements !== null,
      );
      cache.set(key, result);
    }
    return result;
  };
}

// A user's reach across every workspace, for predicates that span workspaces
// (search, notifications) and are expressed in SQL rather than as id lists:
// - `instanceAdmin`: reaches every project,
// - `fullWorkspaceIds`: workspaces where the user has full access,
// - `memberRoles`: the distinct (workspace, project role) pairs of the user's
//   project memberships whose role can be exercised. The predicate joins these
//   to `ganttpro_project_member`, so the number of projects never grows a list.
export type UserProjectScope = {
  instanceAdmin: boolean;
  fullWorkspaceIds: string[];
  memberRoles: Array<{ workspaceId: string; role: string }>;
};

// With `workspaceId` only that workspace is resolved (a search inside one
// workspace does not need the user's other workspaces).
export async function resolveUserProjectScope(
  userId: string,
  workspaceId?: string,
): Promise<UserProjectScope> {
  const [user] = await db
    .select({ role: schema.userTable.role })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  if (!user) {
    return { instanceAdmin: false, fullWorkspaceIds: [], memberRoles: [] };
  }
  if (user.role === "admin") {
    return { instanceAdmin: true, fullWorkspaceIds: [], memberRoles: [] };
  }

  const memberships = await db
    .select({
      workspaceId: schema.workspaceUserTable.workspaceId,
      workspaceRole: schema.workspaceUserTable.role,
    })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        workspaceId
          ? eq(schema.workspaceUserTable.workspaceId, workspaceId)
          : undefined,
      ),
    );

  // One role per workspace, with the rule `resolveProjectAccess` applies:
  // equal duplicate rows are one membership, rows that disagree on the role are
  // ambiguous and count as no membership, so the workspace is left out of the
  // scope entirely (fail closed).
  const fullWorkspaceIds: string[] = [];
  const restrictedWorkspaceIds: string[] = [];
  for (const [workspaceId, group] of groupRows(
    memberships,
    (membership) => membership.workspaceId,
  )) {
    const workspaceRole = singleWorkspaceRole(
      group.map((membership) => membership.workspaceRole),
    );
    if (!workspaceRole) continue;
    const isFull = await createFullAccessChecker(workspaceId)(
      user.role,
      workspaceRole,
    );
    (isFull ? fullWorkspaceIds : restrictedWorkspaceIds).push(workspaceId);
  }
  if (restrictedWorkspaceIds.length === 0) {
    return { instanceAdmin: false, fullWorkspaceIds, memberRoles: [] };
  }

  const pairs = await db
    .selectDistinct({
      workspaceId: schema.projectTable.workspaceId,
      role: schema.projectMemberTable.role,
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

  const isUsable = createUsableProjectRoleChecker();
  const memberRoles: UserProjectScope["memberRoles"] = [];
  for (const pair of pairs) {
    if (await isUsable(pair.workspaceId, pair.role)) memberRoles.push(pair);
  }
  return { instanceAdmin: false, fullWorkspaceIds, memberRoles };
}

// SQL for "the user may open the project `projectRef` of workspace
// `workspaceRef`", from a scope resolved above. Pass column references, or raw
// identifiers when the surrounding query aliases its tables.
export function userProjectScopeSql(
  userId: string,
  scope: UserProjectScope,
  projectRef: SQLWrapper,
  workspaceRef: SQLWrapper,
): SQL {
  if (scope.instanceAdmin) return sql`true`;
  const memberOfProject =
    scope.memberRoles.length === 0
      ? sql`false`
      : sql`EXISTS (
          SELECT 1 FROM ganttpro_project_member AS scope_member
          WHERE scope_member.project_id = ${projectRef}
            AND scope_member.user_id = ${userId}
            AND (${workspaceRef}, scope_member.role) IN (${sql.join(
              scope.memberRoles.map(
                (pair) => sql`(${pair.workspaceId}, ${pair.role})`,
              ),
              sql`, `,
            )})
        )`;
  return sql`(${sqlIn(workspaceRef, scope.fullWorkspaceIds)} OR ${memberOfProject})`;
}

// Relation activity ("relation_created" and friends) is logged on the source
// task but names the OTHER task of the relation in its data. A row whose
// other task lives in a project the viewer cannot open must not be listed, or
// the id (and, through it, the existence) of that task would leak. The whole
// row is dropped rather than redacted. `isVisible` receives references to the
// related task's project and workspace and says whether the viewer may open
// them; pass `null` for full access (no condition).
export function relationActivityExclusion(
  isVisible: ((projectRef: SQLWrapper, workspaceRef: SQLWrapper) => SQL) | null,
): SQL | undefined {
  if (!isVisible) return undefined;
  const projectRef = sql.raw("relation_task.project_id");
  const workspaceRef = sql.raw("relation_project.workspace_id");
  return sql`NOT (
    ${schema.activityTable.type} IN ('relation_created', 'relation_updated', 'relation_deleted')
    AND EXISTS (
      SELECT 1 FROM task AS relation_task
      JOIN project AS relation_project ON relation_project.id = relation_task.project_id
      WHERE relation_task.id IN (
        ${schema.activityTable.eventData}->>'sourceTaskId',
        ${schema.activityTable.eventData}->>'targetTaskId'
      )
      AND NOT (${isVisible(projectRef, workspaceRef)})
    )
  )`;
}

// The same, for a viewer whose scope is a list of project ids (`null`: all).
export function relationActivityExclusionForIds(
  visibleProjectIds: string[] | null,
): SQL | undefined {
  return relationActivityExclusion(
    visibleProjectIds === null
      ? null
      : (projectRef) => sqlIn(projectRef, visibleProjectIds),
  );
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
  const isUsable = createUsableProjectRoleChecker();
  // The join repeats a user for each of their workspace membership rows; collapse
  // them with the same rule as `resolveProjectAccess` (ambiguous roles: none).
  for (const [userId, group] of groupRows(rows, (row) => row.userId)) {
    const [first] = group;
    if (!first) continue;
    if (first.userRole === "admin") {
      allowed.add(userId);
      continue;
    }
    // A stale project row never grants access without workspace membership.
    const workspaceRole = singleWorkspaceRole(
      group.map((row) => row.workspaceRole),
    );
    if (!workspaceRole) continue;
    if (
      (await isFullAccess(first.userRole, workspaceRole)) ||
      (first.projectRole && (await isUsable(workspaceId, first.projectRole)))
    ) {
      allowed.add(userId);
    }
  }
  return allowed;
}
