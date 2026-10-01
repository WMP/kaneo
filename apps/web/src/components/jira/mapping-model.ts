import type {
  JiraFieldMapping,
  JiraFieldType,
  JiraLabelComponentMapping,
  JiraMappingConfig,
  JiraMappingOrigin,
  JiraMetaField,
  JiraStatusMapping,
  JiraUserMapping,
  ResolvedJiraMapping,
} from "@/fetchers/jira-integration/types";

// Pure model of the mapping editor: how the own level is shown next to the
// inherited (parent) rows, and how a row is overridden, disabled, removed or
// cleaned up before it is saved. It mirrors the API's merge rules
// (`resolveJiraMapping`): list entries are keyed, a more specific entry
// replaces the whole entry and a removal marker (`disabled: true`,
// `kaneoStatus: null`, `jiraUser: null`, `jiraComponent: null`) removes the
// inherited one. Nothing is imported from the API.

export type MappingLevel = "workspace" | "project" | "user";

export type ListName =
  | "fieldMappings"
  | "statusMappings"
  | "userMappings"
  | "labelComponentMappings";

export type ParentFieldMapping = ResolvedJiraMapping["fieldMappings"][number];
export type ParentStatusMapping = ResolvedJiraMapping["statusMappings"][number];
export type ParentUserMapping = ResolvedJiraMapping["userMappings"][number];
export type ParentLabelMapping =
  ResolvedJiraMapping["labelComponentMappings"][number];

export const MULTI_VALUE_TYPES: ReadonlySet<JiraFieldType> = new Set([
  "options",
  "labels",
  "components",
  "users",
]);

export const JIRA_FIELD_TYPES: JiraFieldType[] = [
  "string",
  "text",
  "number",
  "date",
  "datetime",
  "option",
  "options",
  "labels",
  "components",
  "priority",
  "user",
  "users",
];

export const BUILTIN_SOURCES = [
  "title",
  "description",
  "priority",
  "status",
  "dueDate",
  "startDate",
  "labels",
  "assignee",
  "progress",
] as const;

export type BuiltinSource = (typeof BUILTIN_SOURCES)[number];

// ---------------------------------------------------------------------------
// Keys (same as the API's merge keys)

export function fieldKey(mapping: Pick<JiraFieldMapping, "target">): string {
  return mapping.target.fieldId.trim();
}

export function statusKey(
  mapping: Pick<JiraStatusMapping, "jiraStatusId" | "jiraStatusName">,
): string {
  const name = mapping.jiraStatusName.trim().toLowerCase();
  if (mapping.jiraStatusId) return `id:${mapping.jiraStatusId}`;
  return name ? `name:${name}` : "";
}

export function userKey(mapping: Pick<JiraUserMapping, "kaneoUserId">) {
  return mapping.kaneoUserId.trim();
}

