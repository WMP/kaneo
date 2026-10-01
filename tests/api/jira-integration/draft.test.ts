import { describe, expect, it } from "vitest";
import {
  applyCreateMeta,
  buildDraftFields,
  type DraftTaskValues,
  normalizeCustomValue,
  resolveAssigneeJiraUser,
  resolveDraftComponents,
} from "../../../apps/api/src/jira-integration/draft";
import type { JiraCreateField } from "../../../apps/api/src/jira-integration/jira-client";
import {
  findMappedKaneoStatus,
  resolveJiraMapping,
} from "../../../apps/api/src/jira-integration/mapping";
import type { JiraMappingConfig } from "../../../apps/api/src/jira-integration/schema";

const task: DraftTaskValues = {
  title: "Fix the login",
  description: "Users cannot log in.",
  priority: "urgent",
  status: "in-progress",
  dueDate: new Date("2026-10-01T00:00:00.000Z"),
  startDate: null,
  labels: ["needs review", "bug"],
  progress: 40,
  assigneeUserId: "user-alice",
};

function draft(
  levels: Parameters<typeof resolveJiraMapping>[0] = {},
  overrides: Partial<Parameters<typeof buildDraftFields>[0]> = {},
) {
  return buildDraftFields({
    mapping: resolveJiraMapping(levels),
    task,
    customValues: {},
    deployment: "server",
    assigneeIdentity: null,
    ...overrides,
  });
}

function byId(fields: ReturnType<typeof draft>["fields"], id: string) {
  const field = fields.find((entry) => entry.fieldId === id);
  if (!field) throw new Error(`no field ${id}`);
  return field;
}

describe("buildDraftFields: built-in defaults", () => {
  it("fills the default fields from the task with their Jira values", () => {
    const { fields, warnings } = draft();

    expect(warnings).toEqual([]);
    expect(fields.map((field) => field.fieldId)).toEqual([
      "summary",
      "description",
      "priority",
      "duedate",
      "labels",
      "assignee",
    ]);
    expect(byId(fields, "summary")).toMatchObject({
      value: "Fix the login",
      jiraValue: "Fix the login",
      origin: "task",
      mappingOrigin: "default",
      type: "string",
    });
    expect(byId(fields, "priority")).toMatchObject({
      value: "urgent",
      jiraValue: { name: "Highest" },
      origin: "task",
    });
    expect(byId(fields, "duedate")).toMatchObject({
      value: "2026-10-01T00:00:00.000Z",
      jiraValue: "2026-10-01",
    });
    expect(byId(fields, "labels")).toMatchObject({
      value: ["needs review", "bug"],
      jiraValue: ["needs-review", "bug"],
    });
  });

  it("reports nothing to send for an empty value, without a default", () => {
    const { fields } = draft(
      {},
      {
        task: {
          ...task,
          description: null,
          dueDate: null,
          priority: "no-priority",
        },
      },
    );
    expect(byId(fields, "description")).toMatchObject({
      value: null,
      jiraValue: null,
      origin: "empty",
    });
    expect(byId(fields, "duedate")).toMatchObject({ origin: "empty" });
    // The built-in map sends no priority for no-priority.
    expect(byId(fields, "priority")).toMatchObject({
      value: "no-priority",
      jiraValue: null,
      origin: "empty",
    });
  });
});

