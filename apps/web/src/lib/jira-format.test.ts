import { describe, expect, it } from "vitest";
import { formatJiraTimestamp, safeJiraUrl } from "./jira-format";

describe("safeJiraUrl", () => {
  it("accepts web URLs only", () => {
    expect(safeJiraUrl("https://jira.example.com/browse/A-1")).toBe(
      "https://jira.example.com/browse/A-1",
    );
    expect(safeJiraUrl("http://jira.internal/browse/A-1")).toBe(
      "http://jira.internal/browse/A-1",
    );
    expect(safeJiraUrl("javascript:alert(1)")).toBeNull();
    expect(safeJiraUrl("data:text/html,x")).toBeNull();
    expect(safeJiraUrl("not a url")).toBeNull();
    expect(safeJiraUrl(null)).toBeNull();
  });
});

describe("formatJiraTimestamp", () => {
  it("returns null for a missing or invalid value", () => {
    expect(formatJiraTimestamp(null, "en-US")).toBeNull();
    expect(formatJiraTimestamp("nope", "en-US")).toBeNull();
  });

  it("formats a timestamp", () => {
    expect(formatJiraTimestamp("2026-09-30T08:00:00Z", "en-US")).toMatch(
      /2026/,
    );
  });
});
