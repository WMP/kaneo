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
