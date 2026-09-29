import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import db, { schema } from "../../database";
import {
  type ProjectAccess,
  projectAccessSatisfies,
  singleWorkspaceRole,
} from "../../utils/project-access";
import {
  apiKeyAllows,
  hasWorkspacePermission,
} from "../../utils/require-workspace-permission";
import type { PermissionMap } from "../../utils/role-statements";

// Actions of the project UI, each evaluated with the logic of the route that
// performs it. `hasWorkspacePermission` is what `requireWorkspacePermission`
// runs: the API key scope, then the statements of the caller's effective access
// in this project for project-level resources (`project`, `task`, `label`) and
// the WORKSPACE role for workspace-level ones (`workspace`, ...).
const PROJECT_LEVEL_CAPABILITIES = {
  createTasks: { task: ["create"] },
  updateTasks: { task: ["update"] },
  deleteTasks: { task: ["delete"] },
  assignTasks: { task: ["assign"] },
  createLabels: { label: ["create"] },
  updateLabels: { label: ["update"] },
  deleteLabels: { label: ["delete"] },
  updateProject: { project: ["update"] },
  deleteProject: { project: ["delete"] },
  shareProject: { project: ["share"] },
} satisfies Record<string, PermissionMap>;

// The project member and project invitation routes are the exception to the
// workspace-level rule: they check `member:*` and `invitation:*` against the
// caller's effective PROJECT statements (and the API key scope) themselves.
const PROJECT_STATEMENT_CAPABILITIES = {
  addMembers: [{ member: ["create"] }],
  manageMembers: [
    { member: ["create"] },
    { member: ["update"] },
    { member: ["delete"] },
  ],
  inviteToProject: [{ invitation: ["create"] }],
  cancelProjectInvitations: [{ invitation: ["cancel"] }],
} satisfies Record<string, PermissionMap[]>;

// Integrations stay with `workspace:manage_settings` in the workspace role.
const INTEGRATIONS_PERMISSION = { workspace: ["manage_settings"] };

export type ProjectCapabilities = Record<
  | keyof typeof PROJECT_LEVEL_CAPABILITIES
  | keyof typeof PROJECT_STATEMENT_CAPABILITIES
  | "manageIntegrations",
  boolean
>;

// The role behind the access: the project role of a member, the workspace role
// of a full-access user (`null` for an instance administrator who is not a
// member of the workspace, or a workspace role that is ambiguous).
async function effectiveRole(
  userId: string,
  access: ProjectAccess,
): Promise<string | null> {
  if (access.mode === "member") {
    const [row] = await db
      .select({ role: schema.projectMemberTable.role })
      .from(schema.projectMemberTable)
      .where(
        and(
          eq(schema.projectMemberTable.projectId, access.projectId),
          eq(schema.projectMemberTable.userId, userId),
        ),
      )
      .limit(1);
    return row?.role ?? null;
  }
  const rows = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, access.workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    );
  return singleWorkspaceRole(rows.map((row) => row.role));
}

function allowedByProjectStatements(
  c: Context,
  access: ProjectAccess,
  alternatives: PermissionMap[],
): boolean {
  return alternatives.some(
    (required) =>
      apiKeyAllows(c, required) && projectAccessSatisfies(access, required),
  );
}

async function getProjectAccess(c: Context, access: ProjectAccess) {
  const userId = c.get("userId") as string;

  const projectLevel = Object.entries(PROJECT_LEVEL_CAPABILITIES);
  const [role, integrations, ...projectLevelResults] = await Promise.all([
    effectiveRole(userId, access),
    hasWorkspacePermission(c, INTEGRATIONS_PERMISSION),
    ...projectLevel.map(([, required]) => hasWorkspacePermission(c, required)),
  ]);

  const capabilities = {
    ...Object.fromEntries(
      projectLevel.map(([key], index) => [key, projectLevelResults[index]]),
    ),
    ...Object.fromEntries(
      Object.entries(PROJECT_STATEMENT_CAPABILITIES).map(
        ([key, alternatives]) => [
          key,
          allowedByProjectStatements(c, access, alternatives),
        ],
      ),
    ),
    manageIntegrations: integrations,
  } as ProjectCapabilities;

  return { mode: access.mode, role, capabilities };
}

export default getProjectAccess;
