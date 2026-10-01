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
  /** Option value -> color token. May hold entries of options the user has
   * since removed from the text; resolveDraft prunes them. */
  optionColors: Record<string, string>;
};

/** Only a single-select dropdown stores option colors. */
export function hasOptionColors(type: CustomFieldType): boolean {
  return type === "dropdown";
}

function pruneColorsToOptions(
  colors: Record<string, string>,
  options: string[],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(colors).filter(([option]) => options.includes(option)),
  );
}

function sameColors(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}

export function draftFromField(field: CustomFieldDefinition): EditDraft {
  return {
    name: field.name,
    required: field.required,
    optionsText: (field.options ?? []).join(", "),
    defaultValue: readStoredDefault(field.type, field.defaultValue),
    optionColors: { ...(field.optionColors ?? {}) },
  };
}

/** The edit draft with its default and option colors pruned to the current
 * options. Colors are keyed by option value, so a renamed option is a removed
 * one plus a new one: the form cannot tell them apart and the new option
 * starts without a color. */
export function resolveDraft(
  field: CustomFieldDefinition,
  draft: EditDraft,
): {
  name: string;
  required: boolean;
  options: string[];
  defaultValue: DefaultDraft;
  optionColors: Record<string, string>;
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
    optionColors: hasOptionColors(field.type)
      ? pruneColorsToOptions(draft.optionColors, options)
      : {},
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

  // Colors of removed options need no entry here: the API prunes them when
  // `optionColors` is omitted. Send the map only when the user changed the
  // color of an option that survives.
  if (hasOptionColors(field.type)) {
    const stored = pruneColorsToOptions(
      field.optionColors ?? {},
      resolved.options,
    );
    if (!sameColors(resolved.optionColors, stored)) {
      payload.optionColors = resolved.optionColors;
    }
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
