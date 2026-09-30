import { describe, expect, it } from "vitest";
import { parseJiraStatusWebhook } from "../../../apps/api/src/jira-integration/webhook-payload";

const payload = (overrides: Record<string, unknown> = {}) => ({
  webhookEvent: "jira:issue_updated",
  timestamp: 1_790_000_000_000,
  user: { name: "bob", displayName: "Bob Example" },
  issue: { id: "10001", key: "PRJ-1" },
  changelog: {
    items: [
      { field: "assignee", toString: "alice" },
      {
        field: "status",
        from: "3",
        fromString: "In Progress",
        to: "10001",
        toString: "Done",
      },
    ],
  },
  ...overrides,
});

describe("parseJiraStatusWebhook", () => {
  it("reads the status item of an issue update", () => {
    expect(parseJiraStatusWebhook(payload())).toEqual({
      issueId: "10001",
      issueKey: "PRJ-1",
      statusId: "10001",
      statusName: "Done",
      fromStatusName: "In Progress",
      changedBy: "Bob Example",
      changedAt: new Date(1_790_000_000_000),
    });
  });

  it("ignores other events, and updates that do not touch the status", () => {
    expect(
      parseJiraStatusWebhook(payload({ webhookEvent: "jira:issue_created" })),
    ).toBeNull();
    expect(
      parseJiraStatusWebhook(
        payload({
          changelog: { items: [{ field: "summary", toString: "x" }] },
        }),
      ),
    ).toBeNull();
    expect(parseJiraStatusWebhook(payload({ changelog: {} }))).toBeNull();
    expect(parseJiraStatusWebhook(payload({ issue: {} }))).toBeNull();
    expect(parseJiraStatusWebhook(null)).toBeNull();
    expect(parseJiraStatusWebhook("text")).toBeNull();
    expect(parseJiraStatusWebhook([])).toBeNull();
  });

  it("needs the new status name", () => {
    expect(
      parseJiraStatusWebhook(
        payload({ changelog: { items: [{ field: "status", to: "1" }] } }),
      ),
    ).toBeNull();
  });
});