export function labelKey(
  mapping: Pick<JiraLabelComponentMapping, "kaneoLabel">,
) {
  return mapping.kaneoLabel.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Rows: what the editor lists for one section

export type RowEntry<Own, Parent> =
  // Only an upper level has it; it applies here unchanged.
  | { kind: "inherited"; key: string; parent: Parent }
  // The own level has it (it replaces the inherited row with the same key).
  | { kind: "own"; key: string; index: number; own: Own; overrides?: Parent }
  // The own level removes the inherited row.
  | {
      kind: "disabled";
      key: string;
      index: number;
      own: Own;
      parent?: Parent;
    };

export function buildRows<Own, Parent>(
  ownList: readonly Own[] | undefined,
  parentList: readonly Parent[] | undefined,
  ownKey: (row: Own) => string,
  parentKey: (row: Parent) => string,
  isRemoval: (row: Own) => boolean,
): RowEntry<Own, Parent>[] {
  const own = ownList ?? [];
  const parents = parentList ?? [];
  const parentByKey = new Map<string, Parent>();
  for (const parent of parents) parentByKey.set(parentKey(parent), parent);

  const ownKeys = new Set<string>();
  const ownEntries: RowEntry<Own, Parent>[] = own.map((row, index) => {
    const key = ownKey(row);
    if (key) ownKeys.add(key);
    const parent = key ? parentByKey.get(key) : undefined;
    return isRemoval(row)
      ? { kind: "disabled", key, index, own: row, parent }
      : { kind: "own", key, index, own: row, overrides: parent };
  });

  const inherited: RowEntry<Own, Parent>[] = parents
    .filter((parent) => !ownKeys.has(parentKey(parent)))
    .map((parent) => ({
      kind: "inherited",
      key: parentKey(parent),
      parent,
    }));

  return [...inherited, ...ownEntries];
}

export function fieldRows(
  config: JiraMappingConfig,
  parent: ResolvedJiraMapping | undefined,
) {
  return buildRows<JiraFieldMapping, ParentFieldMapping>(
    config.fieldMappings,
    parent?.fieldMappings,
    fieldKey,
    fieldKey,
    (row) => row.disabled === true,
  );
}

export function statusRows(
  config: JiraMappingConfig,
  parent: ResolvedJiraMapping | undefined,
) {
  return buildRows<JiraStatusMapping, ParentStatusMapping>(
    config.statusMappings,
    parent?.statusMappings,
    statusKey,
    statusKey,
    (row) => row.kaneoStatus === null,
  );
}

export function userRows(
  config: JiraMappingConfig,
  parent: ResolvedJiraMapping | undefined,
) {
  return buildRows<JiraUserMapping, ParentUserMapping>(
    config.userMappings,
    parent?.userMappings,
    userKey,
    userKey,
    (row) => row.jiraUser === null,
  );
}

export function labelRows(
  config: JiraMappingConfig,
  parent: ResolvedJiraMapping | undefined,
) {
  return buildRows<JiraLabelComponentMapping, ParentLabelMapping>(
    config.labelComponentMappings,
    parent?.labelComponentMappings,
    labelKey,
    labelKey,
    (row) => row.jiraComponent === null,
  );
}

// ---------------------------------------------------------------------------
// Row operations (all return a new config)

export function overrideFieldRow(
  config: JiraMappingConfig,
  parent: ParentFieldMapping,
): JiraMappingConfig {
  const { origin: _origin, ...row } = structuredClone(parent);
  return appendRow(config, "fieldMappings", row);
}

export function disableFieldRow(
  config: JiraMappingConfig,
  parent: ParentFieldMapping,
): JiraMappingConfig {
  return appendRow(config, "fieldMappings", {
    target: structuredClone(parent.target),
    source: { kind: "none" },
    disabled: true,
  });
}

export function overrideStatusRow(
  config: JiraMappingConfig,
  parent: ParentStatusMapping,
): JiraMappingConfig {
  return appendRow(config, "statusMappings", {
    ...(parent.jiraStatusId ? { jiraStatusId: parent.jiraStatusId } : {}),
    jiraStatusName: parent.jiraStatusName,
    kaneoStatus: parent.kaneoStatus,
  });
}

export function disableStatusRow(
  config: JiraMappingConfig,
  parent: ParentStatusMapping,
): JiraMappingConfig {
  return appendRow(config, "statusMappings", {
    ...(parent.jiraStatusId ? { jiraStatusId: parent.jiraStatusId } : {}),
    jiraStatusName: parent.jiraStatusName,
    kaneoStatus: null,
  });
}

export function overrideUserRow(
  config: JiraMappingConfig,
  parent: ParentUserMapping,
): JiraMappingConfig {
  return appendRow(config, "userMappings", {
    kaneoUserId: parent.kaneoUserId,
    jiraUser: parent.jiraUser,
  });
}

export function disableUserRow(
  config: JiraMappingConfig,
  parent: ParentUserMapping,
): JiraMappingConfig {
  return appendRow(config, "userMappings", {
    kaneoUserId: parent.kaneoUserId,
    jiraUser: null,
  });
}

export function overrideLabelRow(
  config: JiraMappingConfig,
  parent: ParentLabelMapping,
): JiraMappingConfig {
  return appendRow(config, "labelComponentMappings", {
    kaneoLabel: parent.kaneoLabel,
    jiraComponent: parent.jiraComponent,
  });
}

export function disableLabelRow(
  config: JiraMappingConfig,
  parent: ParentLabelMapping,
): JiraMappingConfig {
  return appendRow(config, "labelComponentMappings", {
    kaneoLabel: parent.kaneoLabel,
    jiraComponent: null,
  });
}

type ListRow<L extends ListName> = NonNullable<JiraMappingConfig[L]>[number];

export function appendRow<L extends ListName>(
  config: JiraMappingConfig,
  list: L,
  row: ListRow<L>,
): JiraMappingConfig {
  return {
    ...config,
    [list]: [...((config[list] as ListRow<L>[] | undefined) ?? []), row],
  };
}

export function updateRow<L extends ListName>(
  config: JiraMappingConfig,
  list: L,
  index: number,
  patch: Partial<ListRow<L>>,
): JiraMappingConfig {
  const rows = [...((config[list] as ListRow<L>[] | undefined) ?? [])];
  if (index < 0 || index >= rows.length) return config;
  rows[index] = { ...rows[index], ...patch };
  return { ...config, [list]: rows };
}

// Removing an own row (or a removal marker) makes the key inherit again.
export function removeRow<L extends ListName>(
  config: JiraMappingConfig,
  list: L,
  index: number,
): JiraMappingConfig {
  const rows = [...((config[list] as ListRow<L>[] | undefined) ?? [])];
  if (index < 0 || index >= rows.length) return config;
  rows.splice(index, 1);
  return { ...config, [list]: rows };
}

export function emptyFieldMapping(): JiraFieldMapping {
  return {
    target: { fieldId: "", type: "string" },
    source: { kind: "none" },
  };
}

// ---------------------------------------------------------------------------
// Field types and default values

// Jira's create metadata names a field's shape; the mapping needs one of our
// field types to convert the value when sending.
export function inferJiraFieldType(
  field: Pick<JiraMetaField, "fieldId" | "schema">,
): JiraFieldType {
  const schema = field.schema;
  if (!schema) return "string";
  const custom = schema.custom ?? "";
  switch (schema.type) {
    case "number":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "priority":
      return "priority";
    case "option":
      return "option";
    case "user":
      return "user";
    case "string":
      return custom.endsWith(":textarea") ||
        schema.system === "description" ||
        schema.system === "environment"
        ? "text"
        : "string";
    case "array":
      switch (schema.items) {
        case "option":
          return "options";
        case "component":
          return "components";
        case "user":
          return "users";
        default:
          return "labels";
      }
    default:
      return "string";
  }
}

type DefaultValue = NonNullable<JiraFieldMapping["defaultValue"]>;

// The text shown for a default value; a list is edited as chips instead.
export function defaultValueToText(value: JiraFieldMapping["defaultValue"]) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export function defaultValueToList(
  value: JiraFieldMapping["defaultValue"],
): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Keeps the default value valid when the field type changes between a single
// value and a list.
export function coerceDefaultValue(
  value: JiraFieldMapping["defaultValue"],
  type: JiraFieldType,
): JiraFieldMapping["defaultValue"] {
  if (value === null || value === undefined) return value;
  if (MULTI_VALUE_TYPES.has(type)) {
    return Array.isArray(value) ? value : defaultValueToList(value);
  }
  return Array.isArray(value) ? value.join(", ") : value;
}

export function isNumericText(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Number(value));
}

