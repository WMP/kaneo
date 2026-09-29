import { and, eq, inArray } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import {
  PROJECT_ACCESS_DENIED_MESSAGE,
  type ProjectAccess,
  requireProjectAccessFor,
  resolveProjectAccesses,
} from "./project-access";
import { validateWorkspaceAccess } from "./validate-workspace-access";

type LookupResource =
  | "project"
  | "task"
  | "label"
  | "timeEntry"
  | "activity"
  | "comment"
  | "column"
  | "workflowRule"
  | "customField"
  | "resource";

type WorkspaceIdSource =
  | { type: "query"; key: string }
  | { type: "body"; key: string }
  | { type: "param"; key: string }
  | {
      type: "lookup";
      resource: LookupResource;
      idKey: string;
    }
  | {
      type: "lookupMany";
      resource: "task";
      idKey: string;
    };

// A resource's workspace and, when it belongs to a project, that project.
// Resources without a project (workspace labels, workspace custom fields,
// resources) leave `projectId` null and are gated by workspace membership.
type ResolvedScope = { workspaceId: string; projectId: string | null };

type WorkspaceAccessMiddlewareConfig = {
  sources: WorkspaceIdSource[];
};

async function readJsonObjectBody(
  c: Context,
): Promise<Record<string, unknown>> {
  const raw = (await c.req.json().catch(() => ({}))) || {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

// Workspace membership is checked by the caller first. On top of it, a request
// scoped to a project needs a project membership or full access. Sets
// `projectId` and `projectAccess` for a single project and `projectAccesses`
// for a bulk request.
export async function assertProjectAccess(
  c: Context,
  userId: string,
  scope: { projectId?: string | null; projectIds?: string[] | null },
): Promise<void> {
  if (scope.projectIds && scope.projectIds.length > 0) {
    const accesses = await resolveProjectAccesses(userId, scope.projectIds);
    if (!accesses) {
      throw new HTTPException(403, { message: PROJECT_ACCESS_DENIED_MESSAGE });
    }
    c.set("projectAccesses", accesses);
    return;
  }

  if (scope.projectId) {
    const access = await requireProjectAccessFor(userId, scope.projectId);
    c.set("projectId", scope.projectId);
    c.set("projectAccess", access);
  }
}

export function workspaceAccessMiddleware(
  config: WorkspaceAccessMiddlewareConfig,
) {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");

    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    let workspaceId: string | null = null;
    let projectId: string | null = null;
    let bulkProjectIds: string[] | null = null;

    for (const source of config.sources) {
      if (source.type === "query") {
        workspaceId = c.req.query(source.key) || null;
        projectId = null;
      } else if (source.type === "body") {
        const body = await readJsonObjectBody(c);
        const bodyValue = body[source.key];
        workspaceId = typeof bodyValue === "string" ? bodyValue : null;
        projectId = null;
      } else if (source.type === "param") {
        workspaceId = c.req.param(source.key) || null;
        projectId = null;
      } else if (source.type === "lookup") {
        const body = await readJsonObjectBody(c);
        const bodyId = body[source.idKey];
        const idFromBody = typeof bodyId === "string" ? bodyId : null;
        // Only accept the id from the same place the handler will read it
        // (path param or JSON body). Accepting it from the query string let a
        // caller authorize against one resource (`?taskId=<mine>`) while the
        // handler acted on another (`{"taskId": "<someone else's>"}`).
        const id = c.req.param(source.idKey) || idFromBody;
        if (id) {
          const scope = await lookupScope(source.resource, id);
          workspaceId = scope?.workspaceId ?? null;
          projectId = scope?.projectId ?? null;
        }
      } else if (source.type === "lookupMany") {
        const body = await readJsonObjectBody(c);
        const ids = body[source.idKey];
        if (Array.isArray(ids)) {
          const taskIds = ids.filter(
            (id): id is string => typeof id === "string",
          );
          if (taskIds.length > 0) {
            const tasks = await db
              .select({
                workspaceId: schema.projectTable.workspaceId,
                projectId: schema.taskTable.projectId,
              })
              .from(schema.taskTable)
              .innerJoin(
                schema.projectTable,
                eq(schema.taskTable.projectId, schema.projectTable.id),
              )
              .where(inArray(schema.taskTable.id, taskIds));
            const workspaceIds = [
              ...new Set(tasks.map((task) => task.workspaceId)),
            ];
            if (workspaceIds.length === 0) {
              throw new HTTPException(404, { message: "No tasks found" });
            }
            if (workspaceIds.length > 1) {
              throw new HTTPException(400, {
                message: "All tasks must belong to the same workspace",
              });
            }
            workspaceId = workspaceIds[0] ?? null;
            bulkProjectIds = [...new Set(tasks.map((task) => task.projectId))];
          }
        }
      }

      if (workspaceId) {
        break;
      }
    }

    if (!workspaceId) {
      throw new HTTPException(400, {
        message: "Workspace ID could not be determined",
      });
    }

    const apiKey = c.get("apiKey");
    const apiKeyId = apiKey?.id;

    await validateWorkspaceAccess(userId, workspaceId, apiKeyId);

    // Workspace membership alone does not open a project: the user needs a
    // project membership or full access (see `project-access.ts`). The query
    // fallback (`?workspaceId=`) resolves no project and stays workspace-scoped.
    await assertProjectAccess(c, userId, {
      projectId,
      projectIds: bulkProjectIds,
    });

    c.set("workspaceId", workspaceId);

    return next();
  };
}

export async function lookupScope(
  resource: LookupResource,
  id: string,
): Promise<ResolvedScope | null> {
  try {
    switch (resource) {
      case "project": {
        const [project] = await db
          .select({ workspaceId: schema.projectTable.workspaceId })
          .from(schema.projectTable)
          .where(eq(schema.projectTable.id, id))
          .limit(1);
        return project
          ? { workspaceId: project.workspaceId, projectId: id }
          : null;
      }

      case "task": {
        const [task] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.taskTable.projectId,
          })
          .from(schema.taskTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.taskTable.id, id))
          .limit(1);
        return task
          ? { workspaceId: task.workspaceId, projectId: task.projectId }
          : null;
      }

      case "label": {
        const [label] = await db
          .select({
            workspaceId: schema.labelTable.workspaceId,
            taskId: schema.labelTable.taskId,
            taskProjectId: schema.taskTable.projectId,
            taskWorkspaceId: schema.projectTable.workspaceId,
          })
          .from(schema.labelTable)
          .leftJoin(
            schema.taskTable,
            eq(schema.labelTable.taskId, schema.taskTable.id),
          )
          .leftJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.labelTable.id, id))
          .limit(1);
        if (!label?.workspaceId) return null;
        // Older releases allowed inconsistent label/task references. Never use
        // such a row to authorize reads, mutations or external provider sync.
        if (label.taskId && label.taskWorkspaceId !== label.workspaceId) {
          return null;
        }
        // A label attached to a task belongs to that task's project; a
        // workspace label has no project.
        return {
          workspaceId: label.workspaceId,
          projectId: label.taskId ? label.taskProjectId : null,
        };
      }

      case "timeEntry": {
        const [timeEntry] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.taskTable.projectId,
          })
          .from(schema.timeEntryTable)
          .innerJoin(
            schema.taskTable,
            eq(schema.timeEntryTable.taskId, schema.taskTable.id),
          )
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.timeEntryTable.id, id))
          .limit(1);
        return timeEntry
          ? {
              workspaceId: timeEntry.workspaceId,
              projectId: timeEntry.projectId,
            }
          : null;
      }

      case "activity": {
        const [activity] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.taskTable.projectId,
          })
          .from(schema.activityTable)
          .innerJoin(
            schema.taskTable,
            eq(schema.activityTable.taskId, schema.taskTable.id),
          )
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.activityTable.id, id))
          .limit(1);
        return activity
          ? { workspaceId: activity.workspaceId, projectId: activity.projectId }
          : null;
      }

      case "comment": {
        const [comment] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.taskTable.projectId,
          })
          .from(schema.activityTable)
          .innerJoin(
            schema.taskTable,
            eq(schema.activityTable.taskId, schema.taskTable.id),
          )
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(
            and(
              eq(schema.activityTable.id, id),
              eq(schema.activityTable.type, "comment"),
            ),
          )
          .limit(1);
        return comment
          ? { workspaceId: comment.workspaceId, projectId: comment.projectId }
          : null;
      }

      case "column": {
        const [column] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.columnTable.projectId,
          })
          .from(schema.columnTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.columnTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.columnTable.id, id))
          .limit(1);
        return column
          ? { workspaceId: column.workspaceId, projectId: column.projectId }
          : null;
      }

      case "workflowRule": {
        const [workflowRule] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.workflowRuleTable.projectId,
          })
          .from(schema.workflowRuleTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.workflowRuleTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.workflowRuleTable.id, id))
          .limit(1);
        return workflowRule
          ? {
              workspaceId: workflowRule.workspaceId,
              projectId: workflowRule.projectId,
            }
          : null;
      }

      case "customField": {
        // A custom field is either workspace-level (its workspaceId is set
        // directly, no project) or project-level (resolved through its
        // project) — never both, so only one of the two lookups below is
        // needed.
        const [field] = await db
          .select({
            projectId: schema.customFieldDefinitionTable.projectId,
            workspaceId: schema.customFieldDefinitionTable.workspaceId,
          })
          .from(schema.customFieldDefinitionTable)
          .where(eq(schema.customFieldDefinitionTable.id, id))
          .limit(1);

        if (!field) return null;
        if (field.workspaceId) {
          return { workspaceId: field.workspaceId, projectId: null };
        }
        if (!field.projectId) return null;

        const [project] = await db
          .select({ workspaceId: schema.projectTable.workspaceId })
          .from(schema.projectTable)
          .where(eq(schema.projectTable.id, field.projectId))
          .limit(1);
        return project
          ? { workspaceId: project.workspaceId, projectId: field.projectId }
          : null;
      }

      case "resource": {
        const [resource] = await db
          .select({ workspaceId: schema.resourceTable.workspaceId })
          .from(schema.resourceTable)
          .where(eq(schema.resourceTable.id, id))
          .limit(1);
        return resource
          ? { workspaceId: resource.workspaceId, projectId: null }
          : null;
      }

      default:
        return null;
    }
  } catch (error) {
    console.error(`Error looking up workspaceId for ${resource}:`, error);
    return null;
  }
}

