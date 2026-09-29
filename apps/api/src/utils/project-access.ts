import { and, eq, inArray } from "drizzle-orm";
import db, { schema } from "../database";
import {
  type PermissionMap,
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
  if (splitRoles(role).includes(OWNER_ROLE)) return null;
  return resolveRoleStatements(workspaceId, role);
}

export async function resolveProjectAccess(
  userId: string,
  projectId: string,
): Promise<ProjectAccess | null> {
  // One round trip for everything the decision needs.
  const [row] = await db
    .select({
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
    .where(eq(schema.projectTable.id, projectId))
    .limit(1);

  if (!row) return null;

  const { workspaceId } = row;
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

// Resolves several projects at once (bulk operations). Returns `null` as soon
// as one of them is not accessible.
export async function resolveProjectAccesses(
  userId: string,
  projectIds: string[],
): Promise<ProjectAccess[] | null> {
  const accesses: ProjectAccess[] = [];
  for (const projectId of [...new Set(projectIds)]) {
    const access = await resolveProjectAccess(userId, projectId);
    if (!access) return null;
    accesses.push(access);
  }
  return accesses;
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
