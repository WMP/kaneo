import type {
  JiraFieldMapping,
  JiraMappingConfig,
  JiraStatusMapping,
} from "./schema";

export type JiraMappingOrigin = "default" | "workspace" | "project" | "user";

export type MappingLevels = {
  workspace?: JiraMappingConfig | null;
  project?: JiraMappingConfig | null;
  user?: JiraMappingConfig | null;
};

export type Resolved<T> = { value: T; origin: JiraMappingOrigin };

export type ResolvedFieldMapping = Omit<JiraFieldMapping, "disabled"> & {
  origin: JiraMappingOrigin;
};

export type ResolvedStatusMapping = {
  jiraStatusId?: string;
  jiraStatusName: string;
  kaneoStatus: string;
  origin: JiraMappingOrigin;
};

export type ResolvedUserMapping = {
  kaneoUserId: string;
  jiraUser: string;
  origin: JiraMappingOrigin;
};

export type ResolvedLabelComponentMapping = {
  kaneoLabel: string;
  jiraComponent: string;
  origin: JiraMappingOrigin;
};

export type ResolvedJiraMapping = {
  jiraProjectKey: Resolved<string | null>;
  issueTypeId: Resolved<string | null>;
  issueTypeName: Resolved<string | null>;
  components: Resolved<string[]>;
  fieldMappings: ResolvedFieldMapping[];
  statusMappings: ResolvedStatusMapping[];
  userMappings: ResolvedUserMapping[];
  labelComponentMappings: ResolvedLabelComponentMapping[];
};

// Built-in defaults (plan: "Built-in defaults"). In a value map an empty
// string means "no value" (`no-priority` sends no priority). Jira labels cannot
// contain spaces; that is applied when the value is converted, not here.
export const DEFAULT_JIRA_MAPPING_CONFIG: JiraMappingConfig = Object.freeze({
  fieldMappings: [
    {
      target: { fieldId: "summary", fieldName: "Summary", type: "string" },
      source: { kind: "builtin", field: "title" },
    },
    {
      target: {
        fieldId: "description",
        fieldName: "Description",
        type: "text",
      },
      source: { kind: "builtin", field: "description" },
    },
    {
      target: { fieldId: "priority", fieldName: "Priority", type: "priority" },
      source: { kind: "builtin", field: "priority" },
      valueMap: {
        low: "Low",
        medium: "Medium",
        high: "High",
        urgent: "Highest",
        "no-priority": "",
      },
    },
    {
      target: { fieldId: "duedate", fieldName: "Due date", type: "date" },
      source: { kind: "builtin", field: "dueDate" },
    },
    {
      target: { fieldId: "labels", fieldName: "Labels", type: "labels" },
      source: { kind: "builtin", field: "labels" },
    },
    {
      target: { fieldId: "assignee", fieldName: "Assignee", type: "user" },
      source: { kind: "builtin", field: "assignee" },
    },
  ],
  statusMappings: [],
  userMappings: [],
  labelComponentMappings: [],
}) as JiraMappingConfig;

// Statuses are decided per task, not per person, so the user level never
// contributes to them.
const STATUS_LEVELS: ReadonlySet<JiraMappingOrigin> = new Set([
  "default",
  "workspace",
  "project",
]);

export function statusMappingKey(
  mapping: Pick<JiraStatusMapping, "jiraStatusId" | "jiraStatusName">,
): string {
  return mapping.jiraStatusId
    ? `id:${mapping.jiraStatusId}`
    : `name:${mapping.jiraStatusName.trim().toLowerCase()}`;
}

export function labelComponentKey(kaneoLabel: string): string {
  return kaneoLabel.trim().toLowerCase();
}

