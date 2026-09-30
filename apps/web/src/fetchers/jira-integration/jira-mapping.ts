import { client } from "@kaneo/libs";
import { jiraRequestError } from "./jira-request-error";
import type { JiraMappingConfig } from "./types";

const jira = client["jira-integration"];

export async function getJiraWorkspaceMapping(workspaceId: string) {
  const response = await jira.workspace[":workspaceId"].mapping.$get({
    param: { workspaceId },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function putJiraWorkspaceMapping(
  workspaceId: string,
  config: JiraMappingConfig,
) {
  const response = await jira.workspace[":workspaceId"].mapping.$put({
    param: { workspaceId },
    json: { config },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function getJiraProjectMapping(projectId: string) {
  const response = await jira.project[":projectId"].mapping.$get({
    param: { projectId },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function putJiraProjectMapping(
  projectId: string,
  config: JiraMappingConfig,
) {
  const response = await jira.project[":projectId"].mapping.$put({
    param: { projectId },
    json: { config },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function getJiraUserMapping(workspaceId: string) {
  const response = await jira.workspace[":workspaceId"].me.mapping.$get({
    param: { workspaceId },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function putJiraUserMapping(
  workspaceId: string,
  config: JiraMappingConfig,
) {
  const response = await jira.workspace[":workspaceId"].me.mapping.$put({
    param: { workspaceId },
    json: { config },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function getJiraResolvedMapping(projectId: string) {
  const response = await jira.project[":projectId"]["resolved-mapping"].$get({
    param: { projectId },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}
