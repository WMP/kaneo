import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import {
  type PermissionMap,
  type RoleStatements,
  resolveRoleStatements,
  satisfies,
  statementsFromCatalogRow,
} from "./role-statements";

// Project-level access (model B). Access to a project's data always comes from
// a `ganttpro_project_member` row, except for FULL-ACCESS users, who reach
// every project of the workspace and act with their workspace role:
//
//   1. instance administrators (`user.role === "admin"`),
//   2. workspace members whose role contains `owner`,
//   3. workspace members whose role grants `workspace: ["manage_settings"]`.
//
// Workspace membership is always required first, so a stale project row (left
// behind after the user left the workspace) never grants access. Everything
// that decides "may this user touch this project" goes through this file; see
// `docs/plans/project-membership.md` and `docs/agent-guide/api-and-boundaries.md`.

export type ProjectAccess = {
  workspaceId: string;
  projectId: string;
  // "full": reached through instance/workspace privileges. "member": through a
  // project membership.
  mode: "full" | "member";
  // Statements that apply inside this project: the workspace role's for
  // "full", the project role's for "member". `null` when nothing resolves
  // (for example an instance administrator who is not a workspace member).
  statements: RoleStatements | null;
  // Instance administrators and workspace owners skip statement checks.
  unrestricted: boolean;
  // The role behind `statements`: the project role for "member", the workspace
  // role for "full" (`null` for an instance administrator who is not a
  // workspace member).
  role: string | null;
  // The caller's WORKSPACE role statements, for the workspace-level resources
  // (`workspace`, `label` definitions of the workspace, ...). Equal to
  // `statements` for "full"; for "member" the workspace role that decided the
  // caller holds no full access. `null` when nothing resolves.
  workspaceStatements: RoleStatements | null;
};

const OWNER_ROLE = "owner";
const BUILT_IN_ROLES = ["viewer", "member", "admin"];

// Does the access grant every requested action inside its project?
export function projectAccessSatisfies(
  access: ProjectAccess,
  permissions: PermissionMap,
): boolean {
  return (
    access.unrestricted ||
    Boolean(access.statements && satisfies(access.statements, permissions))
  );
}

// Does the caller's WORKSPACE role grant every requested action? Workspace-level
// resources are decided by this even inside a project request.
export function workspaceRoleSatisfies(
  access: ProjectAccess,
  permissions: PermissionMap,
): boolean {
  return (
    access.unrestricted ||
    Boolean(
      access.workspaceStatements &&
        satisfies(access.workspaceStatements, permissions),
    )
  );
}

// True for `owner`, alone or inside a composite name such as "admin,owner".
export function isOwnerRole(role: string): boolean {
  return splitRoles(role).includes(OWNER_ROLE);
}

