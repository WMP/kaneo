import { and, eq, inArray, isNotNull } from "drizzle-orm";
import db from "../database";
import {
  jiraConnectionTable,
  jiraIssueLinkTable,
  workspaceUserTable,
} from "../database/schema";
import { JiraApiError } from "../jira-integration/jira-client";
import {
  type JiraIssueLinkRow,
  readIssueStatus,
} from "../jira-integration/links";
import { processJiraStatusChange } from "../jira-integration/status-sync";
import {
  clearJiraTokenError,
  createJiraClientForToken,
  findJiraUserToken,
  type JiraConnectionRow,
  markJiraTokenError,
} from "../jira-integration/tokens";
import { withJobLease } from "./leader-lock";

export const JIRA_STATUS_POLL_LEASE = "jira-status-poll";
export const JIRA_POLL_BATCH_SIZE = 50;

// The lease outlasts one tick: a slow run makes the next tick skip instead of
// overlapping it, and a crashed instance frees the lease after ten minutes.
const LEASE_MS = 10 * 60 * 1000;

function quoteJql(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function setSyncError(linkIds: string[], message: string) {
  if (linkIds.length === 0) return;
  await db
    .update(jiraIssueLinkTable)
    .set({ syncError: message })
    .where(inArray(jiraIssueLinkTable.id, linkIds));
}

// Reads the links one person created with THAT person's token. A link whose
// creator has no token, or a rejected one, is skipped; nobody else's token
// stands in for it.
async function pollCreatorLinks(
  connection: JiraConnectionRow,
  creatorId: string,
  links: JiraIssueLinkRow[],
): Promise<{ degraded: boolean }> {
  // Somebody who left the workspace no longer acts in it: their token is not
  // used, even though the row may still exist.
  const [membership] = await db
    .select({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, connection.workspaceId),
        eq(workspaceUserTable.userId, creatorId),
      ),
    )
    .limit(1);
  if (!membership) {
    await setSyncError(
      links.map((link) => link.id),
      "The person who linked this issue is no longer a member of the workspace, so it is not polled.",
    );
    return { degraded: false };
  }

  const tokenRow = await findJiraUserToken(connection.id, creatorId);
  if (!tokenRow) {
    await setSyncError(
      links.map((link) => link.id),
      "The person who linked this issue has no Jira token, so it is not polled.",
    );
    return { degraded: false };
  }

  let client: ReturnType<typeof createJiraClientForToken>;
  try {
    client = createJiraClientForToken(connection, tokenRow);
  } catch {
    await markJiraTokenError(
      tokenRow.id,
      "The stored Jira token cannot be read. Enter it again.",
    );
    return { degraded: false };
  }

  let degraded = false;
  for (const batch of chunk(links, JIRA_POLL_BATCH_SIZE)) {
    let issues: Awaited<ReturnType<typeof client.searchIssues>>;
    try {
      issues = await client.searchIssues(
        `key in (${batch.map((link) => quoteJql(link.issueKey)).join(", ")})`,
        ["status"],
      );
    } catch (error) {
      if (
        error instanceof JiraApiError &&
        error.kind === "HTTP_ERROR" &&
        error.status === 401
      ) {
        await markJiraTokenError(tokenRow.id, "Jira rejected the token.");
        // The rest of this person's links would be rejected the same way.
        return { degraded };
      }
      degraded = true;
      console.error("Jira status poll failed", {
        connectionId: connection.id,
        message: error instanceof Error ? error.message : "unknown error",
      });
      await setSyncError(
        batch.map((link) => link.id),
        "Jira could not be read for the last poll.",
      );
      continue;
    }

    if (tokenRow.lastError) {
      await clearJiraTokenError(tokenRow.id);
      tokenRow.lastError = null;
    }

    const byId = new Map(issues.map((issue) => [String(issue.id), issue]));
    const byKey = new Map(issues.map((issue) => [issue.key, issue]));
    for (const link of batch) {
      try {
        const issue = byId.get(link.issueId) ?? byKey.get(link.issueKey);
        const status = issue ? readIssueStatus(issue) : null;
        if (!status) {
          await setSyncError(
            [link.id],
            "The issue was not found, or the person who linked it can no longer see it.",
          );
          continue;
        }
        await processJiraStatusChange(link, {
          statusId: status.id,
          statusName: status.name,
          source: "poll",
        });
      } catch (error) {
        degraded = true;
        console.error("Failed to process a polled Jira status", {
          linkId: link.id,
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
    }
  }
  return { degraded };
}

async function runPoll(): Promise<{ degraded: boolean }> {
  const connections = await db
    .select()
    .from(jiraConnectionTable)
    .where(
      and(
        eq(jiraConnectionTable.isActive, true),
        eq(jiraConnectionTable.pollingEnabled, true),
      ),
    );

  let degraded = false;
  for (const connection of connections) {
    try {
      const links = await db
        .select()
        .from(jiraIssueLinkTable)
        .where(
          and(
            eq(jiraIssueLinkTable.connectionId, connection.id),
            isNotNull(jiraIssueLinkTable.createdByUserId),
          ),
        );

      const byCreator = new Map<string, JiraIssueLinkRow[]>();
      for (const link of links) {
        if (!link.createdByUserId) continue;
        const group = byCreator.get(link.createdByUserId) ?? [];
        group.push(link);
        byCreator.set(link.createdByUserId, group);
      }

      for (const [creatorId, group] of byCreator) {
        try {
          const outcome = await pollCreatorLinks(connection, creatorId, group);
          degraded ||= outcome.degraded;
        } catch (error) {
          degraded = true;
          console.error("Jira status poll failed for a user", {
            connectionId: connection.id,
            message: error instanceof Error ? error.message : "unknown error",
          });
        }
      }
    } catch (error) {
      degraded = true;
      console.error("Jira status poll failed for a connection", {
        connectionId: connection.id,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  }
  return { degraded };
}

// Every 5 minutes (scheduler/index.ts): reads the linked issues of every active
// connection that polls, and hands what it sees to `processJiraStatusChange`.
export function pollJiraStatuses(): Promise<{ degraded: boolean }> {
  return withJobLease(
    JIRA_STATUS_POLL_LEASE,
    runPoll,
    () => ({ degraded: false }),
    LEASE_MS,
  );
}
