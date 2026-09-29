import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import {
  builtInRoleStatements,
  type PermissionMap,
  parsePermissionStatements,
  type RoleStatements,
  resolveRoleStatements,
  satisfies,
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
};

const OWNER_ROLE = "owner";

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

type WorkspaceStanding =
  | { kind: "instance-admin" }
  | { kind: "owner" }
  | { kind: "full"; statements: RoleStatements }
  | { kind: "restricted"; role: string };

// How the user stands in a workspace they are a member of. Same semantics as
// `hasWorkspacePermission`: a composite role such as "a,b" resolves as one
// unknown name and therefore grants nothing.
async function standingOf(
  workspaceId: string,
  userRole: string | null | undefined,
  workspaceRole: string | null | undefined,
): Promise<WorkspaceStanding | null> {
  if (userRole === "admin") return { kind: "instance-admin" };
  if (!workspaceRole) return null;
  if (splitRoles(workspaceRole).includes(OWNER_ROLE)) return { kind: "owner" };

  const statements = await resolveRoleStatements(workspaceId, workspaceRole);
  if (statements?.workspace?.includes("manage_settings")) {
    return { kind: "full", statements };
  }
  return { kind: "restricted", role: workspaceRole };
}

// The statements of a project role, or `null` when the role can never be
// exercised: `owner` is not a project role, and a name that no longer resolves
// in the workspace's catalog (for example after the project moved to another
// workspace) fails closed instead of granting read access without permissions.
export async function projectRoleStatements(
  workspaceId: string,
  role: string,
): Promise<RoleStatements | null> {
  if (isOwnerRole(role)) return null;
  return resolveRoleStatements(workspaceId, role);
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

async function decide(row: AccessRow): Promise<ProjectAccess | null> {
  const { workspaceId, projectId } = row;
  const standing = await standingOf(
    workspaceId,
    row.userRole,
    row.workspaceRole,
  );
  // Neither an instance administrator nor a workspace member: a leftover
  // project row grants nothing.
  if (!standing) return null;

  if (standing.kind === "instance-admin" || standing.kind === "owner") {
    return {
      workspaceId,
      projectId,
      mode: "full",
      statements: row.workspaceRole
        ? await resolveRoleStatements(workspaceId, row.workspaceRole)
        : null,
      unrestricted: true,
    };
  }

  if (standing.kind === "full") {
    return {
      workspaceId,
      projectId,
      mode: "full",
      statements: standing.statements,
      unrestricted: false,
    };
  }

  if (!row.projectRole) return null;
  const statements = await projectRoleStatements(workspaceId, row.projectRole);
  if (!statements) return null;
  return {
    workspaceId,
    projectId,
    mode: "member",
    statements,
    unrestricted: false,
  };
}

export async function resolveProjectAccess(
  userId: string,
  projectId: string,
): Promise<ProjectAccess | null> {
  const [row] = await queryAccessRows(userId, [projectId]);
  return row ? decide(row) : null;
}

async function readStanding(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceStanding | null> {
  const [row] = await db
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
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  if (!row) return null;
  return standingOf(workspaceId, row.userRole, row.workspaceRole);
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

// Resolves several projects at once (bulk operations) with one query. Returns
// `null` as soon as one of them is unknown or not accessible.
export async function resolveProjectAccesses(
  userId: string,
  projectIds: string[],
): Promise<ProjectAccess[] | null> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return [];
  const rows = await queryAccessRows(userId, ids);
  if (rows.length !== ids.length) return null;
  const accesses: ProjectAccess[] = [];
  for (const row of rows) {
    const access = await decide(row);
    if (!access) return null;
    accesses.push(access);
  }
  return accesses;
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

// Workspace role names that grant `workspace:manage_settings` (so full access),
// resolved like `resolveRoleStatements`: an edited catalog row wins over the
// built-in definition. `owner` is always included; composite names containing
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
  const names = new Set<string>([OWNER_ROLE]);
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(row.role);
    const statements = row.permission
      ? parsePermissionStatements(row.permission)
      : null;
    if (statements?.workspace?.includes("manage_settings")) names.add(row.role);
  }
  for (const builtIn of ["viewer", "member", "admin"]) {
    if (seen.has(builtIn)) continue;
    if (
      builtInRoleStatements(builtIn)?.workspace?.includes("manage_settings")
    ) {
      names.add(builtIn);
    }
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
  const catalog = new Map(
    rows.map((row) => [
      row.role,
      row.permission ? parsePermissionStatements(row.permission) : null,
    ]),
  );
  return roles.filter(
    (role) =>
      isOwnerRole(role) || !(catalog.get(role) ?? builtInRoleStatements(role)),
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