function splitRoles(role: string): string[] {
  return role
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

// Better Auth does not enforce one membership row per user and workspace. Equal
// duplicates are one membership; duplicates that disagree on the role are
// ambiguous, and picking one arbitrarily could pick the wider one, so the user
// counts as having no workspace membership until an administrator fixes it.
export function singleWorkspaceRole(roles: (string | null)[]): string | null {
  const distinct = new Set(roles.filter((role): role is string => !!role));
  if (distinct.size !== 1) return null;
  return [...distinct][0] ?? null;
}

type RoleResolver = (
  workspaceId: string,
  role: string,
) => Promise<RoleStatements | null>;

// Resolves each (workspace, role) once per call site, for bulk decisions.
function memoizedResolver(): RoleResolver {
  const cache = new Map<string, Promise<RoleStatements | null>>();
  return (workspaceId, role) => {
    const key = `${workspaceId}\u0000${role}`;
    let result = cache.get(key);
    if (!result) {
      result = resolveRoleStatements(workspaceId, role);
      cache.set(key, result);
    }
    return result;
  };
}

type WorkspaceStanding =
  | { kind: "instance-admin" }
  | { kind: "owner" }
  | { kind: "full"; statements: RoleStatements }
  | { kind: "restricted"; role: string; statements: RoleStatements | null };

// How the user stands in a workspace they are a member of. Same semantics as
// `hasWorkspacePermission`: a composite role such as "a,b" resolves as one
// unknown name and therefore grants nothing.
async function standingOf(
  workspaceId: string,
  userRole: string | null | undefined,
  workspaceRole: string | null | undefined,
  resolve: RoleResolver = resolveRoleStatements,
): Promise<WorkspaceStanding | null> {
  if (userRole === "admin") return { kind: "instance-admin" };
  if (!workspaceRole) return null;
  if (isOwnerRole(workspaceRole)) return { kind: "owner" };

  const statements = await resolve(workspaceId, workspaceRole);
  if (statements?.workspace?.includes("manage_settings")) {
    return { kind: "full", statements };
  }
  return { kind: "restricted", role: workspaceRole, statements };
}

// The statements of a project role, or `null` when the role can never be
// exercised: `owner` is not a project role, and a name that no longer resolves
// in the workspace's catalog (for example after the project moved to another
// workspace) fails closed instead of granting read access without permissions.
export async function projectRoleStatements(
  workspaceId: string,
  role: string,
  resolve: RoleResolver = resolveRoleStatements,
): Promise<RoleStatements | null> {
  if (isOwnerRole(role)) return null;
  return resolve(workspaceId, role);
}

// The caller's standing by WORKSPACE role alone, with Better Auth's semantics:
// a member of that workspace, `owner` (also inside a composite name) holding
// everything, anybody else holding what their role's statements grant. Instance
// administrators get no special treatment here. `null` for a non-member.
export async function workspaceMemberStanding(
  userId: string,
  workspaceId: string,
): Promise<{ owner: boolean; statements: RoleStatements | null } | null> {
  const rows = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    );
  const role = singleWorkspaceRole(rows.map((row) => row.role));
  if (!role) return null;
  if (isOwnerRole(role)) return { owner: true, statements: null };
  return {
    owner: false,
    statements: await resolveRoleStatements(workspaceId, role),
  };
}

type AccessRow = {
  projectId: string;
  workspaceId: string;
  userRole: string | null;
  workspaceRole: string | null;
  projectRole: string | null;
};

