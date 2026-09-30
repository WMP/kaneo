function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number") return String(value);
  return null;
}

export type JiraStatusWebhookChange = {
  issueId: string | null;
  issueKey: string | null;
  statusId: string | null;
  statusName: string;
  fromStatusName: string | null;
  changedBy: string | null;
  changedAt: Date | null;
};

// The status change a `jira:issue_updated` payload reports, or null for
// anything else (other events, updates that do not touch the status). Pure.
export function parseJiraStatusWebhook(
  payload: unknown,
): JiraStatusWebhookChange | null {
  if (!isRecord(payload) || payload.webhookEvent !== "jira:issue_updated") {
    return null;
  }
  const changelog = payload.changelog;
  const issue = payload.issue;
  if (!isRecord(changelog) || !isRecord(issue)) return null;
  if (!Array.isArray(changelog.items)) return null;

  const item = changelog.items.find(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) && entry.field === "status",
  );
  if (!item) return null;

  const statusName = text(item.toString);
  if (!statusName) return null;

  const issueId = text(issue.id);
  const issueKey = text(issue.key);
  if (!issueId && !issueKey) return null;

  const user = isRecord(payload.user) ? payload.user : null;
  const timestamp =
    typeof payload.timestamp === "number" ? new Date(payload.timestamp) : null;

  return {
    issueId,
    issueKey,
    statusId: text(item.to),
    statusName,
    fromStatusName: text(item.fromString),
    changedBy: user
      ? (text(user.displayName) ?? text(user.name) ?? text(user.accountId))
      : null,
    changedAt:
      timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : null,
  };
}
