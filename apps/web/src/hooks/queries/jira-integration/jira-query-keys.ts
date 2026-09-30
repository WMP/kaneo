// Every Jira query lives under ["jira-integration", ...] so a change that
// affects several of them (deleting the connection, saving a parent mapping)
// can invalidate the whole family with one prefix.
export const jiraQueryKeys = {
  all: ["jira-integration"] as const,
  connection: (workspaceId: string) =>
    ["jira-integration", "connection", workspaceId] as const,
  mappings: ["jira-integration", "mapping"] as const,
  workspaceMapping: (workspaceId: string) =>
    ["jira-integration", "mapping", "workspace", workspaceId] as const,
  projectMapping: (projectId: string) =>
    ["jira-integration", "mapping", "project", projectId] as const,
  userMapping: (workspaceId: string) =>
    ["jira-integration", "mapping", "user", workspaceId] as const,
  resolvedMappings: ["jira-integration", "resolved-mapping"] as const,
  resolvedMapping: (projectId: string) =>
    ["jira-integration", "resolved-mapping", projectId] as const,
  token: (workspaceId: string) =>
    ["jira-integration", "token", workspaceId] as const,
  meta: (workspaceId: string) =>
    ["jira-integration", "meta", workspaceId] as const,
  // Task-level keys sit next to the task caches (["task", id], ["activities",
  // id]) so the project socket can refresh them by task id alone.
  tasks: ["jira-task"] as const,
  task: (taskId: string) => ["jira-task", taskId] as const,
  drafts: ["jira-draft"] as const,
  draft: (
    taskId: string,
    jiraProjectKey: string | undefined,
    issueTypeId: string | undefined,
  ) => ["jira-draft", taskId, jiraProjectKey ?? "", issueTypeId ?? ""] as const,
};
