import { describe, expect, it } from "vitest";
import {
  buildJiraIssueFields,
  convertFieldValue,
  JiraFieldValueError,
  toJiraLabel,
} from "../../../apps/api/src/jira-integration/field-values";

const server = { deployment: "server" } as const;
const cloud = { deployment: "cloud" } as const;

describe("convertFieldValue", () => {
  it("converts text and string fields and leaves empty ones out", () => {
    expect(convertFieldValue("string", "Title", server)).toBe("Title");
    expect(convertFieldValue("text", "Line 1\nLine 2", server)).toBe(
      "Line 1\nLine 2",
    );
    expect(convertFieldValue("string", 12, server)).toBe("12");
    expect(convertFieldValue("string", "   ", server)).toBeUndefined();
    expect(convertFieldValue("text", null, server)).toBeUndefined();
    expect(convertFieldValue("text", undefined, server)).toBeUndefined();
  });

  it("turns booleans into the strings true and false unless a value map maps them", () => {
    expect(convertFieldValue("string", true, server)).toBe("true");
    expect(convertFieldValue("string", false, server)).toBe("false");
    expect(
      convertFieldValue("option", "true", {
        ...server,
        valueMap: { true: "Yes", false: "No" },
      }),
    ).toEqual({ value: "Yes" });
    expect(
      convertFieldValue("string", false, {
        ...server,
        valueMap: { true: "Yes", false: "No" },
      }),
    ).toBe("No");
  });

  it("converts numbers and refuses text that is not one", () => {
    expect(convertFieldValue("number", 3, server)).toBe(3);
    expect(convertFieldValue("number", "4.5", server)).toBe(4.5);
    expect(convertFieldValue("number", "", server)).toBeUndefined();
    expect(() =>
      convertFieldValue("number", "abc", {
        ...server,
        fieldId: "customfield_1",
      }),
    ).toThrow(JiraFieldValueError);
  });

  it("formats dates as YYYY-MM-DD and datetimes as ISO 8601", () => {
    expect(convertFieldValue("date", "2026-09-30", server)).toBe("2026-09-30");
    expect(convertFieldValue("date", "2026-09-30T23:30:00.000Z", server)).toBe(
      "2026-09-30",
    );
    expect(convertFieldValue("date", "", server)).toBeUndefined();
    expect(() => convertFieldValue("date", "2026-02-31", server)).toThrow(
      JiraFieldValueError,
    );
    expect(() => convertFieldValue("date", "yesterday", server)).toThrow(
      JiraFieldValueError,
    );
    expect(
      convertFieldValue("datetime", "2026-09-30T10:15:00+02:00", server),
    ).toBe("2026-09-30T08:15:00.000Z");
    expect(() => convertFieldValue("datetime", "nope", server)).toThrow(
      JiraFieldValueError,
    );
  });

  it("wraps option, options, components and priority", () => {
    expect(convertFieldValue("option", "Team A", server)).toEqual({
      value: "Team A",
    });
    expect(convertFieldValue("option", "", server)).toBeUndefined();
    expect(convertFieldValue("options", ["A", "B", "A"], server)).toEqual([
      { value: "A" },
      { value: "B" },
    ]);
    expect(convertFieldValue("components", ["Backend", "API"], server)).toEqual(
      [{ name: "Backend" }, { name: "API" }],
    );
    expect(convertFieldValue("components", [], server)).toBeUndefined();
    expect(convertFieldValue("priority", "High", server)).toEqual({
      name: "High",
    });
  });

  it("reads Kaneo multiselect values stored as a JSON array in text", () => {
    expect(convertFieldValue("options", '["A","B"]', server)).toEqual([
      { value: "A" },
      { value: "B" },
    ]);
    expect(convertFieldValue("options", "[]", server)).toBeUndefined();
    expect(convertFieldValue("labels", '["one","two words"]', server)).toEqual([
      "one",
      "two-words",
    ]);
    expect(convertFieldValue("options", "A, B", server)).toEqual([
      { value: "A" },
      { value: "B" },
    ]);
  });

  it("replaces spaces in labels with dashes and removes duplicates", () => {
    expect(toJiraLabel("  needs  review ")).toBe("needs-review");
    expect(
      convertFieldValue(
        "labels",
        ["needs review", "bug", "needs  review"],
        server,
      ),
    ).toEqual(["needs-review", "bug"]);
    expect(convertFieldValue("labels", [], server)).toBeUndefined();
  });

  it("uses name on Jira Server and accountId on Jira Cloud for users", () => {
    expect(convertFieldValue("user", "alice", server)).toEqual({
      name: "alice",
    });
    expect(
      convertFieldValue("user", "5b10ac8d82e05b22cc7d4ef5", cloud),
    ).toEqual({ accountId: "5b10ac8d82e05b22cc7d4ef5" });
    expect(convertFieldValue("users", ["alice", "bob"], server)).toEqual([
      { name: "alice" },
      { name: "bob" },
    ]);
    expect(convertFieldValue("users", ["acc-1", "acc-2"], cloud)).toEqual([
      { accountId: "acc-1" },
      { accountId: "acc-2" },
    ]);
    expect(convertFieldValue("user", "", cloud)).toBeUndefined();
  });

  it("applies the value map to single values and to every list element, and passes unmapped values through", () => {
    const valueMap = { urgent: "Highest", "no-priority": "", low: "Low" };
    expect(
      convertFieldValue("priority", "urgent", { ...server, valueMap }),
    ).toEqual({ name: "Highest" });
    // An explicit empty mapping means "send nothing".
    expect(
      convertFieldValue("priority", "no-priority", { ...server, valueMap }),
    ).toBeUndefined();
    // A value the person typed in the dialog (already a Jira value) is kept.
    expect(
      convertFieldValue("priority", "Blocker", { ...server, valueMap }),
    ).toEqual({ name: "Blocker" });
    expect(
      convertFieldValue("options", ["low", "urgent", "other"], {
        ...server,
        valueMap,
      }),
    ).toEqual([{ value: "Low" }, { value: "Highest" }, { value: "other" }]);
    // Inherited keys of Object.prototype are not map entries.
    expect(
      convertFieldValue("string", "constructor", { ...server, valueMap }),
    ).toBe("constructor");
  });
});