// ---------------------------------------------------------------------------
// Clean up and validate

function blankToUndefined(value: string | null | undefined) {
  if (value === null || value === undefined) return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function cleanFieldMapping(mapping: JiraFieldMapping): JiraFieldMapping {
  const fieldName = blankToUndefined(mapping.target.fieldName);
  const target = {
    fieldId: mapping.target.fieldId.trim(),
    ...(fieldName ? { fieldName } : {}),
    type: mapping.target.type,
  };

  if (mapping.disabled) {
    return { target, source: { kind: "none" }, disabled: true };
  }

  const source: JiraFieldMapping["source"] =
    mapping.source.kind === "custom"
      ? { kind: "custom", customFieldId: mapping.source.customFieldId }
      : mapping.source.kind === "builtin"
        ? { kind: "builtin", field: mapping.source.field }
        : { kind: "none" };

  const valueMap = Object.fromEntries(
    Object.entries(mapping.valueMap ?? {}).filter(
      ([key, value]) => key.trim() !== "" && value.trim() !== "",
    ),
  );

  let defaultValue: JiraFieldMapping["defaultValue"];
  const raw = mapping.defaultValue;
  if (Array.isArray(raw)) {
    const list = raw.map((entry) => entry.trim()).filter(Boolean);
    defaultValue = list.length > 0 ? list : undefined;
  } else if (typeof raw === "string") {
    const text = raw.trim();
    if (text === "") defaultValue = undefined;
    else if (mapping.target.type === "number" && isNumericText(text)) {
      defaultValue = Number(text);
    } else defaultValue = text;
  } else if (raw === null) {
    defaultValue = null;
  } else {
    defaultValue = raw;
  }

  return {
    target,
    source,
    ...(Object.keys(valueMap).length > 0 ? { valueMap } : {}),
    ...(defaultValue !== undefined
      ? { defaultValue: defaultValue as DefaultValue | null }
      : {}),
  };
}

function cleanStatusMapping(mapping: JiraStatusMapping): JiraStatusMapping {
  const id = blankToUndefined(mapping.jiraStatusId);
  return {
    ...(id ? { jiraStatusId: id } : {}),
    jiraStatusName: mapping.jiraStatusName.trim(),
    kaneoStatus:
      mapping.kaneoStatus === null ? null : mapping.kaneoStatus.trim(),
  };
}

// The config to send: blanks become absent (inherit), empty lists are dropped
// (an absent list inherits), and the user level never carries statuses.
export function cleanConfig(
  level: MappingLevel,
  config: JiraMappingConfig,
): JiraMappingConfig {
  const out: JiraMappingConfig = {};

  for (const key of [
    "jiraProjectKey",
    "issueTypeId",
    "issueTypeName",
  ] as const) {
    const value = config[key];
    if (value === null) out[key] = null;
    else {
      const cleaned = blankToUndefined(value);
      if (cleaned !== undefined) out[key] = cleaned;
    }
  }

  if (config.components === null) out.components = null;
  else if (config.components) {
    const components = config.components
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (components.length > 0) out.components = components;
  }

  if (config.fieldMappings?.length) {
    out.fieldMappings = config.fieldMappings.map(cleanFieldMapping);
  }
  if (level !== "user" && config.statusMappings?.length) {
    out.statusMappings = config.statusMappings.map(cleanStatusMapping);
  }
  if (config.userMappings?.length) {
    out.userMappings = config.userMappings.map((mapping) => ({
      kaneoUserId: mapping.kaneoUserId.trim(),
      jiraUser: mapping.jiraUser === null ? null : mapping.jiraUser.trim(),
    }));
  }
  if (config.labelComponentMappings?.length) {
    out.labelComponentMappings = config.labelComponentMappings.map(
      (mapping) => ({
        kaneoLabel: mapping.kaneoLabel.trim(),
        jiraComponent:
          mapping.jiraComponent === null ? null : mapping.jiraComponent.trim(),
      }),
    );
  }
  return out;
}

export function configsEqual(
  level: MappingLevel,
  a: JiraMappingConfig,
  b: JiraMappingConfig,
): boolean {
  return (
    JSON.stringify(cleanConfig(level, a)) ===
    JSON.stringify(cleanConfig(level, b))
  );
}

export type MappingIssueCode =
  | "fieldTargetRequired"
  | "fieldDuplicate"
  | "fieldNumberInvalid"
  | "statusJiraRequired"
  | "statusKaneoRequired"
  | "statusDuplicate"
  | "userKaneoRequired"
  | "userJiraRequired"
  | "userDuplicate"
  | "labelKaneoRequired"
  | "labelComponentRequired"
  | "labelDuplicate";

export type MappingIssue = {
  list: ListName;
  index: number;
  code: MappingIssueCode;
};

// What prevents a save: incomplete rows and two own rows with the same key
// (the API would keep only one of them). Removal markers are complete by
// construction.
export function validateConfig(
  level: MappingLevel,
  config: JiraMappingConfig,
): MappingIssue[] {
  const issues: MappingIssue[] = [];

  function duplicates<T>(
    list: ListName,
    rows: readonly T[] | undefined,
    key: (row: T) => string,
    code: MappingIssueCode,
  ) {
    const seen = new Set<string>();
    (rows ?? []).forEach((row, index) => {
      const value = key(row);
      if (!value) return;
      if (seen.has(value)) issues.push({ list, index, code });
      seen.add(value);
    });
  }

  (config.fieldMappings ?? []).forEach((row, index) => {
    if (!fieldKey(row)) {
      issues.push({
        list: "fieldMappings",
        index,
        code: "fieldTargetRequired",
      });
    }
    if (
      !row.disabled &&
      row.target.type === "number" &&
      typeof row.defaultValue === "string" &&
      row.defaultValue.trim() !== "" &&
      !isNumericText(row.defaultValue)
    ) {
      issues.push({ list: "fieldMappings", index, code: "fieldNumberInvalid" });
    }
  });
  duplicates("fieldMappings", config.fieldMappings, fieldKey, "fieldDuplicate");

  if (level !== "user") {
    (config.statusMappings ?? []).forEach((row, index) => {
      if (!row.jiraStatusName.trim()) {
        issues.push({
          list: "statusMappings",
          index,
          code: "statusJiraRequired",
        });
      }
      if (row.kaneoStatus !== null && !row.kaneoStatus.trim()) {
        issues.push({
          list: "statusMappings",
          index,
          code: "statusKaneoRequired",
        });
      }
    });
    duplicates(
      "statusMappings",
      config.statusMappings,
      statusKey,
      "statusDuplicate",
    );
  }

  (config.userMappings ?? []).forEach((row, index) => {
    if (!row.kaneoUserId.trim()) {
      issues.push({ list: "userMappings", index, code: "userKaneoRequired" });
    }
    if (row.jiraUser !== null && !row.jiraUser.trim()) {
      issues.push({ list: "userMappings", index, code: "userJiraRequired" });
    }
  });
  duplicates("userMappings", config.userMappings, userKey, "userDuplicate");

  (config.labelComponentMappings ?? []).forEach((row, index) => {
    if (!row.kaneoLabel.trim()) {
      issues.push({
        list: "labelComponentMappings",
        index,
        code: "labelKaneoRequired",
      });
    }
    if (row.jiraComponent !== null && !row.jiraComponent.trim()) {
      issues.push({
        list: "labelComponentMappings",
        index,
        code: "labelComponentRequired",
      });
    }
  });
  duplicates(
    "labelComponentMappings",
    config.labelComponentMappings,
    labelKey,
    "labelDuplicate",
  );

  return issues;
}

// ---------------------------------------------------------------------------
// Inheritance of the scalar settings

export type InheritedScalar<T> = { value: T; origin: JiraMappingOrigin };

// The value the editor shows as "inherited" for a scalar: only when the parent
// has an actual value (the default origin with null means nobody set it).
export function inheritedValue<T>(
  scalar: InheritedScalar<T> | undefined,
): InheritedScalar<T> | undefined {
  if (!scalar) return undefined;
  if (scalar.value === null) return undefined;
  if (Array.isArray(scalar.value) && scalar.value.length === 0) {
    return undefined;
  }
  return scalar;
}

// The project key and issue type the metadata pickers read: the own value,
// else the inherited one.
export function effectiveScalar(
  own: string | null | undefined,
  inherited: InheritedScalar<string | null> | undefined,
): string | null {
  if (own) return own;
  if (own === null) return null;
  return inherited?.value ?? null;
}
