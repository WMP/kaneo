import type { JiraDeployment } from "./config";
import {
  convertFieldValue,
  type JiraFieldValue,
  JiraFieldValueError,
} from "./field-values";
import type { JiraCreateField } from "./jira-client";
import type {
  JiraMappingOrigin,
  ResolvedFieldMapping,
  ResolvedJiraMapping,
} from "./mapping";
import { shapeFields } from "./meta";
import type { JiraFieldType } from "./schema";

// Everything here is pure: the values of the task and the mapping go in, the
// draft comes out. Loading them and asking Jira for the create metadata is
// `draft-loader.ts`.

export type DraftOrigin = "task" | "default" | "empty";

export type DraftAllowedValue = { id?: string; name?: string; value?: string };

export type DraftField = {
  fieldId: string;
  fieldName: string;
  type: JiraFieldType;
  // Editable Kaneo-side value, before the mapping's value map is applied.
  value: JiraFieldValue;
  // What would be sent for `value` (null: nothing is sent).
  jiraValue: unknown | null;
  // `task`: from the task; `default`: the mapping's default value; `empty`.
  origin: DraftOrigin;
  // The mapping level the field mapping comes from.
  mappingOrigin: JiraMappingOrigin;
  required?: boolean;
  allowedValues?: DraftAllowedValue[] | null;
};

export type DraftWarning = { code: string; message: string };

export type DraftTaskValues = {
  title: string;
  description: string | null;
  priority: string;
  status: string;
  dueDate: Date | null;
  startDate: Date | null;
  labels: string[];
  progress: number;
  assigneeUserId: string | null;
};

// A custom field value as stored (text) with the Kaneo type of its field.
export type DraftCustomValue = { type: string; value: string | null };

// The Jira identity of the Kaneo assignee's own connected token.
export type JiraIdentity = {
  accountId: string | null;
  username: string | null;
};

export const COMPONENTS_FIELD_ID = "components";

function isEmptyValue(value: JiraFieldValue | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// Kaneo stores every custom value as text. A multiselect is a JSON array and a
// number is read as one; everything else (dates, booleans as "true"/"false",
// dropdown options) stays text.
export function normalizeCustomValue(
  custom: DraftCustomValue | undefined,
): JiraFieldValue {
  if (!custom || custom.value === null || custom.value.trim() === "") {
    return null;
  }
  if (custom.type === "multiselect") {
    try {
      const parsed: unknown = JSON.parse(custom.value);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (item) => typeof item === "string" || typeof item === "number",
          )
          .map(String);
      }
    } catch {
      // Not a JSON array: use the text as the only selection below.
    }
    return [custom.value];
  }
  if (custom.type === "number") {
    const number = Number(custom.value);
    return Number.isFinite(number) ? number : custom.value;
  }
  return custom.value;
}

// Assignee resolution (plan): a user mapping first, then the Jira identity of
// the assignee's own connected token in the same connection, else nobody.
export function resolveAssigneeJiraUser({
  mapping,
  assigneeUserId,
  identity,
  deployment,
}: {
  mapping: Pick<ResolvedJiraMapping, "userMappings">;
  assigneeUserId: string | null;
  identity: JiraIdentity | null;
  deployment: JiraDeployment;
}): string | null {
  if (!assigneeUserId) return null;
  const mapped = mapping.userMappings.find(
    (entry) => entry.kaneoUserId === assigneeUserId,
  );
  if (mapped) return mapped.jiraUser;
  if (!identity) return null;
  const own = deployment === "cloud" ? identity.accountId : identity.username;
  return own && own.trim() !== "" ? own : null;
}

// Components (plan): the resolved default components plus the components the
// task's labels map to, without duplicates.
export function resolveDraftComponents(
  mapping: Pick<ResolvedJiraMapping, "components" | "labelComponentMappings">,
  labels: string[],
): {
  names: string[];
  fromLabels: boolean;
  fromDefaults: boolean;
  labelOrigin: JiraMappingOrigin | null;
} {
  const names: string[] = [];
  const add = (name: string) => {
    if (!names.includes(name)) names.push(name);
  };
  for (const name of mapping.components.value) add(name);
  const fromDefaults = names.length > 0;

  let fromLabels = false;
  let labelOrigin: JiraMappingOrigin | null = null;
  const byLabel = new Map(
    mapping.labelComponentMappings.map((entry) => [
      entry.kaneoLabel.trim().toLowerCase(),
      entry,
    ]),
  );
  for (const label of labels) {
    const entry = byLabel.get(label.trim().toLowerCase());
    if (!entry) continue;
    fromLabels = true;
    labelOrigin ??= entry.origin;
    add(entry.jiraComponent);
  }
  return { names, fromLabels, fromDefaults, labelOrigin };
}

function builtinValue(
  field: string,
  task: DraftTaskValues,
  assigneeJiraUser: string | null,
): JiraFieldValue {
  switch (field) {
    case "title":
      return task.title;
    case "description":
      return task.description;
    case "priority":
      return task.priority;
    case "status":
      return task.status;
    case "dueDate":
      return task.dueDate ? task.dueDate.toISOString() : null;
    case "startDate":
      return task.startDate ? task.startDate.toISOString() : null;
    case "labels":
      return task.labels;
    case "assignee":
      return assigneeJiraUser;
    case "progress":
      return task.progress;
    default:
      return null;
  }
}

