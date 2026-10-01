import { eq } from "drizzle-orm";
import createActivity from "../activity/controllers/create-activity";
import db from "../database";
import { jiraIssueLinkTable, type taskTable } from "../database/schema";
import { publishEvent } from "../events";
import { jiraError, toJiraHttpError } from "./errors";
import { JiraApiError } from "./jira-client";
import {
  describeLinkSync,
  findLinkByTask,
  listRecentProposals,
  readIssueStatus,
  toLinkResponse,
  toProposalResponse,
} from "./links";
import { processJiraStatusChange } from "./status-sync";
import {
  clearJiraTokenError,
  findJiraConnection,
  getJiraClientForUser,
  markJiraTokenError,
} from "./tokens";

type TaskRow = typeof taskTable.$inferSelect;

// The link of a task, its pending proposal and the recent ones. Answers for a
// workspace without a connection too: there is simply nothing linked.
export async function loadTaskInfo(task: TaskRow, workspaceId: string) {
  const [link, proposals, connection] = await Promise.all([
    findLinkByTask(task.id),
    listRecentProposals(task.id),
    findJiraConnection(workspaceId),
  ]);
  return {
    link: link ? toLinkResponse(link) : null,
    pendingProposal:
      proposals
        .filter((proposal) => proposal.state === "pending")
        .map(toProposalResponse)[0] ?? null,
    proposals: proposals.map(toProposalResponse),
    sync: link && connection ? await describeLinkSync(link, connection) : null,
  };
}

// Reads the issue's status now, with the CALLER's token, and processes a
// change like the webhook and the poll do (never changing the task's status).
export async function refreshTaskStatus({
  task,
  workspaceId,
  userId,
}: {
  task: TaskRow;
  workspaceId: string;
  userId: string;
}) {
  const link = await findLinkByTask(task.id);
  if (!link) {
    throw jiraError(
      404,
      "JIRA_NOT_LINKED",
      "This task is not linked to a Jira issue.",
    );
  }

  const { client, tokenRow } = await getJiraClientForUser(workspaceId, userId);

  let issue: Awaited<ReturnType<typeof client.getIssue>>;
  try {
    issue = await client.getIssue(link.issueKey, ["status"]);
  } catch (error) {
    if (
      error instanceof JiraApiError &&
      error.kind === "HTTP_ERROR" &&
      error.status === 401
    ) {
      await markJiraTokenError(tokenRow.id, "Jira rejected the token.");
    }
    throw toJiraHttpError(error);
  }
  if (tokenRow.lastError) await clearJiraTokenError(tokenRow.id);

  const status = readIssueStatus(issue);
  if (!status) {
    throw jiraError(
      502,
      "JIRA_REQUEST_FAILED",
      "Jira did not return a status for this issue.",
    );
  }

  const result = await processJiraStatusChange(link, {
    statusId: status.id,
    statusName: status.name,
    source: "manual",
    actorUserId: userId,
  });
  return { changed: result.changed };
}

// Removes the link (and, with it, its proposals). The Jira issue is untouched.
export async function unlinkTask({
  task,
  userId,
}: {
  task: TaskRow;
  userId: string;
}): Promise<boolean> {
  const [removed] = await db
    .delete(jiraIssueLinkTable)
    .where(eq(jiraIssueLinkTable.taskId, task.id))
    .returning();
  if (!removed) return false;

  await createActivity(task.id, "jira_issue_unlinked", userId, null, {
    issueKey: removed.issueKey,
    issueUrl: removed.issueUrl,
  });
  try {
    await publishEvent("jira.issue_unlinked", {
      taskId: task.id,
      projectId: task.projectId,
      userId,
      issueKey: removed.issueKey,
    });
  } catch (error) {
    console.error("Failed to publish jira.issue_unlinked", error);
  }
  return true;
}