// Pure merge of default < workspace < project < user (plan: "Merge rules").
// - A scalar key takes the most specific defined value; `null` clears it.
// - `components` is replaced as a whole.
// - List entries merge by key; a more specific entry replaces the whole entry
//   and a removal marker (`disabled: true`, `kaneoStatus: null`,
//   `jiraUser: null`, `jiraComponent: null`) removes the inherited entry.
// Every resolved value carries the level it came from. A scalar nobody set is
// `null` with origin `default`.
export function resolveJiraMapping(levels: MappingLevels): ResolvedJiraMapping {
  const ordered: [JiraMappingOrigin, JiraMappingConfig | null | undefined][] = [
    ["default", DEFAULT_JIRA_MAPPING_CONFIG],
    ["workspace", levels.workspace],
    ["project", levels.project],
    ["user", levels.user],
  ];

  const result: ResolvedJiraMapping = {
    jiraProjectKey: { value: null, origin: "default" },
    issueTypeId: { value: null, origin: "default" },
    issueTypeName: { value: null, origin: "default" },
    components: { value: [], origin: "default" },
    fieldMappings: [],
    statusMappings: [],
    userMappings: [],
    labelComponentMappings: [],
  };

  const fields = new Map<string, ResolvedFieldMapping>();
  const statuses = new Map<string, ResolvedStatusMapping>();
  const users = new Map<string, ResolvedUserMapping>();
  const labels = new Map<string, ResolvedLabelComponentMapping>();

  for (const [origin, config] of ordered) {
    if (!config) continue;

    if (config.jiraProjectKey !== undefined) {
      result.jiraProjectKey = { value: config.jiraProjectKey, origin };
    }
    if (config.issueTypeId !== undefined) {
      result.issueTypeId = { value: config.issueTypeId, origin };
    }
    if (config.issueTypeName !== undefined) {
      result.issueTypeName = { value: config.issueTypeName, origin };
    }
    if (config.components !== undefined) {
      result.components = { value: [...(config.components ?? [])], origin };
    }

    for (const mapping of config.fieldMappings ?? []) {
      const key = mapping.target.fieldId;
      if (mapping.disabled) {
        fields.delete(key);
        continue;
      }
      const { disabled: _disabled, ...rest } = mapping;
      fields.set(key, { ...structuredClone(rest), origin });
    }

    if (STATUS_LEVELS.has(origin)) {
      for (const mapping of config.statusMappings ?? []) {
        const key = statusMappingKey(mapping);
        if (mapping.kaneoStatus === null) {
          statuses.delete(key);
          continue;
        }
        statuses.set(key, {
          ...(mapping.jiraStatusId
            ? { jiraStatusId: mapping.jiraStatusId }
            : {}),
          jiraStatusName: mapping.jiraStatusName,
          kaneoStatus: mapping.kaneoStatus,
          origin,
        });
      }
    }

    for (const mapping of config.userMappings ?? []) {
      if (mapping.jiraUser === null) {
        users.delete(mapping.kaneoUserId);
        continue;
      }
      users.set(mapping.kaneoUserId, {
        kaneoUserId: mapping.kaneoUserId,
        jiraUser: mapping.jiraUser,
        origin,
      });
    }

    for (const mapping of config.labelComponentMappings ?? []) {
      const key = labelComponentKey(mapping.kaneoLabel);
      if (mapping.jiraComponent === null) {
        labels.delete(key);
        continue;
      }
      labels.set(key, {
        kaneoLabel: mapping.kaneoLabel,
        jiraComponent: mapping.jiraComponent,
        origin,
      });
    }
  }

  result.fieldMappings = [...fields.values()];
  result.statusMappings = [...statuses.values()];
  result.userMappings = [...users.values()];
  result.labelComponentMappings = [...labels.values()];
  return result;
}

// The Kaneo status a Jira status maps to: a mapping that names the status id
// wins, then one that only names it (case-insensitive). Pure.
export function findMappedKaneoStatus(
  mappings: Pick<
    ResolvedStatusMapping,
    "jiraStatusId" | "jiraStatusName" | "kaneoStatus"
  >[],
  status: { statusId: string | null; statusName: string },
): string | null {
  if (status.statusId) {
    const byId = mappings.find(
      (mapping) => mapping.jiraStatusId === status.statusId,
    );
    if (byId) return byId.kaneoStatus;
  }
  const name = status.statusName.trim().toLowerCase();
  const byName = mappings.find(
    (mapping) =>
      !mapping.jiraStatusId &&
      mapping.jiraStatusName.trim().toLowerCase() === name,
  );
  return byName?.kaneoStatus ?? null;
}
