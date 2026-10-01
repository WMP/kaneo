import type { JiraDeployment } from "./config";
import type { JiraFieldType } from "./schema";

// What a Kaneo value looks like before it becomes Jira JSON. Dates travel as
// ISO strings, multiselect values as arrays, booleans as "true" / "false".
export type JiraFieldValue = string | number | boolean | string[] | null;

export class JiraFieldValueError extends Error {
  constructor(
    public fieldId: string,
    message: string,
  ) {
    super(message);
    this.name = "JiraFieldValueError";
  }
}

export type ConvertOptions = {
  deployment: JiraDeployment;
  // Kaneo value -> Jira value. A value without an entry is used unchanged, so
  // a value the person typed in the dialog (already a Jira value) passes through.
  valueMap?: Record<string, string>;
  // Only used in error messages.
  fieldId?: string;
};

// `project` and `issuetype` come from the dialog's own inputs, never from the
// typed field list.
export const RESERVED_JIRA_FIELD_IDS: ReadonlySet<string> = new Set([
  "project",
  "issuetype",
]);

function isBlank(text: string): boolean {
  return text.trim() === "";
}

// A list from an array, a JSON array in text (Kaneo multiselect) or a
// comma-separated text.
function toList(value: JiraFieldValue | undefined): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed
            .filter(
              (item) => typeof item === "string" || typeof item === "number",
            )
            .map((item) => String(item).trim())
            .filter((item) => item !== "");
        }
      } catch {
        // Not JSON: fall through to the comma-separated reading.
      }
    }
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }
  return [String(value)];
}

function toScalarText(value: JiraFieldValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function mapScalar(text: string, valueMap?: Record<string, string>): string {
  if (!valueMap) return text;
  return Object.hasOwn(valueMap, text) ? (valueMap[text] ?? "") : text;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function toDateOnly(value: string, fieldId: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00.000Z`);
    if (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === trimmed
    ) {
      return trimmed;
    }
    throw new JiraFieldValueError(fieldId, `"${value}" is not a valid date.`);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new JiraFieldValueError(fieldId, `"${value}" is not a valid date.`);
  }
  return parsed.toISOString().slice(0, 10);
}

function toIsoDateTime(value: string, fieldId: string): string {
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw new JiraFieldValueError(
      fieldId,
      `"${value}" is not a valid date and time.`,
    );
  }
  return parsed.toISOString();
}

// Jira labels cannot contain spaces.
export function toJiraLabel(label: string): string {
  return label.trim().replace(/\s+/g, "-");
}

function userShape(
  identity: string,
  deployment: JiraDeployment,
): { name: string } | { accountId: string } {
  return deployment === "cloud" ? { accountId: identity } : { name: identity };
}

// Converts one typed Kaneo value into the Jira JSON of its field type (plan:
// "Value conversion"). Returns `undefined` for an empty value: the field is then
// left out of the request instead of being sent empty. A value that cannot be
// read as its type throws `JiraFieldValueError`.
export function convertFieldValue(
  type: JiraFieldType,
  value: JiraFieldValue | undefined,
  options: ConvertOptions,
): unknown {
  const fieldId = options.fieldId ?? "field";
  const mapText = (text: string) => mapScalar(text, options.valueMap);
  const mappedList = () =>
    toList(value)
      .map(mapText)
      .filter((s) => !isBlank(s));

  switch (type) {
    case "string":
    case "text": {
      const text = mapText(toScalarText(value));
      return isBlank(text) ? undefined : text;
    }
    case "number": {
      const text = mapText(toScalarText(value));
      if (isBlank(text)) return undefined;
      const number = Number(text);
      if (!Number.isFinite(number)) {
        throw new JiraFieldValueError(fieldId, `"${text}" is not a number.`);
      }
      return number;
    }
    case "date": {
      const text = mapText(toScalarText(value));
      return isBlank(text) ? undefined : toDateOnly(text, fieldId);
    }
    case "datetime": {
      const text = mapText(toScalarText(value));
      return isBlank(text) ? undefined : toIsoDateTime(text, fieldId);
    }
    case "option": {
      const text = mapText(toScalarText(value)).trim();
      return text === "" ? undefined : { value: text };
    }
    case "options": {
      const items = unique(mappedList());
      return items.length === 0
        ? undefined
        : items.map((item) => ({ value: item }));
    }
    case "labels": {
      const items = unique(mappedList().map(toJiraLabel));
      return items.length === 0 ? undefined : items;
    }
    case "components": {
      const items = unique(mappedList());
      return items.length === 0
        ? undefined
        : items.map((item) => ({ name: item }));
    }
    case "priority": {
      const text = mapText(toScalarText(value)).trim();
      return text === "" ? undefined : { name: text };
    }
    case "user": {
      const text = mapText(toScalarText(value)).trim();
      return text === "" ? undefined : userShape(text, options.deployment);
    }
    case "users": {
      const items = unique(mappedList());
      return items.length === 0
        ? undefined
        : items.map((item) => userShape(item, options.deployment));
    }
  }
}

export type TypedFieldValue = {
  fieldId: string;
  type: JiraFieldType;
  value: JiraFieldValue;
};

// The `fields` object of a create or update request. Only the typed values
// are converted here; no Jira JSON from the client is ever passed through.
// Empty values are left out (an update never clears a Jira field).
export function buildJiraIssueFields({
  deployment,
  fields,
  valueMaps = {},
  create,
}: {
  deployment: JiraDeployment;
  fields: TypedFieldValue[];
  valueMaps?: Record<string, Record<string, string> | undefined>;
  create?: { jiraProjectKey: string; issueTypeId: string };
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (create) {
    out.project = { key: create.jiraProjectKey };
    out.issuetype = { id: create.issueTypeId };
  }
  for (const field of fields) {
    if (RESERVED_JIRA_FIELD_IDS.has(field.fieldId)) continue;
    const converted = convertFieldValue(field.type, field.value, {
      deployment,
      valueMap: valueMaps[field.fieldId],
      fieldId: field.fieldId,
    });
    if (converted !== undefined) out[field.fieldId] = converted;
  }
  return out;
}
