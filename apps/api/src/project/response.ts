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
    estimateMinutes: z.number().int().min(0).nullable().openapi({
      description:
        "Effort estimate in whole minutes (a work day is 480 minutes); null when there is no estimate. Sizes the display-only bar of a task with no dates of its own and of a task with exactly one date.",
    }),
    estimateUnit: z.string().openapi({
      description: "How the estimate is entered and shown: `hours` or `days`.",
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

export const portfolioDependencySchema = z
  .object({
    id: z
      .string()
      .openapi({ description: "The underlying task relation's id." }),
    sourceTaskId: z.string(),
    sourceProjectId: z.string(),
    targetTaskId: z.string(),
    targetProjectId: z.string(),
    dependencyType: z.string().openapi({
      description:
        "The scheduling dependency type (Finish-to-Start, Start-to-Start, " +
        "Finish-to-Finish, or Start-to-Finish), same meaning as on a project's " +
        "own task relations.",
    }),
    lagDays: z.number().openapi({
      description:
        "Lag (positive) or lead (negative) in days applied to the dependency.",
    }),
  })
  .openapi("PortfolioDependency");

export const portfolioSchema = z
  .object({
    projects: z.array(portfolioProjectSchema),
    dependencies: z.array(portfolioDependencySchema).openapi({
      description:
        "Cross-project scheduling dependencies -- `blocks` relations whose " +
        "source and target tasks sit in two different projects returned above " +
        "(e.g. a client approval gating a cutover in another project). Only " +
        "`blocks` relations carry portfolio-relevant scheduling semantics, so " +
        "same-project and non-blocking (`related`/`subtask`) relations are left " +
        "out; fetch a project's own Gantt for those. Lets the portfolio " +
        "timeline draw a line between the two projects' rows.",
    }),
    undatedSuccessorDependencies: z.array(portfolioDependencySchema).openapi({
      description:
        "`blocks` relations, same-project or cross-project, whose target task " +
        "has neither a start nor a due date, between two tasks of the projects " +
        "returned above. They let the client derive a display-only position " +
        "for such a task from its predecessors (nothing is stored). An edge " +
        "into a dated task is not included; a cross-project edge into an " +
        "undated task appears here and in `dependencies`.",
    }),
  })
  .openapi("Portfolio");

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