describe("buildDraftFields: defaults, sources and origins", () => {
  const workspace: JiraMappingConfig = {
    fieldMappings: [
      {
        target: { fieldId: "description", type: "text" },
        source: { kind: "builtin", field: "description" },
        defaultValue: "No description given.",
      },
      {
        target: {
          fieldId: "customfield_10",
          fieldName: "Team",
          type: "option",
        },
        source: { kind: "none" },
        defaultValue: "Platform",
      },
    ],
  };

  it("uses the mapping's default value when the task value is empty, and says so", () => {
    const { fields } = draft(
      { workspace },
      { task: { ...task, description: "   " } },
    );
    expect(byId(fields, "description")).toMatchObject({
      value: "No description given.",
      jiraValue: "No description given.",
      origin: "default",
      mappingOrigin: "workspace",
    });
    expect(byId(fields, "customfield_10")).toMatchObject({
      fieldName: "Team",
      value: "Platform",
      jiraValue: { value: "Platform" },
      origin: "default",
    });
  });

  it("prefers the task's value over the default", () => {
    const { fields } = draft({ workspace });
    expect(byId(fields, "description")).toMatchObject({
      value: "Users cannot log in.",
      origin: "task",
    });
  });

  it("lets the user level override the project level, which overrides the workspace level", () => {
    const fieldWith = (defaultValue: string): JiraMappingConfig => ({
      fieldMappings: [
        {
          target: { fieldId: "customfield_20", type: "string" },
          source: { kind: "none" },
          defaultValue,
        },
      ],
    });
    const levels = {
      workspace: fieldWith("workspace"),
      project: fieldWith("project"),
      user: fieldWith("user"),
    };

    expect(byId(draft(levels).fields, "customfield_20")).toMatchObject({
      jiraValue: "user",
      mappingOrigin: "user",
    });
    expect(
      byId(draft({ ...levels, user: undefined }).fields, "customfield_20"),
    ).toMatchObject({ jiraValue: "project", mappingOrigin: "project" });
    expect(
      byId(draft({ workspace: levels.workspace }).fields, "customfield_20"),
    ).toMatchObject({ jiraValue: "workspace", mappingOrigin: "workspace" });
  });

  it("reads custom field values by id, including multiselect arrays and numbers", () => {
    const { fields } = draft(
      {
        project: {
          fieldMappings: [
            {
              target: { fieldId: "customfield_1", type: "options" },
              source: { kind: "custom", customFieldId: "cf-multi" },
            },
            {
              target: { fieldId: "customfield_2", type: "number" },
              source: { kind: "custom", customFieldId: "cf-number" },
            },
            {
              target: { fieldId: "customfield_3", type: "option" },
              source: { kind: "custom", customFieldId: "cf-flag" },
              valueMap: { true: "Yes", false: "No" },
            },
            {
              target: { fieldId: "customfield_4", type: "string" },
              source: { kind: "custom", customFieldId: "cf-missing" },
            },
          ],
        },
      },
      {
        customValues: {
          "cf-multi": { type: "multiselect", value: '["A","B"]' },
          "cf-number": { type: "number", value: "7" },
          "cf-flag": { type: "boolean", value: "true" },
        },
      },
    );

    expect(byId(fields, "customfield_1")).toMatchObject({
      value: ["A", "B"],
      jiraValue: [{ value: "A" }, { value: "B" }],
    });
    expect(byId(fields, "customfield_2")).toMatchObject({
      value: 7,
      jiraValue: 7,
    });
    expect(byId(fields, "customfield_3")).toMatchObject({
      value: "true",
      jiraValue: { value: "Yes" },
    });
    expect(byId(fields, "customfield_4")).toMatchObject({ origin: "empty" });
  });

  it("drops a disabled inherited mapping", () => {
    const { fields } = draft({
      project: {
        fieldMappings: [
          {
            target: { fieldId: "labels", type: "labels" },
            source: { kind: "builtin", field: "labels" },
            disabled: true,
          },
        ],
      },
    });
    expect(fields.map((field) => field.fieldId)).not.toContain("labels");
  });

  it("turns a value that does not fit its type into a warning and falls back to the default", () => {
    const { fields, warnings } = draft({
      project: {
        fieldMappings: [
          {
            target: {
              fieldId: "customfield_5",
              fieldName: "Points",
              type: "number",
            },
            source: { kind: "builtin", field: "title" },
            defaultValue: 1,
          },
        ],
      },
    });
    expect(warnings).toEqual([
      expect.objectContaining({
        code: "JIRA_FIELD_VALUE_INVALID",
        message: expect.stringContaining("Points"),
      }),
    ]);
    expect(byId(fields, "customfield_5")).toMatchObject({
      jiraValue: 1,
      origin: "default",
    });
  });
});

