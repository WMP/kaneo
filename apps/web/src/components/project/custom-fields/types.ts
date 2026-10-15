export type CustomFieldType =
  | "text"
  | "number"
  | "date"
  | "dropdown"
  | "boolean"
  | "multiselect";

export type CustomFieldDefinition = {
  id: string;
  projectId: string | null;
  // A workspace field is inherited by every project of the workspace; a
  // project can only hide it for itself. Absent on a plain project field.
  workspaceId?: string | null;
  scope?: "workspace" | "project";
  hideable?: boolean;
  hidden?: boolean;
  name: string;
  type: CustomFieldType;
  required: boolean;
  defaultValue: string | null;
  options: string[] | null;
  // Option value -> colour token of a single-select dropdown.
  optionColors?: Record<string, string> | null;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type FieldKind = Exclude<CustomFieldType, "multiselect">;
