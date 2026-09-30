import { z } from "../openapi";

export const workspaceIdParam = z.object({ workspaceId: z.string() });

export const workspaceColumnParam = z.object({
  workspaceId: z.string(),
  columnId: z.string(),
});

export const createWorkspaceColumnBody = z.object({
  name: z.string(),
  icon: z.string().optional(),
  color: z.string().optional(),
  isFinal: z.boolean().optional(),
});

export const updateWorkspaceColumnBody = z.object({
  name: z.string().min(1).optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  isFinal: z.boolean().optional(),
});

export const reorderWorkspaceColumnsBody = z.object({
  columns: z
    .array(z.object({ id: z.string(), position: z.number().int().min(0) }))
    .openapi({
      description:
        "Every column keeps its new position. Columns from another workspace are rejected with 404.",
    }),
});

export const deleteWorkspaceColumnQuery = z.object({
  moveTasksTo: z.string().optional().openapi({
    description:
      "Workspace column that receives the tasks of the deleted column in every project. Needed when the workspace enforces its columns and a task exists in the column.",
  }),
});

export const enforcementPreviewQuery = z.object({
  fallbackColumnId: z.string().optional().openapi({
    description:
      "Workspace column that receives the tasks of project columns without a match. Defaults to the first workspace column by position.",
  }),
});

export const setEnforcementBody = z.object({
  enforced: z.boolean(),
  fallbackColumnId: z.string().optional().openapi({
    description:
      "Only used when turning enforcement on. Defaults to the first workspace column by position.",
  }),
});