// One round trip for everything the decision needs, for one or many projects.
async function queryAccessRows(
  userId: string,
  projectIds: string[],
): Promise<AccessRow[]> {
  return db
    .select({
      projectId: schema.projectTable.id,
      workspaceId: schema.projectTable.workspaceId,
      userRole: schema.userTable.role,
      workspaceRole: schema.workspaceUserTable.role,
      projectRole: schema.projectMemberTable.role,
    })
    .from(schema.projectTable)
    .leftJoin(schema.userTable, eq(schema.userTable.id, userId))
    .leftJoin(
      schema.workspaceUserTable,
      and(
        eq(
          schema.workspaceUserTable.workspaceId,
          schema.projectTable.workspaceId,
        ),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    )
    .leftJoin(
      schema.projectMemberTable,
      and(
        eq(schema.projectMemberTable.projectId, schema.projectTable.id),
        eq(schema.projectMemberTable.userId, userId),
      ),
    )
    .where(
      projectIds.length === 1
        ? eq(schema.projectTable.id, projectIds[0] as string)
        : inArray(schema.projectTable.id, projectIds),
    );
}

// One row per project. Rows repeat when the user has several workspace
// membership rows; see `singleWorkspaceRole` for how disagreeing roles count.
function collapseAccessRows(rows: AccessRow[]): Map<string, AccessRow> {
  const byProject = new Map<string, AccessRow[]>();
  for (const row of rows) {
    byProject.set(row.projectId, [
      ...(byProject.get(row.projectId) ?? []),
      row,
    ]);
  }
  const collapsed = new Map<string, AccessRow>();
  for (const [projectId, group] of byProject) {
    const [first] = group;
    if (!first) continue;
    collapsed.set(projectId, {
      ...first,
      workspaceRole: singleWorkspaceRole(group.map((row) => row.workspaceRole)),
    });
  }
  return collapsed;
}

async function decide(
  row: AccessRow,
  resolve: RoleResolver = resolveRoleStatements,
): Promise<ProjectAccess | null> {
  const { workspaceId, projectId } = row;
  const standing = await standingOf(
    workspaceId,
    row.userRole,
    row.workspaceRole,
    resolve,
  );
  // Neither an instance administrator nor a workspace member: a leftover
  // project row grants nothing.
  if (!standing) return null;

  if (standing.kind === "instance-admin" || standing.kind === "owner") {
    const statements = row.workspaceRole
      ? await resolve(workspaceId, row.workspaceRole)
      : null;
    return {
      workspaceId,
      projectId,
      mode: "full",
      statements,
      unrestricted: true,
      role: row.workspaceRole,
      workspaceStatements: statements,
    };
  }

  if (standing.kind === "full") {
    return {
      workspaceId,
      projectId,
      mode: "full",
      statements: standing.statements,
      unrestricted: false,
      role: row.workspaceRole,
      workspaceStatements: standing.statements,
    };
  }

  if (!row.projectRole) return null;
  const statements = await projectRoleStatements(
    workspaceId,
    row.projectRole,
    resolve,
  );
  if (!statements) return null;
  return {
    workspaceId,
    projectId,
    mode: "member",
    statements,
    unrestricted: false,
    role: row.projectRole,
    workspaceStatements: standing.statements,
  };
}

export async function resolveProjectAccess(
  userId: string,
  projectId: string,
): Promise<ProjectAccess | null> {
  const row = collapseAccessRows(
    await queryAccessRows(userId, [projectId]),
  ).get(projectId);
  return row ? decide(row) : null;
}

async function readStanding(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceStanding | null> {
  const rows = await db
    .select({
      userRole: schema.userTable.role,
      workspaceRole: schema.workspaceUserTable.role,
    })
    .from(schema.userTable)
    .leftJoin(
      schema.workspaceUserTable,
      and(
        eq(schema.workspaceUserTable.userId, schema.userTable.id),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .where(eq(schema.userTable.id, userId));
  const [row] = rows;
  if (!row) return null;
  return standingOf(
    workspaceId,
    row.userRole,
    singleWorkspaceRole(rows.map((entry) => entry.workspaceRole)),
  );
}

// True for instance administrators, workspace owners and roles granting
// `workspace: ["manage_settings"]`. Non-members are never full-access.
export async function isFullAccess(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const standing = await readStanding(userId, workspaceId);
  return (
    standing?.kind === "instance-admin" ||
    standing?.kind === "owner" ||
    standing?.kind === "full"
  );
}

// `null` means every project of the workspace (full access). Otherwise the ids
// of the workspace's projects the user is a member of, using the same rules as
// `resolveProjectAccess`: a non-member of the workspace gets an empty list, and
// a membership whose role cannot be exercised is skipped.
export async function accessibleProjectIds(
  userId: string,
  workspaceId: string,
): Promise<string[] | null> {
  const standing = await readStanding(userId, workspaceId);
  if (!standing) return [];
  if (standing.kind !== "restricted") return null;

  const rows = await db
    .select({
      projectId: schema.projectMemberTable.projectId,
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
        eq(schema.projectTable.workspaceId, workspaceId),
      ),
    );

  const usable = new Map<string, boolean>();
  const ids: string[] = [];
  for (const row of rows) {
    let ok = usable.get(row.role);
    if (ok === undefined) {
      ok = (await projectRoleStatements(workspaceId, row.role)) !== null;
      usable.set(row.role, ok);
    }
    if (ok) ids.push(row.projectId);
  }
  return ids;
}

// Resolves several projects at once with one query, each on its own: the map
// holds the projects the user can reach and leaves out unknown ones and those
// without access.
export async function resolveProjectAccessMap(
  userId: string,
  projectIds: string[],
): Promise<Map<string, ProjectAccess>> {
  const ids = [...new Set(projectIds)];
  const accesses = new Map<string, ProjectAccess>();
  if (ids.length === 0) return accesses;
  const byProject = collapseAccessRows(await queryAccessRows(userId, ids));
  const resolve = memoizedResolver();
  for (const row of byProject.values()) {
    const access = await decide(row, resolve);
    if (access) accesses.set(row.projectId, access);
  }
  return accesses;
}

// Resolves several projects at once (bulk operations). Returns `null` as soon
// as one of them is unknown or not accessible.
export async function resolveProjectAccesses(
  userId: string,
  projectIds: string[],
): Promise<ProjectAccess[] | null> {
  const ids = [...new Set(projectIds)];
  const accesses = await resolveProjectAccessMap(userId, ids);
  if (accesses.size !== ids.length) return null;
  return [...accesses.values()];
}

export const PROJECT_ACCESS_DENIED_MESSAGE =
  "You don't have access to this project";

// Access to one project or a 403 with the shared message. The single place
// that turns "no access" into an HTTP error.
export async function requireProjectAccessFor(
  userId: string,
  projectId: string,
): Promise<ProjectAccess> {
  const access = await resolveProjectAccess(userId, projectId);
  if (!access) {
    throw new HTTPException(403, { message: PROJECT_ACCESS_DENIED_MESSAGE });
  }
  return access;
}

// Workspace role names that grant `workspace:manage_settings` (so full access).
// Each candidate (every catalog row and the built-in viewer, member, admin) is
// resolved with `statementsFromCatalogRow`, exactly like `resolveRoleStatements`
// does for one role: a row with an invalid or empty permission falls back to
// the built-in role. `owner` is always included; composite names containing
// `owner` are matched separately by the caller.
export async function fullAccessRoleNames(
  workspaceId: string,
): Promise<string[]> {
  const rows = await db
    .select({
      role: schema.workspaceRoleTable.role,
      permission: schema.workspaceRoleTable.permission,
    })
    .from(schema.workspaceRoleTable)
    .where(eq(schema.workspaceRoleTable.workspaceId, workspaceId));
  const catalog = new Map(rows.map((row) => [row.role, row.permission]));
  const candidates = new Set<string>([...catalog.keys(), ...BUILT_IN_ROLES]);
  const names = new Set<string>([OWNER_ROLE]);
  for (const role of candidates) {
    const statements = statementsFromCatalogRow(role, catalog.get(role));
    if (statements?.workspace?.includes("manage_settings")) names.add(role);
  }
  return [...names];
}

// Which of `roles` grant nothing in the workspace: `owner`, or a name that is in
// neither the role catalog nor the built-in roles. One query, on the given
// executor, so a transaction can use it.
export async function unusableProjectRoles(
  executor: Pick<typeof db, "select">,
  workspaceId: string,
  roles: string[],
): Promise<string[]> {
  if (roles.length === 0) return [];
  const rows = await executor
    .select({
      role: schema.workspaceRoleTable.role,
      permission: schema.workspaceRoleTable.permission,
    })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        inArray(schema.workspaceRoleTable.role, roles),
      ),
    );
  const catalog = new Map(rows.map((row) => [row.role, row.permission]));
  return roles.filter(
    (role) =>
      isOwnerRole(role) || !statementsFromCatalogRow(role, catalog.get(role)),
  );
}

// Decides "full access" for many members of one workspace with one role
// resolution per distinct (instance role, workspace role) pair.
export function createFullAccessChecker(workspaceId: string) {
  const cache = new Map<string, Promise<boolean>>();
  return (
    instanceRole: string | null | undefined,
    workspaceRole: string | null | undefined,
  ): Promise<boolean> => {
    const key = `${instanceRole ?? ""}|${workspaceRole ?? ""}`;
    let result = cache.get(key);
    if (!result) {
      result = standingOf(workspaceId, instanceRole, workspaceRole).then(
        (standing) => standing !== null && standing.kind !== "restricted",
      );
      cache.set(key, result);
    }
    return result;
  };
}

// Removes a user's project memberships in every project of one workspace.
export async function removeUserProjectMemberships(
  userId: string,
  workspaceId: string,
): Promise<number> {
  const deleted = await db
    .delete(schema.projectMemberTable)
    .where(
      and(
        eq(schema.projectMemberTable.userId, userId),
        inArray(
          schema.projectMemberTable.projectId,
          db
            .select({ id: schema.projectTable.id })
            .from(schema.projectTable)
            .where(eq(schema.projectTable.workspaceId, workspaceId)),
        ),
      ),
    )
    .returning({ id: schema.projectMemberTable.id });
  return deleted.length;
}