// For routes authorized by a workspace id from the body that ALSO act on a task
// named in the body (creating a label on a task). Run it after
// `workspaceAccess.fromBody()`: it applies the project gate for that task. A
// task that does not exist, or lives in another workspace, is left to the
// handler's own 404.
export function projectFromBodyTask(key = "taskId") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    const workspaceId = c.get("workspaceId");
    const body = await readJsonObjectBody(c);
    const taskId = body[key];
    if (userId && workspaceId && typeof taskId === "string" && taskId) {
      const scope = await lookupScope("task", taskId);
      if (scope && scope.workspaceId === workspaceId) {
        // Keep the project the route already resolved (for example the
        // label's own task): the permission must then hold in both.
        const previous = c.get("projectAccess") as ProjectAccess | undefined;
        await assertProjectAccess(c, userId, { projectId: scope.projectId });
        const current = c.get("projectAccess") as ProjectAccess | undefined;
        if (previous && current && previous.projectId !== current.projectId) {
          c.set("projectAccesses", [previous, current]);
        }
      }
    }
    return next();
  };
}

export const workspaceAccess = {
  fromQuery: (key = "workspaceId") =>
    workspaceAccessMiddleware({ sources: [{ type: "query", key }] }),

  fromBody: (key = "workspaceId") =>
    workspaceAccessMiddleware({ sources: [{ type: "body", key }] }),

  fromParam: (key = "workspaceId") =>
    workspaceAccessMiddleware({ sources: [{ type: "param", key }] }),

  fromProject: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "project", idKey }],
    }),

  fromTask: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "task", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromTaskId: (idKey = "taskId") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "task", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromTasks: (idKey = "taskIds") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookupMany", resource: "task", idKey }],
    }),

  fromLabel: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "label", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromTimeEntry: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "timeEntry", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromActivity: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "activity", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromComment: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "comment", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromColumn: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "column", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromWorkflowRule: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "workflowRule", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromCustomField: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "customField", idKey }],
    }),

  fromResource: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "resource", idKey }],
    }),

  fromProjectId: (idKey = "projectId") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "project", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),
};