describe("buildJiraIssueFields", () => {
  it("sets project and issue type from the dialog on create, and converts typed values", () => {
    const fields = buildJiraIssueFields({
      deployment: "server",
      create: { jiraProjectKey: "PRJ", issueTypeId: "10001" },
      fields: [
        { fieldId: "summary", type: "string", value: "Fix it" },
        { fieldId: "priority", type: "priority", value: "urgent" },
        { fieldId: "duedate", type: "date", value: "2026-10-01T00:00:00.000Z" },
        { fieldId: "labels", type: "labels", value: ["a b"] },
        { fieldId: "assignee", type: "user", value: "alice" },
        { fieldId: "description", type: "text", value: "" },
        { fieldId: "customfield_1", type: "number", value: null },
      ],
      valueMaps: { priority: { urgent: "Highest" } },
    });

    expect(fields).toEqual({
      project: { key: "PRJ" },
      issuetype: { id: "10001" },
      summary: "Fix it",
      priority: { name: "Highest" },
      duedate: "2026-10-01",
      labels: ["a-b"],
      assignee: { name: "alice" },
    });
  });

  it("leaves project and issue type out of an update and ignores them in the typed list", () => {
    const fields = buildJiraIssueFields({
      deployment: "cloud",
      fields: [
        { fieldId: "project", type: "string", value: "EVIL" },
        { fieldId: "issuetype", type: "string", value: "1" },
        { fieldId: "summary", type: "string", value: "New title" },
        { fieldId: "assignee", type: "user", value: "acc-1" },
      ],
    });
    expect(fields).toEqual({
      summary: "New title",
      assignee: { accountId: "acc-1" },
    });
  });

  it("only ever builds the typed shapes: a client cannot smuggle Jira JSON through a string field", () => {
    const fields = buildJiraIssueFields({
      deployment: "server",
      fields: [
        {
          fieldId: "summary",
          type: "string",
          value: '{"name":"admin"}',
        },
      ],
    });
    expect(fields).toEqual({ summary: '{"name":"admin"}' });
  });

  it("reports the field that cannot be converted", () => {
    let error: unknown;
    try {
      buildJiraIssueFields({
        deployment: "server",
        fields: [{ fieldId: "customfield_7", type: "number", value: "x" }],
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(JiraFieldValueError);
    expect((error as JiraFieldValueError).fieldId).toBe("customfield_7");
  });
});
