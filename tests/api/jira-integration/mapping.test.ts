import { describe, expect, it } from "vitest";
import {
  DEFAULT_JIRA_MAPPING_CONFIG,
  resolveJiraMapping,
} from "../../../apps/api/src/jira-integration/mapping";
import type {
  JiraFieldMapping,
  JiraMappingConfig,
} from "../../../apps/api/src/jira-integration/schema";

const field = (
  fieldId: string,
  overrides: Partial<JiraFieldMapping> = {},
): JiraFieldMapping => ({
  target: { fieldId, type: "string" },
  source: { kind: "builtin", field: "title" },
  ...overrides,
});

function byField(mapping: ReturnType<typeof resolveJiraMapping>, id: string) {
  return mapping.fieldMappings.find((entry) => entry.target.fieldId === id);
}

describe("resolveJiraMapping defaults", () => {
  it("returns the built-in defaults with origin default when nothing is configured", () => {
    const resolved = resolveJiraMapping({});

    expect(resolved.fieldMappings.map((entry) => entry.target.fieldId)).toEqual(
      ["summary", "description", "priority", "duedate", "labels", "assignee"],
    );
    expect(
      resolved.fieldMappings.every((entry) => entry.origin === "default"),
    ).toBe(true);
    expect(byField(resolved, "summary")?.source).toEqual({
      kind: "builtin",
      field: "title",
    });
    expect(byField(resolved, "duedate")?.source).toEqual({
      kind: "builtin",
      field: "dueDate",
    });
    expect(byField(resolved, "assignee")?.source).toEqual({
      kind: "builtin",
      field: "assignee",
    });
    expect(byField(resolved, "priority")?.valueMap).toEqual({
      low: "Low",
      medium: "Medium",
      high: "High",
      urgent: "Highest",
      "no-priority": "",
    });
    expect(resolved.statusMappings).toEqual([]);
    expect(resolved.userMappings).toEqual([]);
    expect(resolved.labelComponentMappings).toEqual([]);
    expect(resolved.jiraProjectKey).toEqual({ value: null, origin: "default" });
    expect(resolved.components).toEqual({ value: [], origin: "default" });
  });

  it("does not let a caller mutate the built-in defaults through a result", () => {
    const resolved = resolveJiraMapping({});
    const priority = byField(resolved, "priority");
    if (priority?.valueMap) priority.valueMap.low = "Changed";
    resolved.fieldMappings.length = 0;

    expect(byField(resolveJiraMapping({}), "priority")?.valueMap?.low).toBe(
      "Low",
    );
    expect(DEFAULT_JIRA_MAPPING_CONFIG.fieldMappings).toHaveLength(6);
  });
});

describe("resolveJiraMapping scalars", () => {
  it("takes the most specific defined value and records its origin", () => {
    const resolved = resolveJiraMapping({
      workspace: { jiraProjectKey: "WS", issueTypeId: "10001" },
      project: { jiraProjectKey: "PRJ" },
      user: { issueTypeId: "10002" },
    });

    expect(resolved.jiraProjectKey).toEqual({
      value: "PRJ",
      origin: "project",
    });
    expect(resolved.issueTypeId).toEqual({ value: "10002", origin: "user" });
    expect(resolved.issueTypeName).toEqual({ value: null, origin: "default" });
  });

  it("lets null clear an inherited scalar", () => {
    const resolved = resolveJiraMapping({
      workspace: { jiraProjectKey: "WS" },
      project: { jiraProjectKey: null },
    });

    expect(resolved.jiraProjectKey).toEqual({ value: null, origin: "project" });
  });

  it("replaces components as a whole and lets null clear them", () => {
    const inherited = resolveJiraMapping({
      workspace: { components: ["Backend", "API"] },
      project: { components: ["Web"] },
    });
    expect(inherited.components).toEqual({
      value: ["Web"],
      origin: "project",
    });

    const cleared = resolveJiraMapping({
      workspace: { components: ["Backend"] },
      user: { components: null },
    });
    expect(cleared.components).toEqual({ value: [], origin: "user" });

    const untouched = resolveJiraMapping({
      workspace: { components: ["Backend"] },
      project: {},
    });
    expect(untouched.components).toEqual({
      value: ["Backend"],
      origin: "workspace",
    });
  });
});