describe("assignee resolution", () => {
  const mapping = resolveJiraMapping({
    project: {
      userMappings: [{ kaneoUserId: "user-alice", jiraUser: "alice.mapped" }],
    },
  });
  const none = resolveJiraMapping({});

  it("prefers a user mapping over the assignee's own Jira identity", () => {
    expect(
      resolveAssigneeJiraUser({
        mapping,
        assigneeUserId: "user-alice",
        identity: { accountId: "acc-1", username: "alice.own" },
        deployment: "server",
      }),
    ).toBe("alice.mapped");
  });

  it("falls back to the identity of the assignee's own token: username on Server, account id on Cloud", () => {
    const identity = { accountId: "acc-1", username: "alice.own" };
    expect(
      resolveAssigneeJiraUser({
        mapping: none,
        assigneeUserId: "user-alice",
        identity,
        deployment: "server",
      }),
    ).toBe("alice.own");
    expect(
      resolveAssigneeJiraUser({
        mapping: none,
        assigneeUserId: "user-alice",
        identity,
        deployment: "cloud",
      }),
    ).toBe("acc-1");
  });

  it("is empty without an assignee, a mapping or an identity", () => {
    expect(
      resolveAssigneeJiraUser({
        mapping: none,
        assigneeUserId: null,
        identity: { accountId: "a", username: "u" },
        deployment: "server",
      }),
    ).toBeNull();
    expect(
      resolveAssigneeJiraUser({
        mapping: none,
        assigneeUserId: "user-alice",
        identity: null,
        deployment: "server",
      }),
    ).toBeNull();
    expect(
      resolveAssigneeJiraUser({
        mapping: none,
        assigneeUserId: "user-alice",
        identity: { accountId: "acc", username: null },
        deployment: "server",
      }),
    ).toBeNull();
  });

  it("puts the resolved user into the assignee field in the shape of the deployment", () => {
    const identity = { accountId: "acc-1", username: "alice.own" };
    expect(
      byId(draft({}, { assigneeIdentity: identity }).fields, "assignee"),
    ).toMatchObject({ value: "alice.own", jiraValue: { name: "alice.own" } });
    expect(
      byId(
        draft({}, { assigneeIdentity: identity, deployment: "cloud" }).fields,
        "assignee",
      ),
    ).toMatchObject({ value: "acc-1", jiraValue: { accountId: "acc-1" } });
    expect(byId(draft().fields, "assignee")).toMatchObject({
      origin: "empty",
      jiraValue: null,
    });
  });
});

describe("components", () => {
  const mapping = resolveJiraMapping({
    workspace: { components: ["Platform"] },
    project: {
      labelComponentMappings: [
        { kaneoLabel: "Bug", jiraComponent: "Quality" },
        { kaneoLabel: "needs review", jiraComponent: "Platform" },
      ],
    },
  });

  it("joins the default components with those the task's labels map to, without duplicates", () => {
    expect(
      resolveDraftComponents(mapping, ["bug", "needs review", "other"]),
    ).toMatchObject({
      names: ["Platform", "Quality"],
      fromLabels: true,
      fromDefaults: true,
      labelOrigin: "project",
    });
    expect(resolveDraftComponents(mapping, ["other"])).toMatchObject({
      names: ["Platform"],
      fromLabels: false,
    });
  });

  it("adds a components field with its origin, only when there is a component", () => {
    const withLabels = draft({
      workspace: { components: ["Platform"] },
      project: {
        labelComponentMappings: [
          { kaneoLabel: "bug", jiraComponent: "Quality" },
        ],
      },
    });
    expect(byId(withLabels.fields, "components")).toMatchObject({
      type: "components",
      value: ["Platform", "Quality"],
      jiraValue: [{ name: "Platform" }, { name: "Quality" }],
      origin: "task",
      mappingOrigin: "project",
    });

    const defaultsOnly = draft(
      { workspace: { components: ["Platform"] } },
      { task: { ...task, labels: [] } },
    );
    expect(byId(defaultsOnly.fields, "components")).toMatchObject({
      origin: "default",
      mappingOrigin: "workspace",
    });

    expect(draft().fields.map((field) => field.fieldId)).not.toContain(
      "components",
    );
  });

  it("leaves the components to an explicit mapping of the components field", () => {
    const { fields } = draft({
      workspace: {
        components: ["Platform"],
        fieldMappings: [
          {
            target: { fieldId: "components", type: "components" },
            source: { kind: "none" },
            defaultValue: ["Explicit"],
          },
        ],
      },
    });
    expect(
      fields.filter((field) => field.fieldId === "components"),
    ).toHaveLength(1);
    expect(byId(fields, "components").jiraValue).toEqual([
      { name: "Explicit" },
    ]);
  });
});

