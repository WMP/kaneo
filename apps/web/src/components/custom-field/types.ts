export type CustomFieldType =
  | "text"
  | "number"
  | "date"
  | "dropdown"
  | "boolean"
  | "multiselect";

// Mirrors the API's CustomFieldDefinition response shape (see
// apps/api/src/custom-field/response.ts). Set for every field regardless of
// scope: a project-level field always has hideable: false, hidden: false.
export type CustomFieldDefinition = {
  id: string;
  projectId: string | null;
  workspaceId: string | null;
  scope: "workspace" | "project";
  hideable: boolean;
  hidden: boolean;
  name: string;
  type: CustomFieldType;
  required: boolean;
  defaultValue: string | null;
  options: string[] | null;
  optionColors: Record<string, string> | null;
  position: number;
  createdAt: string;
  updatedAt: string;
};

// What the create form in CustomFieldEditorCore builds locally, before a
// scope-specific wrapper attaches the projectId/workspaceId it creates under.
export type CreateCustomFieldPayload = {
  name: string;
  type: CustomFieldType;
  required: boolean;
  defaultValue?: string;
  options?: string[];
  optionColors?: Record<string, string>;
};

// What the inline edit form in CustomFieldEditorCore sends for one field: only
// the properties the user changed (the API merges it over the stored
// definition). The type is immutable and never part of it. `defaultValue:
// null` clears the default; `options` is the full replacement list;
// `optionColors` is the full option value -> color map of a single-select
// dropdown (omitted keeps the stored colors of the surviving options).
export type UpdateCustomFieldPayload = {
  name?: string;
  required?: boolean;
  defaultValue?: string | null;
  options?: string[];
  optionColors?: Record<string, string>;
};
