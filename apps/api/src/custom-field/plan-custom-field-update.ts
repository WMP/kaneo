import { HTTPException } from "hono/http-exception";
import { isCustomFieldValueEmpty } from "../task/validate-task-fields";
import { validateCustomFieldCreateInput } from "./validate-definition-input";

export type CustomFieldUpdatePatch = {
  name?: string;
  required?: boolean;
  // null (or a blank string) clears the stored default; omitted keeps it.
  defaultValue?: string | null;
  // Full replacement list; omitted keeps the current options.
  options?: string[];
  // null clears stored colors; omitted keeps the colors of surviving options.
  optionColors?: Record<string, string> | null;
};

export type CustomFieldUpdateExisting = {
  name: string;
  type: string;
  required: boolean;
  defaultValue: string | null;
  options: unknown;
  optionColors: Record<string, string> | null;
};

export type CustomFieldUpdatePlan = {
  name: string;
  required: boolean;
  defaultValue: string | null;
  options: string[] | null;
  optionColors: Record<string, string> | null;
  // Options the field has today that the patch drops. The caller must make
  // sure no task value still references one of them before writing.
  removedOptions: string[];
};

type ValueType = Parameters<typeof isCustomFieldValueEmpty>[1];

const OPTION_TYPES = new Set(["dropdown", "multiselect"]);

/** Trim, drop blanks and de-duplicate, keeping first-seen order. */
export function normalizeOptions(options: readonly unknown[]): string[] {
  return Array.from(
    new Set(
      options
        .filter((option): option is string => typeof option === "string")
        .map((option) => option.trim())
        .filter((option) => option.length > 0),
    ),
  );
}

/**
 * Pure merge of an edit over a stored definition, validated with the same
 * rules as creating a field (`validateCustomFieldCreateInput`) against the
 * merged result. The type is immutable, so it always comes from the stored
 * row. Throws HTTPException(400) on any invalid combination; nothing is
 * written here, so a rejected edit leaves the field untouched.
 */
export function planCustomFieldUpdate(
  existing: CustomFieldUpdateExisting,
  patch: CustomFieldUpdatePatch,
): CustomFieldUpdatePlan {
  const { type } = existing;
  const supportsOptions = OPTION_TYPES.has(type);

  if (patch.options !== undefined && !supportsOptions) {
    throw new HTTPException(400, {
      message: "Options are only supported for dropdown and multiselect fields",
    });
  }

  const name = (patch.name ?? existing.name).trim();
  const required = patch.required ?? existing.required;

  const existingOptions = Array.isArray(existing.options)
    ? normalizeOptions(existing.options)
    : [];
  const options = supportsOptions
    ? patch.options !== undefined
      ? normalizeOptions(patch.options)
      : existingOptions
    : null;

  const mergedDefault =
    patch.defaultValue !== undefined
      ? (patch.defaultValue ?? undefined)
      : (existing.defaultValue ?? undefined);

  // Omitted colors follow the options: entries of removed options are pruned
  // instead of failing the edit. Explicit colors are validated as sent.
  let optionColors: Record<string, string> | null | undefined;
  if (patch.optionColors !== undefined) {
    optionColors = patch.optionColors;
  } else if (type === "dropdown" && existing.optionColors) {
    const kept = new Set(options ?? []);
    const pruned = Object.fromEntries(
      Object.entries(existing.optionColors).filter(([option]) =>
        kept.has(option),
      ),
    );
    optionColors = Object.keys(pruned).length > 0 ? pruned : null;
  } else {
    optionColors = null;
  }

  const normalized = validateCustomFieldCreateInput({
    name,
    type,
    required,
    defaultValue: mergedDefault,
    options: options ?? undefined,
    optionColors: optionColors ?? undefined,
  });

  const storedDefault = normalized.storedDefaultValue;
  const defaultValue =
    storedDefault == null ||
    storedDefault.trim() === "" ||
    isCustomFieldValueEmpty(storedDefault, type as ValueType)
      ? null
      : storedDefault;

  const removedOptions =
    options && patch.options !== undefined
      ? existingOptions.filter((option) => !options.includes(option))
      : [];

  return {
    name,
    required,
    defaultValue,
    options,
    optionColors: type === "dropdown" ? (optionColors ?? null) : null,
    removedOptions,
  };
}
