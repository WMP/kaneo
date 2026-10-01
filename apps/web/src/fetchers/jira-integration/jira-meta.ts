import { client } from "@kaneo/libs";
import { jiraRequestError } from "./jira-request-error";

const meta = client["jira-integration"].workspace[":workspaceId"].meta;

export async function listJiraProjects(workspaceId: string) {
  const response = await meta.projects.$get({
    param: { workspaceId },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function listJiraIssueTypes(
  workspaceId: string,
  projectKey: string,
) {
  const response = await meta["issue-types"].$get({
    param: { workspaceId },
    query: { projectKey },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function listJiraCreateFields(
  workspaceId: string,
  projectKey: string,
  issueTypeId: string,
) {
  const response = await meta.fields.$get({
    param: { workspaceId },
    query: { projectKey, issueTypeId },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function listJiraStatuses(
  workspaceId: string,
  projectKey: string,
) {
  const response = await meta.statuses.$get({
    param: { workspaceId },
    query: { projectKey },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function listJiraComponents(
  workspaceId: string,
  projectKey: string,
) {
  const response = await meta.components.$get({
    param: { workspaceId },
    query: { projectKey },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function searchJiraUsers(
  workspaceId: string,
  query: string,
  projectKey?: string,
) {
  const response = await meta.users.$get({
    param: { workspaceId },
    query: { query, ...(projectKey ? { projectKey } : {}) },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}
