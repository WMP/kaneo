import { z } from "../openapi";

export const projectIdParam = z.object({
  projectId: z.string(),
});

export const taskIdParam = z.object({
  taskId: z.string(),
});

export const customFieldIdParam = z.object({
  id: z.string(),
});

export const createCustomFieldBody = z.object({
  projectId: z.string(),
  name: z.string(),
  type: z.enum([
    "text",
    "number",
    "date",
    "dropdown",
    "boolean",
    "multiselect",
  ]),
  required: z.boolean().optional().default(false),
  defaultValue: z.string().optional(),
  options: z.array(z.string()).optional(),
  // Dropdown option value -> color token (see constants/label-colors.ts on
  // the web side). Only meaningful when type === "dropdown".
  optionColors: z.record(z.string(), z.string()).optional(),
});

export const updateCustomFieldBody = z.object({
  name: z.string().optional(),
  // null clears any stored colors; omitted leaves them unchanged.
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

export const setCustomFieldValueBody = z.object({
  taskId: z.string(),
  fieldId: z.string(),
  value: z.string(),
});