function sourceValue(
  mapping: ResolvedFieldMapping,
  task: DraftTaskValues,
  customValues: Record<string, DraftCustomValue>,
  assigneeJiraUser: string | null,
): JiraFieldValue {
  switch (mapping.source.kind) {
    case "builtin":
      return builtinValue(mapping.source.field, task, assigneeJiraUser);
    case "custom":
      return normalizeCustomValue(customValues[mapping.source.customFieldId]);
    case "none":
      return null;
  }
}

// One field: the task's value when it converts to something, else the mapping's
// default, else nothing. A value that cannot be read as the field's type is a
// warning, and the next candidate is tried.
function buildField(
  mapping: ResolvedFieldMapping,
  task: DraftTaskValues,
  customValues: Record<string, DraftCustomValue>,
  assigneeJiraUser: string | null,
  deployment: JiraDeployment,
  warnings: DraftWarning[],
): DraftField {
  const fieldId = mapping.target.fieldId;
  const fieldName = mapping.target.fieldName ?? fieldId;
  const type = mapping.target.type;
  const taskValue = sourceValue(mapping, task, customValues, assigneeJiraUser);
  const candidates: { origin: DraftOrigin; value: JiraFieldValue }[] = [
    { origin: "task", value: taskValue },
    { origin: "default", value: mapping.defaultValue ?? null },
  ];

  for (const candidate of candidates) {
    if (isEmptyValue(candidate.value)) continue;
    try {
      const jiraValue = convertFieldValue(type, candidate.value, {
        deployment,
        valueMap: mapping.valueMap,
        fieldId,
      });
      if (jiraValue === undefined) continue;
      return {
        fieldId,
        fieldName,
        type,
        value: candidate.value,
        jiraValue,
        origin: candidate.origin,
        mappingOrigin: mapping.origin,
      };
    } catch (error) {
      if (!(error instanceof JiraFieldValueError)) throw error;
      warnings.push({
        code: "JIRA_FIELD_VALUE_INVALID",
        message: `${fieldName}: ${error.message}`,
      });
    }
  }

  return {
    fieldId,
    fieldName,
    type,
    value: isEmptyValue(taskValue) ? null : taskValue,
    jiraValue: null,
    origin: "empty",
    mappingOrigin: mapping.origin,
  };
}

// The fields of a draft, in mapping order. Components come last, as a field of
// their own, unless the mapping maps the `components` field itself.
export function buildDraftFields({
  mapping,
  task,
  customValues,
  deployment,
  assigneeIdentity,
}: {
  mapping: ResolvedJiraMapping;
  task: DraftTaskValues;
  customValues: Record<string, DraftCustomValue>;
  deployment: JiraDeployment;
  assigneeIdentity: JiraIdentity | null;
}): { fields: DraftField[]; warnings: DraftWarning[] } {
  const warnings: DraftWarning[] = [];
  const assigneeJiraUser = resolveAssigneeJiraUser({
    mapping,
    assigneeUserId: task.assigneeUserId,
    identity: assigneeIdentity,
    deployment,
  });

  const fields = mapping.fieldMappings.map((fieldMapping) =>
    buildField(
      fieldMapping,
      task,
      customValues,
      assigneeJiraUser,
      deployment,
      warnings,
    ),
  );

  const mapsComponents = mapping.fieldMappings.some(
    (fieldMapping) => fieldMapping.target.fieldId === COMPONENTS_FIELD_ID,
  );
  if (!mapsComponents) {
    const components = resolveDraftComponents(mapping, task.labels);
    if (components.names.length > 0) {
      const jiraValue = convertFieldValue("components", components.names, {
        deployment,
      });
      fields.push({
        fieldId: COMPONENTS_FIELD_ID,
        fieldName: "Components",
        type: "components",
        value: components.names,
        jiraValue: jiraValue ?? null,
        origin: components.fromLabels ? "task" : "default",
        mappingOrigin: components.fromLabels
          ? (components.labelOrigin ?? mapping.components.origin)
          : mapping.components.origin,
      });
    }
  }

  return { fields, warnings };
}

// Fields Jira fills in itself or that the dialog sets: never reported missing.
const NEVER_MISSING = new Set(["project", "issuetype", "reporter"]);

export type MissingRequiredField = {
  fieldId: string;
  name: string;
  // The field has a mapping but nothing to send.
  mapped: boolean;
};

// Adds what Jira's create metadata says (required flag, allowed values) to the
// draft fields, and lists the required fields that would be sent empty or are
// not mapped at all. A required field Jira fills by default is not missing.
export function applyCreateMeta(
  fields: DraftField[],
  createFields: JiraCreateField[],
): { fields: DraftField[]; missingRequired: MissingRequiredField[] } {
  const shaped = new Map(
    shapeFields(createFields).map((field) => [field.fieldId, field]),
  );
  const byId = new Map(fields.map((field) => [field.fieldId, field]));

  const merged = fields.map((field) => {
    const meta = shaped.get(field.fieldId);
    if (!meta) return field;
    return {
      ...field,
      required: meta.required,
      allowedValues: meta.allowedValues,
    };
  });

  const missingRequired: MissingRequiredField[] = [];
  for (const meta of shaped.values()) {
    if (!meta.required || meta.hasDefaultValue) continue;
    if (NEVER_MISSING.has(meta.fieldId)) continue;
    const field = byId.get(meta.fieldId);
    if (field && field.origin !== "empty") continue;
    missingRequired.push({
      fieldId: meta.fieldId,
      name: meta.name,
      mapped: field !== undefined,
    });
  }
  return { fields: merged, missingRequired };
}
