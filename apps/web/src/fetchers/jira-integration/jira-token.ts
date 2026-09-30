import { client } from "@kaneo/libs";
import { jiraRequestError } from "./jira-request-error";
import type { PutJiraTokenRequest } from "./types";

const token = client["jira-integration"].workspace[":workspaceId"].me.token;

export async function getJiraTokenStatus(workspaceId: string) {
  const response = await token.$get({ param: { workspaceId } });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

// The API verifies the token against Jira before it stores it; the token is
// never returned.
export async function putJiraToken(
  workspaceId: string,
  json: PutJiraTokenRequest,
) {
  const response = await token.$put({
    param: { workspaceId },
    json,
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function deleteJiraToken(workspaceId: string) {
  const response = await token.$delete({
    param: { workspaceId },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}
