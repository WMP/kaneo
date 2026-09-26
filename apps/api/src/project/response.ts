import { HTTPException } from "hono/http-exception";
import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { boardColumnSchema, boardTaskSchema } from "../task/response";

export const projectSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    backgroundVersion: z.string().nullable(),
    slug: z.string().openapi({
      description: "Short prefix used in task identifiers, e.g. KAN-12.",
    }),
    icon: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    createdAt: responseTimestamp,
    isPublic: z.boolean().nullable().openapi({
      description:
        "When true the project's board is readable without signing in, via /api/public-project/{id}.",
    }),
    archivedAt: nullableResponseTimestamp.openapi({
      description:
        "Non-null once archived; archived projects are hidden by default.",
    }),
    position: z.number().openapi({ description: "Sidebar order, ascending." }),
    lastTaskNumber: z.number().openapi({
      description:
        "Highest task number issued in this project; the next task gets this plus one.",
    }),
  })
  .openapi("Project");

export const projectStatisticsSchema = z
  .object({
    completionPercentage: z.number(),
    totalTasks: z.number(),
    dueDate: nullableResponseTimestamp.openapi({
      description: "The soonest due date among the project's open tasks.",
    }),
  })
  .openapi("ProjectStatistics");

export const projectListItemSchema = projectSchema
  .extend({
    statistics: projectStatisticsSchema,
    // Legacy, always empty. Fetch the board via GET /task/tasks/{id}.
    archivedTasks: z
      .array(boardTaskSchema)
      .openapi({ description: "Always empty." }),
    plannedTasks: z
      .array(boardTaskSchema)
      .openapi({ description: "Always empty." }),
    columns: z
      .array(boardColumnSchema)
      .openapi({ description: "Always empty." }),
  })
  .openapi("ProjectListItem");

export const projectListSchema = z.array(projectListItemSchema);

export const portfolioTaskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    startDate: nullableResponseTimestamp,
    dueDate: nullableResponseTimestamp,
    progress: z.number().int().min(0).max(100).openapi({
      description: "Percent complete, 0-100.",
    }),
    isMilestone: z.boolean().openapi({
      description:
        "Renders as a diamond marker on the timeline at its date instead of a spanning bar.",
    }),
    status: z.string().openapi({
      description: "The slug of the column the task sits in.",
    }),
  })
  .openapi("PortfolioTask");

export const portfolioProjectSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string(),
    slug: z.string(),
    icon: z.string().nullable(),
    tasks: z.array(portfolioTaskSchema).openapi({
      description:
        "This project's tasks with scheduling data, for a shared cross-project timeline. Archived tasks are excluded.",
    }),
  })
  .openapi("PortfolioProject");

export const portfolioSchema = z.array(portfolioProjectSchema);

export const projectBackgroundUploadSchema = z
  .object({
    key: z.string(),
    uploadUrl: z.string(),
    version: z.string(),
    headers: z.record(z.string(), z.string()),
  })
  .openapi("ProjectBackgroundUpload");

export const projectBackgroundFinalizeSchema = z
  .object({ url: z.string() })
  .openapi("ProjectBackgroundFinalize");
export const movedProjectSchema = projectSchema
  .extend({ unassignedTaskCount: z.number() })
  .openapi("MovedProject");

// Storage coordinates are private implementation details, even on mutations
// that return a full database row. Preserve each endpoint's other fields.
export function toPublicProject<
  T extends {
    backgroundObjectKey: string | null;
    backgroundMimeType: string | null;
  },
>(project: T | undefined) {
  if (!project)
    throw new HTTPException(500, {
      message: "Project mutation returned no result",
    });
  const {
    backgroundObjectKey: _key,
    backgroundMimeType: _mime,
    ...publicProject
  } = project;
  return publicProject;
}
