import { desc, eq } from "drizzle-orm";
import db from "../database";
import {
  jiraIssueLinkTable,
  jiraStatusProposalTable,
} from "../database/schema";
import type { JiraIssue } from "./jira-client";
import { findJiraUserToken } from "./tokens";

export type JiraIssueLinkRow = typeof jiraIssueLinkTable.$inferSelect;
export type JiraStatusProposalRow = typeof jiraStatusProposalTable.$inferSelect;

export const RECENT_PROPOSALS_LIMIT = 10;

export function buildIssueUrl(baseUrl: string, issueKey: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/browse/${encodeURIComponent(issueKey)}`;
}

// The status of an issue read with `fields: ["status"]`.
export function readIssueStatus(
  issue: JiraIssue,
): { id: string | null; name: string } | null {
  const status = issue.fields?.status;
  if (!status || typeof status !== "object") return null;
  const { id, name } = status as { id?: unknown; name?: unknown };
  if (typeof name !== "string" || name === "") return null;
  return {
    id: typeof id === "string" || typeof id === "number" ? String(id) : null,
    name,
  };
}

export async function findLinkByTask(
  taskId: string,
): Promise<JiraIssueLinkRow | null> {
  const [link] = await db
    .select()
    .from(jiraIssueLinkTable)
    .where(eq(jiraIssueLinkTable.taskId, taskId))
    .limit(1);
  return link ?? null;
}

export function toLinkResponse(link: JiraIssueLinkRow) {
  return {
    id: link.id,
    taskId: link.taskId,
    issueId: link.issueId,
    issueKey: link.issueKey,
    issueUrl: link.issueUrl,
    jiraProjectKey: link.jiraProjectKey,
    lastStatusId: link.lastStatusId,
    lastStatusName: link.lastStatusName,
    lastSyncedAt: link.lastSyncedAt,
    syncError: link.syncError,
    createdByUserId: link.createdByUserId,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

export function toProposalResponse(proposal: JiraStatusProposalRow) {
  return {
    id: proposal.id,
    taskId: proposal.taskId,
    linkId: proposal.linkId,
    fromStatusName: proposal.fromStatusName,
    toStatusId: proposal.toStatusId,
    toStatusName: proposal.toStatusName,
    proposedStatus: proposal.proposedStatus,
    state: proposal.state as "pending" | "accepted" | "rejected" | "superseded",
    jiraChangedBy: proposal.jiraChangedBy,
    jiraChangedAt: proposal.jiraChangedAt,
    source: proposal.source as "webhook" | "poll" | "manual",
    resolvedByUserId: proposal.resolvedByUserId,
    resolvedStatus: proposal.resolvedStatus,
    resolvedAt: proposal.resolvedAt,
    createdAt: proposal.createdAt,
  };
}

// Whether the poll can read this link: it uses the token of the person who
// linked the issue. Never the token itself.
export async function describeLinkSync(
  link: JiraIssueLinkRow,
  connection: { pollingEnabled: boolean; isActive: boolean },
) {
  let creatorTokenState: "ok" | "missing" | "invalid" = "missing";
  if (link.createdByUserId) {
    const token = await findJiraUserToken(
      link.connectionId,
      link.createdByUserId,
    );
    if (token) creatorTokenState = token.lastError ? "invalid" : "ok";
  }
  return {
    pollingEnabled: connection.pollingEnabled && connection.isActive,
    creatorTokenState,
  };
}

export async function listRecentProposals(
  taskId: string,
): Promise<JiraStatusProposalRow[]> {
  return db
    .select()
    .from(jiraStatusProposalTable)
    .where(eq(jiraStatusProposalTable.taskId, taskId))
    .orderBy(
      desc(jiraStatusProposalTable.createdAt),
      desc(jiraStatusProposalTable.id),
    )
    .limit(RECENT_PROPOSALS_LIMIT);
}
