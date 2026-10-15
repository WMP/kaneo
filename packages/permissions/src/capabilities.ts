// Named permission bundles the web app gates UI on. The API evaluates them all
// in one request (GET /workspace/{id}/capabilities) with the same rules it
// enforces, so custom workspace roles behave the same in the UI and the API.
export const workspaceCapabilities = {
  manageProjects: { project: ["create", "update", "delete"] },
  createProjects: { project: ["create"] },
  updateProjects: { project: ["update"] },
  shareProjects: { project: ["share"] },
  deleteProjects: { project: ["delete"] },
  updateTasks: { task: ["update"] },
  createTasks: { task: ["create"] },
  deleteTasks: { task: ["delete"] },
  assignTasks: { task: ["assign"] },
  createLabels: { label: ["create"] },
  updateLabels: { label: ["update"] },
  deleteLabels: { label: ["delete"] },
  manageWorkspace: { workspace: ["update", "manage_settings"] },
  manageSettings: { workspace: ["manage_settings"] },
  deleteWorkspace: { workspace: ["delete"] },
  inviteUsers: { invitation: ["create"] },
  // Adding an existing account without an invitation, and the user directory
  // that finds it: the WORKSPACE role's member:create.
  addMembers: { member: ["create"] },
  cancelInvitations: { invitation: ["cancel"] },
  manageTeam: { member: ["update", "delete"] },
  updateMembers: { member: ["update"] },
  removeMembers: { member: ["delete"] },
  // Exactly what POST /api/resource/{id}/link requires (workspace role).
  linkResources: { project: ["update"], member: ["update"] },
} as const satisfies Record<string, Record<string, readonly string[]>>;

export type WorkspaceCapability = keyof typeof workspaceCapabilities;

export const WORKSPACE_CAPABILITY_NAMES = Object.keys(
  workspaceCapabilities,
) as WorkspaceCapability[];