describe("resolveJiraMapping field mappings", () => {
  it("replaces a whole entry keyed by target.fieldId and keeps the others", () => {
    const resolved = resolveJiraMapping({
      workspace: {
        fieldMappings: [
          field("summary", {
            source: { kind: "builtin", field: "description" },
            valueMap: { a: "b" },
          }),
        ],
      },
      project: {
        fieldMappings: [
          field("summary", { source: { kind: "none" }, defaultValue: "x" }),
        ],
      },
    });

    const summary = byField(resolved, "summary");
    expect(summary).toMatchObject({
      source: { kind: "none" },
      defaultValue: "x",
      origin: "project",
    });
    // The whole entry is replaced: nothing of the workspace entry survives.
    expect(summary?.valueMap).toBeUndefined();
    expect(byField(resolved, "description")?.origin).toBe("default");
    expect(resolved.fieldMappings).toHaveLength(6);
  });

  it("adds a custom field mapping with the level that introduced it", () => {
    const resolved = resolveJiraMapping({
      workspace: {
        fieldMappings: [
          field("customfield_10010", {
            source: { kind: "custom", customFieldId: "cf-1" },
          }),
        ],
      },
    });

    expect(byField(resolved, "customfield_10010")).toMatchObject({
      source: { kind: "custom", customFieldId: "cf-1" },
      origin: "workspace",
    });
  });

  it("removes an inherited mapping with disabled: true, and a more specific level can add it back", () => {
    const removed = resolveJiraMapping({
      workspace: { fieldMappings: [field("duedate", { disabled: true })] },
    });
    expect(byField(removed, "duedate")).toBeUndefined();
    expect(removed.fieldMappings).toHaveLength(5);

    const readded = resolveJiraMapping({
      workspace: { fieldMappings: [field("duedate", { disabled: true })] },
      user: {
        fieldMappings: [
          field("duedate", { source: { kind: "builtin", field: "startDate" } }),
        ],
      },
    });
    expect(byField(readded, "duedate")).toMatchObject({
      source: { kind: "builtin", field: "startDate" },
      origin: "user",
    });
  });

  it("never exposes the disabled flag on a resolved entry", () => {
    const resolved = resolveJiraMapping({
      workspace: {
        fieldMappings: [field("summary", { disabled: false })],
      },
    });
    expect(byField(resolved, "summary")).not.toHaveProperty("disabled");
  });
});

describe("resolveJiraMapping status mappings", () => {
  it("merges by status id, else by lower-cased status name, most specific wins", () => {
    const resolved = resolveJiraMapping({
      workspace: {
        statusMappings: [
          {
            jiraStatusId: "3",
            jiraStatusName: "In Progress",
            kaneoStatus: "in-progress",
          },
          { jiraStatusName: "Done", kaneoStatus: "done" },
          { jiraStatusName: "Blocked", kaneoStatus: "planned" },
        ],
      },
      project: {
        statusMappings: [
          {
            jiraStatusId: "3",
            jiraStatusName: "In Progress",
            kaneoStatus: "in-review",
          },
          { jiraStatusName: "  DONE ", kaneoStatus: "archived" },
          { jiraStatusName: "blocked", kaneoStatus: null },
        ],
      },
    });

    expect(resolved.statusMappings).toEqual([
      {
        jiraStatusId: "3",
        jiraStatusName: "In Progress",
        kaneoStatus: "in-review",
        origin: "project",
      },
      { jiraStatusName: "  DONE ", kaneoStatus: "archived", origin: "project" },
    ]);
  });

  it("ignores the user level for statuses even if a user config carries them", () => {
    const user: JiraMappingConfig = {
      statusMappings: [
        { jiraStatusName: "Done", kaneoStatus: "done" },
        { jiraStatusName: "To Do", kaneoStatus: null },
      ],
    };
    const resolved = resolveJiraMapping({
      workspace: {
        statusMappings: [
          { jiraStatusName: "Done", kaneoStatus: "in-review" },
          { jiraStatusName: "To Do", kaneoStatus: "to-do" },
        ],
      },
      user,
    });

    expect(resolved.statusMappings).toEqual([
      { jiraStatusName: "Done", kaneoStatus: "in-review", origin: "workspace" },
      { jiraStatusName: "To Do", kaneoStatus: "to-do", origin: "workspace" },
    ]);
  });
});

describe("resolveJiraMapping user and label mappings", () => {
  it("merges user mappings by Kaneo user id and removes on null", () => {
    const resolved = resolveJiraMapping({
      workspace: {
        userMappings: [
          { kaneoUserId: "u1", jiraUser: "alice" },
          { kaneoUserId: "u2", jiraUser: "bob" },
          { kaneoUserId: "u3", jiraUser: "carol" },
        ],
      },
      project: { userMappings: [{ kaneoUserId: "u1", jiraUser: "alice.p" }] },
      user: { userMappings: [{ kaneoUserId: "u2", jiraUser: null }] },
    });

    expect(resolved.userMappings).toEqual([
      { kaneoUserId: "u1", jiraUser: "alice.p", origin: "project" },
      { kaneoUserId: "u3", jiraUser: "carol", origin: "workspace" },
    ]);
  });

  it("merges label to component mappings by lower-cased label and removes on null", () => {
    const resolved = resolveJiraMapping({
      workspace: {
        labelComponentMappings: [
          { kaneoLabel: "Backend", jiraComponent: "Server" },
          { kaneoLabel: "ui", jiraComponent: "Frontend" },
        ],
      },
      project: {
        labelComponentMappings: [
          { kaneoLabel: "BACKEND", jiraComponent: "Core" },
          { kaneoLabel: "UI", jiraComponent: null },
        ],
      },
    });

    expect(resolved.labelComponentMappings).toEqual([
      { kaneoLabel: "BACKEND", jiraComponent: "Core", origin: "project" },
    ]);
  });
});
