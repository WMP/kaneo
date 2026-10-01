import { client } from "@kaneo/libs";
import { jiraRequestError } from "./jira-request-error";
import type { JiraSendRequest } from "./types";

const task = client["jira-integration"].task[":taskId"];
const proposal = client["jira-integration"].proposal[":proposalId"];

export async function getJiraTaskInfo(taskId: string) {
  const response = await task.$get({ param: { taskId } });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

// Without a project and issue type the API reads the create metadata of the
// mapped target; with both it reads that of the one the person picked.
export async function getJiraDraft(
  taskId: string,
  target: { jiraProjectKey?: string; issueTypeId?: string } = {},
) {
  const response = await task.draft.$get({
    param: { taskId },
    query: {
      ...(target.jiraProjectKey
        ? { jiraProjectKey: target.jiraProjectKey }
        : {}),
      ...(target.issueTypeId ? { issueTypeId: target.issueTypeId } : {}),
    },
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function sendTaskToJira(taskId: string, json: JiraSendRequest) {
  const response = await task.send.$post({ param: { taskId }, json });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function refreshJiraTask(taskId: string) {
  const response = await task.refresh.$post({ param: { taskId } });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function unlinkJiraTask(taskId: string) {
  const response = await task.link.$delete({ param: { taskId } });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

// The status is only needed when the proposal has no mapped Kaneo status.
export async function acceptJiraProposal(proposalId: string, status?: string) {
  const response = await proposal.accept.$post({
    param: { proposalId },
    json: status ? { status } : {},
  });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}

export async function rejectJiraProposal(proposalId: string) {
  const response = await proposal.reject.$post({ param: { proposalId } });
  if (!response.ok) throw await jiraRequestError(response);
  return response.json();
}
