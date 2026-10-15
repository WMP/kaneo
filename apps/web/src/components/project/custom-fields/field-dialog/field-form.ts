import { toFieldKind } from "@/components/project/custom-fields/field-kinds";
import type {
  CustomFieldDefinition,
  CustomFieldType,
  FieldKind,
} from "@/components/project/custom-fields/types";
import { moveItem } from "@/components/project/sortable/apply-order";

export type FieldFormState = {
  kind: FieldKind;
  name: string;
  options: string[];
  multiple: boolean;
  required: boolean;
  defaultValue: string;
  defaultValues: string[];
  // Option value -> colour token. Only a single-select dropdown keeps colours.
  optionColors: Record<string, string>;
};

export type FieldFormIssue =
  | "nameRequired"
  | "optionsRequired"
  | "moreOptionsRequired"
  | "defaultRequired";

export const EMPTY_FIELD_FORM: FieldFormState = {
  kind: "text",
  name: "",
  options: [],
  multiple: false,
  required: false,
  defaultValue: "",
  defaultValues: [],
  optionColors: {},
};

function parseDefaultValues(value: string | null) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function initialDefault(field: CustomFieldDefinition) {
  if (field.type === "multiselect") return "";
  if (field.type === "boolean") {
    return field.defaultValue === "true" ? "true" : "false";
  }
  return field.defaultValue ?? "";
}

export function formFromField(field?: CustomFieldDefinition | null) {
  if (!field) return EMPTY_FIELD_FORM;

  const multiple = field.type === "multiselect";
  return {
    kind: toFieldKind(field.type),
    name: field.name,
    options: field.options ?? [],
    multiple,
    required: field.required,
    defaultValue: initialDefault(field),
    defaultValues: multiple ? parseDefaultValues(field.defaultValue) : [],
    optionColors: { ...field.optionColors },
  } satisfies FieldFormState;
}

export function setKind(state: FieldFormState, kind: FieldKind) {
  if (kind === state.kind) return state;
  return {
    ...state,
    kind,
    multiple: false,
    defaultValue: kind === "boolean" ? "false" : "",
    defaultValues: [],
    optionColors: {},
  };
}

export function setMultiple(state: FieldFormState, multiple: boolean) {
  if (multiple === state.multiple) return state;
  return multiple
    ? {
        ...state,
        multiple,
        defaultValue: "",
        defaultValues: state.defaultValue ? [state.defaultValue] : [],
        optionColors: {},
      }
    : {
        ...state,
        multiple,
        defaultValue: state.defaultValues[0] ?? "",
        defaultValues: [],
      };
}

export function addOption(state: FieldFormState, raw: string) {
  const option = raw.trim();
  if (!option || state.options.includes(option)) return state;
  return { ...state, options: [...state.options, option] };
}

export function hasOptionColors(state: FieldFormState) {
  return state.kind === "dropdown" && !state.multiple;
}

export function setOptionColor(
  state: FieldFormState,
  option: string,
  color: string,
) {
  if (!hasOptionColors(state) || !state.options.includes(option)) return state;
  return { ...state, optionColors: { ...state.optionColors, [option]: color } };
}

function pruneColors(colors: Record<string, string>, options: string[]) {
  return Object.fromEntries(
    Object.entries(colors).filter(([option]) => options.includes(option)),
  );
}

function sameColors(a: Record<string, string>, b: Record<string, string>) {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
  );
}

export function removeOption(state: FieldFormState, option: string) {
  return {
    ...state,
    optionColors: pruneColors(
      state.optionColors,
      state.options.filter((candidate) => candidate !== option),
    ),
    options: state.options.filter((candidate) => candidate !== option),
    defaultValue: state.defaultValue === option ? "" : state.defaultValue,
    defaultValues: state.defaultValues.filter((value) => value !== option),
  };
}

export function renameOption(state: FieldFormState, from: string, raw: string) {
  const to = raw.trim();
  if (!to || to === from || state.options.includes(to)) return state;

  const rename = (value: string) => (value === from ? to : value);
  // The colour follows the option to its new name.
  const { [from]: movedColor, ...otherColors } = state.optionColors;
  return {
    ...state,
    options: state.options.map(rename),
    optionColors:
      movedColor === undefined
        ? otherColors
        : { ...otherColors, [to]: movedColor },
    defaultValue: rename(state.defaultValue),
    defaultValues: state.defaultValues.map(rename),
  };
}

export function moveOption(state: FieldFormState, from: number, to: number) {
  return { ...state, options: moveItem(state.options, from, to) };
}

export function toApiType(state: FieldFormState): CustomFieldType {
  return state.kind === "dropdown" && state.multiple
    ? "multiselect"
    : state.kind;
}

export function toApiDefault(state: FieldFormState): string | null {
  if (toApiType(state) === "multiselect") {
    return state.defaultValues.length > 0
      ? JSON.stringify(state.defaultValues)
      : null;
  }

  const trimmed = state.defaultValue.trim();
  if (!trimmed) return null;
  return state.kind === "text" ? state.defaultValue : trimmed;
}

export function getFormIssue(state: FieldFormState): FieldFormIssue | null {
  if (!state.name.trim()) return "nameRequired";
  if (
    state.kind === "dropdown" &&
    state.options.length < (state.multiple ? 2 : 1)
  ) {
    return state.multiple ? "moreOptionsRequired" : "optionsRequired";
  }
  if (state.required && toApiDefault(state) === null) return "defaultRequired";
  return null;
}

export function toCreatePayload(state: FieldFormState, projectId: string) {
  return {
    projectId,
    name: state.name.trim(),
    type: toApiType(state),
    required: state.required,
    defaultValue: toApiDefault(state) ?? undefined,
    options: state.kind === "dropdown" ? state.options : undefined,
    optionColors: toColors(state),
  };
}

function toColors(state: FieldFormState) {
  if (!hasOptionColors(state)) return undefined;
  const colors = pruneColors(state.optionColors, state.options);
  return Object.keys(colors).length > 0 ? colors : undefined;
}

// What the edit sends: the type is immutable, so it is never part of it. The
// colours go along only when the person changed one of a surviving option; left
// out, the API keeps the stored colours of the options that remain.
export function toUpdatePayload(
  state: FieldFormState,
  field?: CustomFieldDefinition | null,
) {
  const colors = hasOptionColors(state)
    ? pruneColors(state.optionColors, state.options)
    : null;
  const stored = pruneColors(field?.optionColors ?? {}, state.options);
  return {
    name: state.name.trim(),
    required: state.required,
    defaultValue: toApiDefault(state),
    ...(state.kind === "dropdown" ? { options: state.options } : {}),
    ...(colors && !sameColors(colors, stored) ? { optionColors: colors } : {}),
  };
}
