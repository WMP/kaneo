import { describe, expect, it } from "vitest";
import type {
  JiraMappingConfig,
  ResolvedJiraMapping,
} from "@/fetchers/jira-integration/types";
import {
  cleanConfig,
  configsEqual,
  disableFieldRow,
  disableStatusRow,
  effectiveScalar,
  fieldRows,
  inferJiraFieldType,
  inheritedValue,
  overrideFieldRow,
  overrideStatusRow,
  removeRow,
  statusRows,
  validateConfig,
} from "./mapping-model";

const parent: ResolvedJiraMapping = {
  jiraProjectKey: { value: "WS", origin: "workspace" },
  issueTypeId: { value: null, origin: "default" },
  issueTypeName: { value: null, origin: "default" },
  components: { value: [], origin: "default" },
  fieldMappings: [
    {
      target: { fieldId: "summary", type: "string" },
      source: { kind: "builtin", field: "title" },
      origin: "default",
    },
    {
      target: { fieldId: "priority", type: "priority" },
      source: { kind: "builtin", field: "priority" },
      valueMap: { urgent: "Highest" },
      origin: "workspace",
    },
  ],
  statusMappings: [
    {
      jiraStatusId: "3",
      jiraStatusName: "Done",
      kaneoStatus: "done",
      origin: "workspace",
    },
    {
      jiraStatusName: "In Progress",
      kaneoStatus: "in-progress",
      origin: "workspace",
    },
  ],
  userMappings: [],
  labelComponentMappings: [],
};

describe("mapping rows", () => {
  it("lists inherited rows that the own level does not touch", () => {
    const rows = fieldRows({}, parent);
    expect(rows.map((row) => [row.kind, row.key])).toEqual([
      ["inherited", "summary"],
      ["inherited", "priority"],
    ]);
  });

  it("shows an own row in place of the inherited row with the same key", () => {
    const config: JiraMappingConfig = {
      fieldMappings: [
        {
          target: { fieldId: "priority", type: "priority" },
          source: { kind: "builtin", field: "priority" },
          valueMap: { urgent: "Blocker" },
        },
      ],
    };
    const rows = fieldRows(config, parent);
    expect(rows.map((row) => row.kind)).toEqual(["inherited", "own"]);
    const own = rows[1];
    expect(own.kind === "own" && own.overrides?.origin).toBe("workspace");
  });

  it("shows a removal marker as disabled and keeps the parent for the summary", () => {
    const rows = statusRows(
      {
        statusMappings: [
          { jiraStatusId: "3", jiraStatusName: "Done", kaneoStatus: null },
        ],
      },
      parent,
    );
    expect(rows.map((row) => row.kind)).toEqual(["inherited", "disabled"]);
    const disabled = rows[1];
    expect(disabled.kind === "disabled" && disabled.parent?.kaneoStatus).toBe(
      "done",
    );
  });

  it("matches status rows by id, else by lower-cased name", () => {
    const rows = statusRows(
      {
        statusMappings: [
          { jiraStatusName: "in progress", kaneoStatus: "doing" },
        ],
      },
      parent,
    );
    const own = rows.find((row) => row.kind === "own");
    expect(own?.kind === "own" && own.overrides?.kaneoStatus).toBe(
      "in-progress",
    );
    // The id-keyed "Done" mapping is not matched by a name.
    const byName = statusRows(
      { statusMappings: [{ jiraStatusName: "Done", kaneoStatus: "x" }] },
      parent,
    );
    expect(byName.filter((row) => row.kind === "inherited")).toHaveLength(2);
  });
});

describe("override, disable and remove", () => {
  it("override copies the parent row without its origin", () => {
    const config = overrideFieldRow({}, parent.fieldMappings[1]);
    expect(config.fieldMappings).toEqual([
      {
        target: { fieldId: "priority", type: "priority" },
        source: { kind: "builtin", field: "priority" },
        valueMap: { urgent: "Highest" },
      },
    ]);
    // A copy, not the parent object.
    expect(config.fieldMappings?.[0].valueMap).not.toBe(
      parent.fieldMappings[1].valueMap,
    );
  });

  it("disable adds a removal marker for a field, a status", () => {
    expect(disableFieldRow({}, parent.fieldMappings[0]).fieldMappings).toEqual([
      {
        target: { fieldId: "summary", type: "string" },
        source: { kind: "none" },
        disabled: true,
      },
    ]);
    expect(
      disableStatusRow({}, parent.statusMappings[0]).statusMappings,
    ).toEqual([
      { jiraStatusId: "3", jiraStatusName: "Done", kaneoStatus: null },
    ]);
  });

  it("override of a status keeps its id", () => {
    expect(
      overrideStatusRow({}, parent.statusMappings[0]).statusMappings,
    ).toEqual([
      { jiraStatusId: "3", jiraStatusName: "Done", kaneoStatus: "done" },
    ]);
  });

  it("removing an own row makes the key inherit again", () => {
    const overridden = overrideFieldRow({}, parent.fieldMappings[1]);
    const removed = removeRow(overridden, "fieldMappings", 0);
    expect(
      fieldRows(removed, parent).every((row) => row.kind === "inherited"),
    ).toBe(true);
  });
});

