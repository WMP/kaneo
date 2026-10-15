import { z } from "../openapi";

export const projectIdParam = z.object({
  projectId: z.string(),
});

export const workspaceIdParam = z.object({
  workspaceId: z.string(),
});

export const taskIdParam = z.object({
  taskId: z.string(),
});

export const customFieldIdParam = z.object({
  id: z.string(),
});

export const getCustomFieldsQuery = z.object({
  // "true" returns every inherited workspace field (hidden ones included,
  // with their real per-project hidden state) instead of the effective set
  // — for the project's field-visibility editor.
  includeHidden: z.enum(["true", "false"]).optional(),
});

const customFieldTypeSchema = z.enum([
  "text",
  "number",
  "date",
  "dropdown",
  "boolean",
  "multiselect",
]);

export const createCustomFieldBody = z.object({
  projectId: z.string(),
  name: z.string(),
  type: customFieldTypeSchema,
  required: z.boolean().optional().default(false),
  defaultValue: z.string().optional(),
  options: z.array(z.string()).optional(),
  // Dropdown option value -> color token (see constants/label-colors.ts on
  // the web side). Only meaningful when type === "dropdown".
  optionColors: z.record(z.string(), z.string()).optional(),
});

export const createWorkspaceCustomFieldBody = z.object({
  name: z.string(),
  type: customFieldTypeSchema,
  required: z.boolean().optional().default(false),
  defaultValue: z.string().optional(),
  options: z.array(z.string()).optional(),
  optionColors: z.record(z.string(), z.string()).optional(),
  // Omitted: appended after the workspace's current fields.
  position: z.number().optional(),
});

// Partial edit of a definition; the field type is immutable and cannot be
// sent. Omitted properties keep their stored value and the merged result is
// validated with the same rules as creating a field.
export const updateCustomFieldBody = z.object({
  name: z.string().optional().openapi({
    description: "New name for the field. Cannot be blank.",
  }),
  required: z.boolean().optional().openapi({
    description:
      "Whether every task must have a value. Turning it on needs a default; for a project field the default fills the tasks that have no value yet.",
  }),
  // null clears the default; omitted leaves it unchanged.
  defaultValue: z.string().nullable().optional().openapi({
    description:
      "Value new tasks start with. Send `null` or an empty string to clear it. Multiselect defaults are a JSON array of options.",
  }),
  // Full replacement list of options (dropdown and multiselect only);
  // omitted leaves the options unchanged.
  options: z.array(z.string()).optional().openapi({
    description:
      "The full option list for dropdown and multiselect fields, in display order. Adding and reordering options is always allowed. Removing an option that a task still uses is rejected with 409, so task values are never changed silently.",
  }),
  // null clears stored colors; omitted keeps the colors of the options that
  // remain.
  optionColors: z.record(z.string(), z.string()).nullable().optional(),
});

export const reorderCustomFieldsBody = z.object({
  fields: z.array(
    z.object({
      id: z.string(),
      position: z.number(),
    }),
  ),
});

export const reorderWorkspaceCustomFieldsBody = reorderCustomFieldsBody;

export const setCustomFieldValueBody = z.object({
  taskId: z.string(),
  fieldId: z.string(),
  value: z.string(),
});

export const setCustomFieldVisibilityBody = z.object({
  fieldId: z.string(),
  hidden: z.boolean(),
});
