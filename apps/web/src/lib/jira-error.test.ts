import { describe, expect, it } from "vitest";
import { JiraRequestError } from "@/fetchers/jira-integration/jira-request-error";
import {
  getJiraErrorMessage,
  getJiraFailureDetails,
  getJiraFieldErrors,
} from "./jira-error";

const t = (key: string) => key;

function failed(details: ConstructorParameters<typeof JiraRequestError>[2]) {
  return new JiraRequestError(502, "failed", details);
}

describe("getJiraFieldErrors", () => {
  it("keeps only the messages about the given fields", () => {
    const error = failed({
      code: "JIRA_REQUEST_FAILED",
      errors: { summary: "Too long", customfield_1: "Invalid", labels: " " },
    });

    expect(getJiraFieldErrors(error, ["summary", "labels"])).toEqual({
      summary: "Too long",
    });
  });

  it("is empty for an error that is not from Jira", () => {
    expect(getJiraFieldErrors(new Error("boom"), ["summary"])).toEqual({});
  });
});

describe("getJiraFailureDetails and getJiraErrorMessage", () => {
  const error = failed({
    code: "JIRA_REQUEST_FAILED",
    errorMessages: ["Issue type invalid"],
    errors: { summary: "Too long", customfield_1: "Invalid" },
  });

  it("lists everything by default", () => {
    expect(getJiraFailureDetails(error)).toEqual([
      "Issue type invalid",
      "Too long",
      "Invalid",
    ]);
  });

  it("leaves out the fields the caller shows itself", () => {
    expect(
      getJiraErrorMessage(error, t, "fallback", {
        excludeFieldIds: ["summary"],
      }),
    ).toBe(
      "settings:jiraIntegration.errors.requestFailed Issue type invalid Invalid",
    );
  });

  it.each([
    ["JIRA_ISSUE_ALREADY_LINKED", "issueAlreadyLinked"],
    ["JIRA_NOT_LINKED", "notLinked"],
    ["PROPOSAL_NOT_PENDING", "proposalNotPending"],
    ["STATUS_REQUIRED", "statusRequired"],
  ])("translates %s", (code, key) => {
    expect(
      getJiraErrorMessage(new JiraRequestError(409, "x", { code }), t, "fb"),
    ).toBe(`settings:jiraIntegration.errors.${key}`);
  });
});