describe("normalizeCustomValue", () => {
  it("normalizes stored custom values by the field's Kaneo type", () => {
    expect(normalizeCustomValue(undefined)).toBeNull();
    expect(normalizeCustomValue({ type: "text", value: "  " })).toBeNull();
    expect(
      normalizeCustomValue({ type: "multiselect", value: '["a"]' }),
    ).toEqual(["a"]);
    expect(
      normalizeCustomValue({ type: "multiselect", value: "plain" }),
    ).toEqual(["plain"]);
    expect(normalizeCustomValue({ type: "number", value: "2.5" })).toBe(2.5);
    expect(normalizeCustomValue({ type: "number", value: "x" })).toBe("x");
    expect(normalizeCustomValue({ type: "date", value: "2026-01-02" })).toBe(
      "2026-01-02",
    );
  });
});

describe("applyCreateMeta", () => {
  const createFields: JiraCreateField[] = [
    {
      fieldId: "summary",
      name: "Summary",
      required: true,
      hasDefaultValue: false,
      schema: { type: "string" },
      allowedValues: null,
    },
    {
      fieldId: "priority",
      name: "Priority",
      required: false,
      hasDefaultValue: true,
      schema: { type: "priority" },
      allowedValues: [
        { id: "1", name: "Highest" },
        { id: "2", name: "High" },
      ],
    },
    {
      fieldId: "customfield_77",
      name: "Team",
      required: true,
      hasDefaultValue: false,
      schema: { type: "option" },
      allowedValues: [{ id: "5", value: "A" }],
    },
    {
      fieldId: "customfield_88",
      name: "Filled by Jira",
      required: true,
      hasDefaultValue: true,
      schema: null,
      allowedValues: null,
    },
    {
      fieldId: "project",
      name: "Project",
      required: true,
      hasDefaultValue: false,
      schema: null,
      allowedValues: null,
    },
    {
      fieldId: "reporter",
      name: "Reporter",
      required: true,
      hasDefaultValue: false,
      schema: null,
      allowedValues: null,
    },
    {
      fieldId: "description",
      name: "Description",
      required: true,
      hasDefaultValue: false,
      schema: null,
      allowedValues: null,
    },
  ];

  it("adds required flags and allowed values, and lists required fields without a mapping", () => {
    const { fields } = draft({}, { task: { ...task, description: null } });
    const applied = applyCreateMeta(fields, createFields);

    expect(byId(applied.fields, "summary")).toMatchObject({ required: true });
    expect(byId(applied.fields, "priority")).toMatchObject({
      required: false,
      allowedValues: [
        { id: "1", name: "Highest" },
        { id: "2", name: "High" },
      ],
    });
    // A field Jira does not list keeps no flag.
    expect(byId(applied.fields, "labels").required).toBeUndefined();

    expect(applied.missingRequired).toEqual([
      // Not mapped at all.
      { fieldId: "customfield_77", name: "Team", mapped: false },
      // Mapped, but the task has nothing to send.
      { fieldId: "description", name: "Description", mapped: true },
    ]);
  });

  it("does not list a required field that has a value", () => {
    const { fields } = draft({
      workspace: {
        fieldMappings: [
          {
            target: { fieldId: "customfield_77", type: "option" },
            source: { kind: "none" },
            defaultValue: "A",
          },
        ],
      },
    });
    const applied = applyCreateMeta(fields, createFields);
    expect(applied.missingRequired.map((field) => field.fieldId)).toEqual([]);
  });
});

describe("findMappedKaneoStatus", () => {
  const mappings = resolveJiraMapping({
    workspace: {
      statusMappings: [
        {
          jiraStatusId: "3",
          jiraStatusName: "In Progress",
          kaneoStatus: "in-progress",
        },
        { jiraStatusName: "Done", kaneoStatus: "done" },
      ],
    },
  }).statusMappings;

  it("matches by status id first, then by case-insensitive name", () => {
    expect(
      findMappedKaneoStatus(mappings, { statusId: "3", statusName: "Renamed" }),
    ).toBe("in-progress");
    expect(
      findMappedKaneoStatus(mappings, { statusId: "9", statusName: " done " }),
    ).toBe("done");
    expect(
      findMappedKaneoStatus(mappings, { statusId: null, statusName: "DONE" }),
    ).toBe("done");
  });

  it("is null for a status nobody mapped", () => {
    expect(
      findMappedKaneoStatus(mappings, { statusId: "4", statusName: "Blocked" }),
    ).toBeNull();
    // A mapping that names an id does not match by name alone.
    expect(
      findMappedKaneoStatus(mappings, {
        statusId: null,
        statusName: "In Progress",
      }),
    ).toBeNull();
  });
});
