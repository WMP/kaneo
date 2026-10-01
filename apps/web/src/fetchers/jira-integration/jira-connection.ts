import { client } from "@kaneo/libs";
import { jiraRequestError } from "./jira-request-error";
import type { PutJiraConnectionRequest } from "./types";

const connection =
  client["jira-integration"].workspace[":workspaceId"].connection;

export async function getJiraConnection(workspaceId: string) {
  const response = await connection.$get({
    param: { workspaceId },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function putJiraConnection(
  workspaceId: string,
  json: PutJiraConnectionRequest,
) {
  const response = await connection.$put({
    param: { workspaceId },
    json,
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function rotateJiraWebhookSecret(workspaceId: string) {
  const response = await connection["rotate-webhook-secret"].$post({
    param: { workspaceId },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function deleteJiraConnection(workspaceId: string) {
  const response = await connection.$delete({
    param: { workspaceId },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}