describe("cleanConfig", () => {
  it("drops blanks and empty lists and keeps explicit nulls", () => {
    expect(
      cleanConfig("workspace", {
        jiraProjectKey: "  ABC ",
        issueTypeId: "",
        issueTypeName: null,
        components: [],
        fieldMappings: [],
        userMappings: [],
      }),
    ).toEqual({ jiraProjectKey: "ABC", issueTypeName: null });
  });

  it("never sends statuses from the user level", () => {
    expect(
      cleanConfig("user", {
        statusMappings: [{ jiraStatusName: "Done", kaneoStatus: "done" }],
      }),
    ).toEqual({});
    expect(
      cleanConfig("project", {
        statusMappings: [{ jiraStatusName: " Done ", kaneoStatus: "done" }],
      }),
    ).toEqual({
      statusMappings: [{ jiraStatusName: "Done", kaneoStatus: "done" }],
    });
  });

  it("converts a number default, trims a value map and keeps a disabled marker minimal", () => {
    const cleaned = cleanConfig("project", {
      fieldMappings: [
        {
          target: { fieldId: " customfield_1 ", fieldName: "", type: "number" },
          source: { kind: "custom", customFieldId: "cf" },
          defaultValue: "3",
          valueMap: { "": "x", a: "b" },
        },
        {
          target: { fieldId: "summary", type: "string" },
          source: { kind: "builtin", field: "title" },
          valueMap: { a: "b" },
          disabled: true,
        },
      ],
    });
    expect(cleaned.fieldMappings).toEqual([
      {
        target: { fieldId: "customfield_1", type: "number" },
        source: { kind: "custom", customFieldId: "cf" },
        valueMap: { a: "b" },
        defaultValue: 3,
      },
      {
        target: { fieldId: "summary", type: "string" },
        source: { kind: "none" },
        disabled: true,
      },
    ]);
  });

  it("compares configs by their cleaned form", () => {
    expect(
      configsEqual("project", { jiraProjectKey: "" }, { components: [] }),
    ).toBe(true);
    expect(
      configsEqual("project", { jiraProjectKey: "A" }, { jiraProjectKey: "B" }),
    ).toBe(false);
  });
});

describe("validateConfig", () => {
  it("flags incomplete and duplicate rows", () => {
    const issues = validateConfig("project", {
      fieldMappings: [
        { target: { fieldId: "", type: "string" }, source: { kind: "none" } },
        { target: { fieldId: "a", type: "string" }, source: { kind: "none" } },
        { target: { fieldId: "a", type: "string" }, source: { kind: "none" } },
        {
          target: { fieldId: "n", type: "number" },
          source: { kind: "none" },
          defaultValue: "abc",
        },
      ],
      statusMappings: [
        { jiraStatusName: "", kaneoStatus: "" },
        { jiraStatusName: "Done", kaneoStatus: "done" },
        { jiraStatusName: "done", kaneoStatus: "other" },
      ],
      userMappings: [{ kaneoUserId: "", jiraUser: "" }],
      labelComponentMappings: [{ kaneoLabel: "bug", jiraComponent: "" }],
    });
    expect(
      issues.map((issue) => `${issue.list}:${issue.index}:${issue.code}`),
    ).toEqual([
      "fieldMappings:0:fieldTargetRequired",
      "fieldMappings:3:fieldNumberInvalid",
      "fieldMappings:2:fieldDuplicate",
      "statusMappings:0:statusJiraRequired",
      "statusMappings:0:statusKaneoRequired",
      "statusMappings:2:statusDuplicate",
      "userMappings:0:userKaneoRequired",
      "userMappings:0:userJiraRequired",
      "labelComponentMappings:0:labelComponentRequired",
    ]);
  });

  it("accepts removal markers and ignores statuses at the user level", () => {
    expect(
      validateConfig("project", {
        statusMappings: [{ jiraStatusName: "Done", kaneoStatus: null }],
        userMappings: [{ kaneoUserId: "u1", jiraUser: null }],
      }),
    ).toEqual([]);
    expect(
      validateConfig("user", {
        statusMappings: [{ jiraStatusName: "", kaneoStatus: "" }],
      }),
    ).toEqual([]);
  });
});

describe("inheritance helpers", () => {
  it("inheritedValue ignores values nobody set", () => {
    expect(inheritedValue(parent.jiraProjectKey)?.value).toBe("WS");
    expect(inheritedValue(parent.issueTypeId)).toBeUndefined();
    expect(inheritedValue(parent.components)).toBeUndefined();
  });

  it("effectiveScalar prefers the own value, then the inherited one", () => {
    expect(effectiveScalar("OWN", inheritedValue(parent.jiraProjectKey))).toBe(
      "OWN",
    );
    expect(effectiveScalar("", inheritedValue(parent.jiraProjectKey))).toBe(
      "WS",
    );
    expect(effectiveScalar(undefined, undefined)).toBeNull();
    expect(
      effectiveScalar(null, inheritedValue(parent.jiraProjectKey)),
    ).toBeNull();
  });
});

describe("inferJiraFieldType", () => {
  const infer = (schema: Parameters<typeof inferJiraFieldType>[0]["schema"]) =>
    inferJiraFieldType({ fieldId: "f", schema });

  it("maps Jira's field schema to a field type", () => {
    expect(infer(null)).toBe("string");
    expect(infer({ type: "string", system: "summary" })).toBe("string");
    expect(infer({ type: "string", system: "description" })).toBe("text");
    expect(
      infer({
        type: "string",
        custom: "com.atlassian.jira.plugin.system.customfieldtypes:textarea",
      }),
    ).toBe("text");
    expect(infer({ type: "number" })).toBe("number");
    expect(infer({ type: "date" })).toBe("date");
    expect(infer({ type: "datetime" })).toBe("datetime");
    expect(infer({ type: "priority" })).toBe("priority");
    expect(infer({ type: "option" })).toBe("option");
    expect(infer({ type: "user" })).toBe("user");
    expect(infer({ type: "array", items: "option" })).toBe("options");
    expect(infer({ type: "array", items: "component" })).toBe("components");
    expect(infer({ type: "array", items: "user" })).toBe("users");
    expect(infer({ type: "array", items: "string", system: "labels" })).toBe(
      "labels",
    );
  });
});
