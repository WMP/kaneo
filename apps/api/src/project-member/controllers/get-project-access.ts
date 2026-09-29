import type { Context } from "hono";
import { isCloudGuest } from "../../project-invitation/cloud-gates";
import {
  type ProjectAccess,
  projectAccessSatisfies,
  workspaceRoleSatisfies,
} from "../../utils/project-access";
import { apiKeyAllows } from "../../utils/require-workspace-permission";
import type { PermissionMap } from "../../utils/role-statements";
import { mayUseProjectStatements } from "../delegation";

// Every capability is decided from the access `workspaceAccess` already
// resolved for this request (the single decision point is `decide()` in
// `utils/project-access.ts`) plus the API key scope: no query runs here.
//
// - Project-level resources (`task`, `label`, `project`) use the effective
//   project statements, like `requireWorkspacePermission` does.
// - `member` and `invitation` also use the effective project statements: the
//   project member and invitation routes are the exception to the
//   workspace-level rule (`mayUseProjectStatements`, shared with their asserts).
// - Workspace label definitions and integrations are workspace-level: they
//   follow the caller's WORKSPACE role.

function allowedByProject(
  c: Context,
  access: ProjectAccess,
  required: PermissionMap,
): boolean {
  return apiKeyAllows(c, required) && projectAccessSatisfies(access, required);
}

function allowedByWorkspaceRole(
  c: Context,
  access: ProjectAccess,
  required: PermissionMap,
): boolean {
  return apiKeyAllows(c, required) && workspaceRoleSatisfies(access, required);
}

export type ProjectCapabilities = {
  createTasks: boolean;
  updateTasks: boolean;
  deleteTasks: boolean;
  assignTasks: boolean;
  createLabels: boolean;
  attachLabels: boolean;
  manageWorkspaceLabels: boolean;
  updateProject: boolean;
  deleteProject: boolean;
  shareProject: boolean;
  manageMembers: boolean;
  addMembers: boolean;
  inviteToProject: boolean;
  cancelProjectInvitations: boolean;
  manageIntegrations: boolean;
};

function getProjectAccess(c: Context, access: ProjectAccess) {
  const capabilities: ProjectCapabilities = {
    createTasks: allowedByProject(c, access, { task: ["create"] }),
    updateTasks: allowedByProject(c, access, { task: ["update"] }),
    deleteTasks: allowedByProject(c, access, { task: ["delete"] }),
    assignTasks: allowedByProject(c, access, { task: ["assign"] }),
    // Creating a label on a task, and attaching or detaching one.
    createLabels: allowedByProject(c, access, { label: ["create"] }),
    attachLabels: allowedByProject(c, access, { label: ["update"] }),
    // Label definitions of the workspace (no task) follow the workspace role.
    manageWorkspaceLabels: allowedByWorkspaceRole(c, access, {
      label: ["create", "update", "delete"],
    }),
    updateProject: allowedByProject(c, access, { project: ["update"] }),
    deleteProject: allowedByProject(c, access, { project: ["delete"] }),
    shareProject: allowedByProject(c, access, { project: ["share"] }),
    addMembers: mayUseProjectStatements(c, access, { member: ["create"] }),
    manageMembers: (["create", "update", "delete"] as const).some((action) =>
      mayUseProjectStatements(c, access, { member: [action] }),
    ),
    // Guests of Kaneo Cloud may not send invitations (same gate as the
    // routes). An API key request carries no session user, so the guest flag
    // is unknown here; the route still refuses.
    inviteToProject:
      mayUseProjectStatements(c, access, { invitation: ["create"] }) &&
      !isCloudGuest(c.get("user")),
    cancelProjectInvitations: mayUseProjectStatements(c, access, {
      invitation: ["cancel"],
    }),
    // Full access holds `workspace:manage_settings`, a project role never
    // does; the routes decide on the workspace role.
    manageIntegrations:
      access.mode === "full" &&
      allowedByWorkspaceRole(c, access, { workspace: ["manage_settings"] }),
  };

  return { mode: access.mode, role: access.role, capabilities };
}

export default getProjectAccess;
