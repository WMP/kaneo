import { responseTimestamp, z } from "../openapi";

export const customFieldDefinitionSchema = z
  .object({
    id: z.string(),
    // Set for a project-level definition; null for a workspace-level one
    // (see workspaceId below — exactly one of the two is set).
    projectId: z.string().nullable(),
    // Set for a workspace-level definition, inherited by every project in
    // the workspace; null for a project-level one.
    workspaceId: z.string().nullable(),
    // "workspace" mirrors workspaceId being set; "project" mirrors
    // projectId being set.
    scope: z.enum(["workspace", "project"]),
    // true only for a workspace field that isn't required — a project-level
    // field, or a required workspace field, can never be hidden.
    hideable: z.boolean(),
    // Whether the requesting project currently hides this field. Always
    // false for a project-level field, and false for a workspace field in
    // the effective list (a hidden one is dropped from that list entirely);
    // only the project's field-visibility listing (`includeHidden=true`)
    // reports true.
    hidden: z.boolean(),
    name: z.string(),
    type: z.string(),
    required: z.boolean(),
    defaultValue: z.string().nullable(),
    options: z.unknown().nullable(),
    optionColors: z.record(z.string(), z.string()).nullable(),
    position: z.number(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("CustomFieldDefinition");

export const customFieldDefinitionListSchema = z.array(
  customFieldDefinitionSchema,
);

export const customFieldValueSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    fieldId: z.string(),
    value: z.string().nullable(),
    fieldName: z.string(),
    fieldPosition: z.number(),
    fieldType: z.string(),
    fieldOptions: z.unknown().nullable(),
    fieldOptionColors: z.record(z.string(), z.string()).nullable(),
  })
  .openapi("CustomFieldValue");

export const customFieldValueListSchema = z.array(customFieldValueSchema);

export const customFieldFilterValuesSchema = z
  .object({
    fieldId: z.string(),
    fieldName: z.string(),
    fieldType: z.string(),
    values: z.array(z.string()),
  })
  .openapi("CustomFieldFilterValues");

export const customFieldFilterValuesListSchema = z.array(
  customFieldFilterValuesSchema,
);

export const setCustomFieldValueResponseSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    fieldId: z.string(),
    value: z.string().nullable(),
  })
  .openapi("SetCustomFieldValueResponse");

export const reorderCustomFieldsResponseSchema = z
  .unknown()
  .openapi("ReorderCustomFieldsResponse");
