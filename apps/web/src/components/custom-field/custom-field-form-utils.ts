import type {
  CustomFieldDefinition,
  CustomFieldType,
  UpdateCustomFieldPayload,
} from "./types";

export type DefaultDraft = string | string[];

/** The comma separated options input: trimmed, blanks dropped, de-duplicated
 * in first-seen order (the same rule the API applies). */
export function parseOptionsText(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(",")
        .map((option) => option.trim())
        .filter(Boolean),
    ),
  );
}

export function hasOptions(type: CustomFieldType): boolean {
  return type === "dropdown" || type === "multiselect";
}

/** The minimum number of options the API accepts for a type. */
export function minimumOptions(type: CustomFieldType): number {
  if (type === "multiselect") return 2;
  return type === "dropdown" ? 1 : 0;
}

/** A stored default as the default-value control edits it: an array for a
 * multiselect, a string for everything else. */
export function readStoredDefault(
  type: CustomFieldType,
  stored: string | null,
): DefaultDraft {
  if (type !== "multiselect") return stored ?? "";
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/** Drops default choices that are no longer among the options, like the
 * create form does as the options input changes. */
export function pruneDefaultToOptions(
  type: CustomFieldType,
  value: DefaultDraft,
  options: string[],
): DefaultDraft {
  if (type === "multiselect") {
    return Array.isArray(value)
      ? value.filter((item) => options.includes(item))
      : [];
  }
  if (type === "dropdown") {
    return typeof value === "string" && options.includes(value) ? value : "";
  }
  return value;
}

export function isDefaultEmpty(value: DefaultDraft): boolean {
  return Array.isArray(value) ? value.length === 0 : value.trim() === "";
}

/** The API string for a default, or undefined when there is none. */
export function toApiDefaultValue(
  type: CustomFieldType,
  value: DefaultDraft,
): string | undefined {
  if (isDefaultEmpty(value)) return undefined;
  if (type === "multiselect") {
    return Array.isArray(value) ? JSON.stringify(value) : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

export type EditDraft = {
  name: string;
  required: boolean;
  optionsText: string;
  defaultValue: DefaultDraft;
};

export function draftFromField(field: CustomFieldDefinition): EditDraft {
  return {
    name: field.name,
    required: field.required,
    optionsText: (field.options ?? []).join(", "),
    defaultValue: readStoredDefault(field.type, field.defaultValue),
  };
}

/** The edit draft with its default pruned to the current options. */
export function resolveDraft(
  field: CustomFieldDefinition,
  draft: EditDraft,
): {
  name: string;
  required: boolean;
  options: string[];
  defaultValue: DefaultDraft;
} {
  const options = hasOptions(field.type)
    ? parseOptionsText(draft.optionsText)
    : [];
  return {
    name: draft.name.trim(),
    required: draft.required,
    options,
    defaultValue: pruneDefaultToOptions(
      field.type,
      draft.defaultValue,
      options,
    ),
  };
}

/** Whether the draft may be sent: the same client-side gate as the create
 * form (the API validates again). */
export function canSaveDraft(
  field: CustomFieldDefinition,
  draft: EditDraft,
): boolean {
  const resolved = resolveDraft(field, draft);
  if (!resolved.name) return false;
  if (resolved.required && isDefaultEmpty(resolved.defaultValue)) return false;
  return (
    !hasOptions(field.type) ||
    resolved.options.length >= minimumOptions(field.type)
  );
}

/** The properties of the draft that differ from the stored field. Empty when
 * nothing changed. */
export function buildUpdatePayload(
  field: CustomFieldDefinition,
  draft: EditDraft,
): UpdateCustomFieldPayload {
  const resolved = resolveDraft(field, draft);
  const payload: UpdateCustomFieldPayload = {};

  if (resolved.name !== field.name) payload.name = resolved.name;
  if (resolved.required !== field.required)
    payload.required = resolved.required;

  if (hasOptions(field.type)) {
    const current = field.options ?? [];
    const changed =
      resolved.options.length !== current.length ||
      resolved.options.some((option, index) => option !== current[index]);
    if (changed) payload.options = resolved.options;
  }

  const nextDefault = toApiDefaultValue(field.type, resolved.defaultValue);
  const currentDefault = toApiDefaultValue(
    field.type,
    readStoredDefault(field.type, field.defaultValue),
  );
  if (nextDefault !== currentDefault) {
    payload.defaultValue = nextDefault ?? null;
  }

  return payload;
}
