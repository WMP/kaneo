import type {
  JiraDraftField,
  JiraSendField,
} from "@/fetchers/jira-integration/types";

// What a draft row holds: the editable Kaneo-side value of the API's draft.
export type DraftValue = JiraDraftField["value"];
export type DraftEdits = Record<string, DraftValue>;

export type DraftInputKind =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "datetime"
  | "select"
  | "multi"
  | "user"
  | "users";

export function inputKindFor(type: JiraDraftField["type"]): DraftInputKind {
  switch (type) {
    case "string":
      return "text";
    case "text":
      return "textarea";
    case "number":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "option":
    case "priority":
      return "select";
    case "options":
    case "labels":
    case "components":
      return "multi";
    case "user":
      return "user";
    case "users":
      return "users";
  }
}

export function isEmptyDraftValue(value: DraftValue | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// The value a row currently holds: the person's edit when there is one (even an
// edit that cleared the row), else the draft's own value.
export function currentValue(
  field: JiraDraftField,
  edits: DraftEdits,
): DraftValue {
  return Object.hasOwn(edits, field.fieldId)
    ? edits[field.fieldId]
    : field.value;
}

export function toList(value: DraftValue | undefined): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.trim() === "" ? [] : [value];
  return [String(value)];
}

export function toText(value: DraftValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

// A date input takes `YYYY-MM-DD`. The draft carries an ISO timestamp for a
// due date; the API converts a `date` field to the UTC calendar day, so the
// same day is shown here.
export function toDateInput(value: DraftValue | undefined): string {
  const text = toText(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

// `datetime-local` takes the local `YYYY-MM-DDTHH:mm`.
export function toDateTimeInput(value: DraftValue | undefined): string {
  const text = toText(value);
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeInput(text: string): string | null {
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function allowedValueText(allowed: {
  id?: string;
  name?: string;
  value?: string;
}): string {
  return allowed.name ?? allowed.value ?? allowed.id ?? "";
}

// What would be sent to Jira for an untouched row, in words: `{ name }`,
// `{ value }`, `[{ name }]` and plain values all read as their text.
export function describeJiraValue(jiraValue: unknown): string | null {
  if (jiraValue === null || jiraValue === undefined) return null;
  if (Array.isArray(jiraValue)) {
    const parts = jiraValue
      .map((entry) => describeJiraValue(entry))
      .filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (typeof jiraValue === "object") {
    const record = jiraValue as Record<string, unknown>;
    for (const key of ["name", "value", "accountId", "key", "id"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate) return candidate;
    }
    return null;
  }
  return String(jiraValue);
}

// Every row goes to the API with the value it holds now. An empty value is left
// out by the API (and never clears a field of an issue that already exists).
export function buildSendFields(
  fields: JiraDraftField[],
  edits: DraftEdits,
): JiraSendField[] {
  return fields.map((field) => {
    const value = currentValue(field, edits);
    return {
      fieldId: field.fieldId,
      type: field.type,
      value: isEmptyDraftValue(value) ? null : (value ?? null),
    };
  });
}

// Rows Jira marks as required that hold nothing. A hint only: the API and Jira
// validate again.
export function findEmptyRequiredFields(
  fields: JiraDraftField[],
  edits: DraftEdits,
): JiraDraftField[] {
  return fields.filter(
    (field) =>
      field.required === true && isEmptyDraftValue(currentValue(field, edits)),
  );
}
