import { responseTimestamp, z } from "../openapi";

export const workspaceColumnSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string(),
    slug: z.string().openapi({
      description:
        "Stable identifier derived from the name; tasks store it as their status once the column is copied into a project.",
    }),
    position: z.number().openapi({
      description: "Board order, ascending.",
    }),
    icon: z.string().nullable(),
    color: z.string().nullable(),
    isFinal: z.boolean(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("WorkspaceColumn");

export const workspaceColumnsSchema = z
  .object({
    enforced: z.boolean().openapi({
      description:
        "True when every project of the workspace has exactly these columns and cannot change them.",
    }),
    columns: z.array(workspaceColumnSchema),
  })
  .openapi("WorkspaceColumns");

const projectSyncEntrySchema = z
  .object({
    projectId: z.string(),
    projectName: z.string(),
    changed: z.boolean(),
    create: z.array(
      z.object({
        workspaceColumnId: z.string(),
        name: z.string(),
        slug: z.string(),
      }),
    ),
    remove: z.array(
      z.object({
        columnId: z.string(),
        name: z.string(),
        slug: z.string(),
        taskCount: z.number(),
        workflowRuleCount: z.number(),
      }),
    ),
    update: z.array(
      z.object({
        columnId: z.string(),
        workspaceColumnId: z.string(),
        name: z.string(),
        slug: z.string(),
        newName: z.string(),
        newSlug: z.string(),
        matchedBy: z.enum(["link", "slug", "name"]),
        taskCount: z.number(),
      }),
    ),
    tasksMoved: z.number(),
    workflowRulesDeleted: z.number(),
  })
  .openapi("WorkspaceColumnSyncProject");

const syncTotalsSchema = z.object({
  projects: z.number(),
  projectsChanged: z.number(),
  columnsCreated: z.number(),
  columnsRemoved: z.number(),
  columnsUpdated: z.number(),
  tasksMoved: z.number(),
  workflowRulesDeleted: z.number(),
});

export const enforcementPreviewSchema = z
  .object({
    fallbackColumnId: z.string(),
    projects: z.array(projectSyncEntrySchema),
    totals: syncTotalsSchema,
  })
  .openapi("WorkspaceColumnEnforcementPreview");

export const enforcementResultSchema = z
  .object({
    enforced: z.boolean(),
    fallbackColumnId: z.string().nullable(),
    projects: z.array(projectSyncEntrySchema),
    totals: syncTotalsSchema,
  })
  .openapi("WorkspaceColumnEnforcementResult");
