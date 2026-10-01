import { describe, expect, it } from "vitest";
import type { JiraDraftField } from "@/fetchers/jira-integration/types";
import {
  buildSendFields,
  describeJiraValue,
  findEmptyRequiredFields,
  fromDateTimeInput,
  inputKindFor,
  isEmptyDraftValue,
  toDateInput,
  toDateTimeInput,
  toList,
} from "./send-to-jira-model";

function field(overrides: Partial<JiraDraftField>): JiraDraftField {
  return {
    fieldId: "f",
    fieldName: "F",
    type: "string",
    value: null,
    jiraValue: null,
    origin: "empty",
    mappingOrigin: "default",
    ...overrides,
  };
}

describe("inputKindFor", () => {
  it("picks an input for every Jira field type", () => {
    expect(inputKindFor("string")).toBe("text");
    expect(inputKindFor("text")).toBe("textarea");
    expect(inputKindFor("number")).toBe("number");
    expect(inputKindFor("date")).toBe("date");
    expect(inputKindFor("datetime")).toBe("datetime");
    expect(inputKindFor("option")).toBe("select");
    expect(inputKindFor("priority")).toBe("select");
    expect(inputKindFor("options")).toBe("multi");
    expect(inputKindFor("labels")).toBe("multi");
    expect(inputKindFor("components")).toBe("multi");
    expect(inputKindFor("user")).toBe("user");
    expect(inputKindFor("users")).toBe("users");
  });
});

describe("values", () => {
  it("treats blank text and empty lists as empty, but not 0 or false", () => {
    expect(isEmptyDraftValue(null)).toBe(true);
    expect(isEmptyDraftValue("  ")).toBe(true);
    expect(isEmptyDraftValue([])).toBe(true);
    expect(isEmptyDraftValue(0)).toBe(false);
    expect(isEmptyDraftValue(false)).toBe(false);
    expect(isEmptyDraftValue("a")).toBe(false);
  });

  it("reads a single value as a list", () => {
    expect(toList("a")).toEqual(["a"]);
    expect(toList(["a", "b"])).toEqual(["a", "b"]);
    expect(toList(null)).toEqual([]);
    expect(toList(" ")).toEqual([]);
  });

  it("shows the calendar day of an ISO timestamp in a date input", () => {
    expect(toDateInput("2026-10-01T22:00:00.000Z")).toBe("2026-10-01");
    expect(toDateInput("2026-10-01")).toBe("2026-10-01");
    expect(toDateInput("tomorrow")).toBe("");
    expect(toDateInput(null)).toBe("");
  });

  it("round-trips a date and time through the local input", () => {
    const iso = "2026-10-01T12:30:00.000Z";
    expect(fromDateTimeInput(toDateTimeInput(iso))).toBe(iso);
    expect(fromDateTimeInput("")).toBeNull();
    expect(toDateTimeInput("nope")).toBe("");
  });

  it("describes what Jira would receive", () => {
    expect(describeJiraValue({ name: "Highest" })).toBe("Highest");
    expect(describeJiraValue([{ name: "Web" }, { name: "API" }])).toBe(
      "Web, API",
    );
    expect(describeJiraValue({ accountId: "abc" })).toBe("abc");
    expect(describeJiraValue(3)).toBe("3");
    expect(describeJiraValue(null)).toBeNull();
  });
});

describe("buildSendFields", () => {
  const fields = [
    field({ fieldId: "summary", value: "Title", type: "string" }),
    field({ fieldId: "description", value: null, type: "text" }),
    field({ fieldId: "labels", value: ["a"], type: "labels" }),
  ];

  it("sends the draft's own value for an untouched row", () => {
    expect(buildSendFields(fields, {})).toEqual([
      { fieldId: "summary", type: "string", value: "Title" },
      { fieldId: "description", type: "text", value: null },
      { fieldId: "labels", type: "labels", value: ["a"] },
    ]);
  });

  it("sends an edit, and an edit that cleared a row as nothing", () => {
    expect(
      buildSendFields(fields, { summary: "New", labels: [] }).map(
        (entry) => entry.value,
      ),
    ).toEqual(["New", null, null]);
  });
});

describe("findEmptyRequiredFields", () => {
  const fields = [
    field({ fieldId: "a", required: true, value: null }),
    field({ fieldId: "b", required: true, value: "x" }),
    field({ fieldId: "c", required: false, value: null }),
  ];

  it("lists required rows that hold nothing", () => {
    expect(findEmptyRequiredFields(fields, {}).map((f) => f.fieldId)).toEqual([
      "a",
    ]);
  });

  it("follows the edits", () => {
    expect(findEmptyRequiredFields(fields, { a: "filled" })).toEqual([]);
    expect(
      findEmptyRequiredFields(fields, { b: "  " }).map((f) => f.fieldId),
    ).toEqual(["a", "b"]);
  });
});
