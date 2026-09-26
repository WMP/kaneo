import { z } from "zod";
import { VALID_TASK_CONSTRAINT_TYPES } from "../task/schema";
import { dependencyTypeSchema, lagDaysSchema } from "../task-relation/schema";

type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** Minimal tool-registration contract shared by legacy and modern MCP servers. */
export type McpToolRegistrar = {
  registerTool(
    name: string,
    config: {
      description: string;
      inputSchema: z.ZodObject;
    },
    callback: (args: unknown) => Promise<McpToolResult>,
  ): unknown;
};

type ShapeToolServer = {
  registerTool(
    name: string,
    config: { description: string; inputSchema: z.ZodRawShape },
    callback: (args: unknown) => Promise<McpToolResult>,
  ): unknown;
};

export function toMcpToolRegistrar(server: ShapeToolServer): McpToolRegistrar {
  return {
    registerTool: (name, config, callback) =>
      server.registerTool(
        name,
        {
          description: config.description,
          inputSchema: config.inputSchema.shape,
        },
        (args) => callback(args),
      ),
  };
}

class ApiClient {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  async json<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    if (init?.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!res.ok) {
      const detail =
        typeof body === "object" && body !== null && "message" in body
          ? (body as { message: string }).message
          : typeof body === "string" && body.length > 0
            ? body.slice(0, 500)
            : `HTTP ${res.status}`;
      throw new Error(`${path}: ${detail}`);
    }
    return body as T;
  }
}

function textResult(data: unknown, isError = false): McpToolResult {
  const text =
    typeof data === "string" ? data : (JSON.stringify(data, null, 2) ?? "");
  return { content: [{ type: "text", text }], isError };
}

function errorResult(message: string): McpToolResult {
  return textResult({ error: message }, true);
}

function run(fn: () => Promise<unknown>): Promise<McpToolResult> {
  return fn()
    .then((data) => textResult(data))
    .catch((e: unknown) =>
      errorResult(e instanceof Error ? e.message : String(e)),
    );
}

/** A task's custom field value, alongside its field's name and type. */
type TaskCustomFieldValue = {
  fieldId: string;
  name: string;
  type: string;
  value: string | null;
};

// The custom-field endpoints return CustomFieldValue rows (id, taskId,
// fieldId, value, fieldName, fieldPosition, fieldType, fieldOptions); tasks
// only need the fieldId/name/type/value an agent reads and writes with.
function toTaskCustomFieldValue(raw: unknown): TaskCustomFieldValue {
  const row = raw as Record<string, unknown>;
  return {
    fieldId: String(row.fieldId),
    name: typeof row.fieldName === "string" ? row.fieldName : "",
    type: typeof row.fieldType === "string" ? row.fieldType : "",
    value: typeof row.value === "string" ? row.value : null,
  };
}

/**
 * Groups a project's bulk custom-field-value rows by taskId, so `list_tasks`
 * can attach every task's values from the single bulk fetch instead of
 * issuing one custom-field request per task.
 */
function groupCustomFieldValuesByTask(
  raw: unknown,
): Map<string, TaskCustomFieldValue[]> {
  const byTask = new Map<string, TaskCustomFieldValue[]>();
  if (!Array.isArray(raw)) return byTask;
  for (const entry of raw) {
    const row = entry as Record<string, unknown>;
    const taskId = typeof row.taskId === "string" ? row.taskId : undefined;
    if (!taskId) continue;
    const values = byTask.get(taskId) ?? [];
    values.push(toTaskCustomFieldValue(row));
    byTask.set(taskId, values);
  }
  return byTask;
}

function withCustomFields<T extends Record<string, unknown>>(
  task: T,
  customFields: TaskCustomFieldValue[],
): T & { customFields: TaskCustomFieldValue[] } {
  return { ...task, customFields };
}

/** Attaches each task's custom-field values onto every task in a board response. */
function attachCustomFieldsToBoard(
  board: unknown,
  byTask: Map<string, TaskCustomFieldValue[]>,
): unknown {
  const data = (board as { data?: Record<string, unknown> } | null)?.data;
  if (!data) return board;

  const withTasks = (tasks: unknown) =>
    Array.isArray(tasks)
      ? tasks.map((task) => {
          const t = task as Record<string, unknown>;
          const id = typeof t.id === "string" ? t.id : undefined;
          return withCustomFields(t, id ? (byTask.get(id) ?? []) : []);
        })
      : tasks;

  const columns = Array.isArray(data.columns)
    ? data.columns.map((column) => {
        const col = column as Record<string, unknown>;
        return { ...col, tasks: withTasks(col.tasks) };
      })
    : data.columns;

  return {
    ...(board as Record<string, unknown>),
    data: {
      ...data,
      columns,
      archivedTasks: withTasks(data.archivedTasks),
      plannedTasks: withTasks(data.plannedTasks),
    },
  };
}

const PRIORITIES = ["no-priority", "low", "medium", "high", "urgent"] as const;

function isTaskPriority(v: string): v is (typeof PRIORITIES)[number] {
  return (PRIORITIES as readonly string[]).includes(v);
}

function formatOptionalIso(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return undefined;
}

function buildFullTaskUpdateBody(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, string | number | boolean | null | undefined> {
  const positionRaw = patch.position ?? existing.position;
  const position =
    typeof positionRaw === "number"
      ? positionRaw
      : typeof positionRaw === "string"
        ? Number(positionRaw)
        : Number.NaN;
  if (!Number.isFinite(position))
    throw new Error(
      "Cannot update task: missing numeric `position` on existing task.",
    );

  const title =
    (patch.title as string) ??
    (typeof existing.title === "string" ? existing.title : undefined);
  if (!title) throw new Error("Cannot update task: missing title.");

  const description =
    patch.description !== undefined
      ? patch.description === null
        ? ""
        : String(patch.description)
      : existing.description == null
        ? ""
        : String(existing.description);

  const status =
    (patch.status as string) ??
    (typeof existing.status === "string" ? existing.status : undefined);
  if (!status) throw new Error("Cannot update task: missing status.");

  const priorityRaw =
    (patch.priority as string) ??
    (typeof existing.priority === "string" ? existing.priority : undefined);
  if (!priorityRaw || !isTaskPriority(priorityRaw))
    throw new Error("Cannot update task: invalid or missing priority.");

  const projectId =
    (patch.projectId as string) ??
    (typeof existing.projectId === "string" ? existing.projectId : undefined);
  if (!projectId) throw new Error("Cannot update task: missing projectId.");

  const userId =
    patch.userId !== undefined
      ? patch.userId === null
        ? ""
        : (patch.userId as string)
      : typeof existing.userId === "string"
        ? existing.userId
        : undefined;

  const startDate = formatOptionalIso(
    patch.startDate !== undefined ? patch.startDate : existing.startDate,
  );
  const dueDate = formatOptionalIso(
    patch.dueDate !== undefined ? patch.dueDate : existing.dueDate,
  );

  const body: Record<string, string | number | boolean | null | undefined> = {
    title,
    description,
    status,
    priority: priorityRaw,
    projectId,
    position,
  };
  if (startDate !== undefined) body.startDate = startDate;
  if (dueDate !== undefined) body.dueDate = dueDate;
  if (userId !== undefined) body.userId = userId;
  // Left untouched when omitted, same as the API's PUT /api/task/:id
  // contract: an older caller that never mentions these fields must not
  // silently reset them.
  if (patch.progress !== undefined) body.progress = patch.progress as number;
  if (patch.isMilestone !== undefined)
    body.isMilestone = patch.isMilestone as boolean;
  // constraintType is what opts the request into touching either
  // constraint field at all; passing constraintDate alone leaves both
  // untouched (mirrors updateTaskBody's refine in apps/api/src/task/schema.ts).
  if (patch.constraintType !== undefined) {
    body.constraintType = patch.constraintType as string;
    body.constraintDate = (patch.constraintDate as string | null) ?? null;
  }
  return body;
}

const prioritySchema = z.enum([
  "no-priority",
  "low",
  "medium",
  "high",
  "urgent",
]);
const nonEmptyString = z.string().trim().min(1);
const optionalNonEmptyString = nonEmptyString.optional();
const nullableOptionalNonEmptyString = nonEmptyString.nullable().optional();
const isoDateTimeSchema = z.string().datetime({ offset: true });
const optionalIsoDateTimeSchema = isoDateTimeSchema.optional();
const nullableOptionalIsoDateTimeSchema = isoDateTimeSchema
  .nullable()
  .optional();
const hexColorSchema = z
  .string()
  .regex(
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
    "Expected a hex color like #FF6600",
  );
const progressSchema = z.number().int().min(0).max(100);
// Reuse the canonical constraint-type vocabulary and the dependency-type/lag
// validators so this tool catalog can never drift from the API's own request
// validation.
const constraintTypeSchema = z.enum(VALID_TASK_CONSTRAINT_TYPES);

/** Register Kaneo's authenticated tool catalog on an MCP server adapter. */
export function registerMcpTools(
  server: McpToolRegistrar,
  baseUrl: string,
  token: string,
): void {
  const client = new ApiClient(baseUrl, token);
  const registerTool = <InputSchema extends z.ZodObject>(
    name: string,
    config: { description: string; inputSchema: InputSchema },
    callback: (args: z.output<InputSchema>) => Promise<McpToolResult>,
  ) =>
    server.registerTool(name, config, async (args) => {
      const parsed = config.inputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(z.prettifyError(parsed.error));
      }
      return callback(parsed.data);
    });

  registerTool(
    "whoami",
    {
      description: "Return the current Kaneo session and user.",
      inputSchema: z.object({}),
    },
    async () =>
      run(() => client.json("/api/auth/get-session", { method: "GET" })),
  );

  registerTool(
    "list_workspaces",
    {
      description: "List workspaces the signed-in user can access.",
      inputSchema: z.object({}),
    },
    async () =>
      run(() => client.json("/api/auth/organization/list", { method: "GET" })),
  );

  registerTool(
    "list_projects",
    {
      description: "List projects in a workspace.",
      inputSchema: z.object({
        workspaceId: nonEmptyString.describe("Workspace ID"),
        includeArchived: z
          .boolean()
          .optional()
          .describe("Include archived projects"),
      }),
    },
    async (args) => {
      const qs = new URLSearchParams({ workspaceId: args.workspaceId });
      if (args.includeArchived === true) qs.set("includeArchived", "true");
      return run(() =>
        client.json(`/api/project?${qs.toString()}`, { method: "GET" }),
      );
    },
  );

  registerTool(
    "get_project",
    {
      description: "Get a single project by ID.",
      inputSchema: z.object({ id: nonEmptyString }),
    },
    async (args) =>
      run(() => client.json(`/api/project/${encodeURIComponent(args.id)}`)),
  );

  registerTool(
    "create_project",
    {
      description: "Create a project in a workspace.",
      inputSchema: z.object({
        name: nonEmptyString,
        workspaceId: nonEmptyString,
        icon: nonEmptyString,
        slug: nonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json("/api/project", {
          method: "POST",
          body: JSON.stringify({
            name: args.name,
            workspaceId: args.workspaceId,
            icon: args.icon,
            slug: args.slug,
          }),
        }),
      ),
  );

  registerTool(
    "update_project",
    {
      description:
        "Update project metadata (PATCH-style: only provided fields are changed).",
      inputSchema: z.object({
        id: nonEmptyString,
        name: optionalNonEmptyString,
        icon: z.string().optional(),
        slug: optionalNonEmptyString,
        description: z.string().optional(),
        isPublic: z.boolean().optional(),
      }),
    },
    async (args) => {
      const { id, ...patch } = args;
      return run(async () => {
        const existing = (await client.json(
          `/api/project/${encodeURIComponent(id)}`,
          { method: "GET" },
        )) as Record<string, unknown>;
        const name =
          patch.name ??
          (typeof existing.name === "string" ? existing.name : "");
        if (!name) throw new Error("Cannot update project: missing name.");
        const icon =
          patch.icon !== undefined
            ? patch.icon
            : typeof existing.icon === "string"
              ? existing.icon
              : "Layout";
        const slug =
          patch.slug ??
          (typeof existing.slug === "string" ? existing.slug : "");
        if (!slug) throw new Error("Cannot update project: missing slug.");
        const description =
          patch.description !== undefined
            ? patch.description
            : typeof existing.description === "string"
              ? existing.description
              : "";
        const isPublic =
          patch.isPublic !== undefined
            ? patch.isPublic
            : typeof existing.isPublic === "boolean"
              ? existing.isPublic
              : false;
        return client.json(`/api/project/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({ name, icon, slug, description, isPublic }),
        });
      });
    },
  );

  registerTool(
    "list_tasks",
    {
      description:
        "List a bounded page of tasks for a project (50 by default, maximum 100). Use pagination.totalPages and page to retrieve the rest; filters and sorting apply before pagination. For every task page, also follow relatedPage through pagination.relatedTotalPages for complete labels, links and column metadata.",
      inputSchema: z.object({
        projectId: nonEmptyString,
        status: optionalNonEmptyString,
        priority: prioritySchema.optional(),
        assigneeId: optionalNonEmptyString,
        page: z.number().int().min(1).max(1_000_000).optional(),
        relatedPage: z.number().int().min(1).max(1_000_000).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        sortBy: z
          .enum([
            "createdAt",
            "priority",
            "dueDate",
            "position",
            "title",
            "number",
          ])
          .optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        dueBefore: optionalIsoDateTimeSchema,
        dueAfter: optionalIsoDateTimeSchema,
      }),
    },
    async (args) => {
      const { projectId, ...rest } = args;
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined && v !== null) qs.set(k, String(v));
      }
      const q = qs.toString();
      return run(async () => {
        // One bulk query for the whole project's custom-field values, grouped
        // by taskId below, instead of a request per task on the page. It runs
        // in parallel with the board fetch, and a failure there (e.g. a role
        // without task:read, or a transient error) degrades to no custom
        // fields rather than failing the whole board read.
        const [board, values] = await Promise.all([
          client.json(
            `/api/task/tasks/${encodeURIComponent(projectId)}${q ? `?${q}` : ""}`,
            { method: "GET" },
          ),
          client
            .json(
              `/api/custom-field/project/${encodeURIComponent(projectId)}/values`,
              { method: "GET" },
            )
            .catch(() => []),
        ]);
        return attachCustomFieldsToBoard(
          board,
          groupCustomFieldValuesByTask(values),
        );
      });
    },
  );

  registerTool(
    "get_task",
    {
      description: "Get a task by ID.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(async () => {
        // Fetch the task and its custom-field values in parallel. A failure of
        // the custom-field request (e.g. a role without task:read, or a
        // transient error) degrades to no custom fields rather than failing the
        // whole task read.
        const [task, values] = await Promise.all([
          client.json(`/api/task/${encodeURIComponent(args.taskId)}`, {
            method: "GET",
          }) as Promise<Record<string, unknown>>,
          client
            .json(`/api/custom-field/task/${encodeURIComponent(args.taskId)}`, {
              method: "GET",
            })
            .catch(() => []),
        ]);
        return withCustomFields(
          task,
          Array.isArray(values) ? values.map(toTaskCustomFieldValue) : [],
        );
      }),
  );

  registerTool(
    "create_task",
    {
      description: "Create a task in a project.",
      inputSchema: z
        .object({
          projectId: nonEmptyString,
          title: nonEmptyString,
          description: z.string(),
          priority: prioritySchema,
          status: nonEmptyString,
          startDate: optionalIsoDateTimeSchema,
          dueDate: optionalIsoDateTimeSchema,
          userId: optionalNonEmptyString,
          progress: progressSchema
            .optional()
            .describe("Percent complete, 0-100. Defaults to 0."),
          isMilestone: z.boolean().optional().describe("Defaults to false."),
        })
        .strict(),
    },
    async (args) => {
      const body: Record<string, string | number | boolean | undefined> = {
        title: args.title,
        description: args.description,
        priority: args.priority,
        status: args.status,
      };
      if (args.startDate !== undefined) body.startDate = args.startDate;
      if (args.dueDate !== undefined) body.dueDate = args.dueDate;
      if (args.userId !== undefined) body.userId = args.userId;
      if (args.progress !== undefined) body.progress = args.progress;
      if (args.isMilestone !== undefined) body.isMilestone = args.isMilestone;
      return run(() =>
        client.json(`/api/task/${encodeURIComponent(args.projectId)}`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    },
  );

  registerTool(
    "duplicate_task",
    {
      description:
        "Duplicate a task in the same project, copying its fields and labels. Pass title to rename the copy.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        title: optionalNonEmptyString,
      }),
    },
    async (args) => {
      const body: Record<string, string> = {};
      if (args.title !== undefined) body.title = args.title;
      return run(() =>
        client.json(`/api/task/duplicate/${encodeURIComponent(args.taskId)}`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    },
  );

  registerTool(
    "update_task",
    {
      description:
        "Update a task (fetches current task, merges fields, then full update). Fields omitted here are left untouched, including progress, isMilestone, and constraintType/constraintDate. Passing constraintType is what opts the request into changing the constraint at all: pass constraintDate alone and it is ignored.",
      inputSchema: z
        .object({
          taskId: nonEmptyString,
          title: optionalNonEmptyString,
          description: z.string().nullable().optional(),
          status: optionalNonEmptyString,
          priority: prioritySchema.optional(),
          projectId: optionalNonEmptyString,
          position: z.number().optional(),
          startDate: nullableOptionalIsoDateTimeSchema,
          dueDate: nullableOptionalIsoDateTimeSchema,
          userId: nullableOptionalNonEmptyString,
          progress: progressSchema.optional(),
          isMilestone: z.boolean().optional(),
          constraintType: constraintTypeSchema
            .optional()
            .describe(
              "One of: none, start_no_earlier_than, finish_no_later_than, must_start_on.",
            ),
          constraintDate: z
            .string()
            .nullable()
            .optional()
            .describe(
              'Required when constraintType is set to anything other than "none" (enforced by the API).',
            ),
        })
        .strict(),
    },
    async (args) => {
      const { taskId, ...patch } = args;
      return run(async () => {
        const existing = (await client.json(
          `/api/task/${encodeURIComponent(taskId)}`,
          { method: "GET" },
        )) as Record<string, unknown>;
        const body = buildFullTaskUpdateBody(existing, patch);
        return client.json(`/api/task/${encodeURIComponent(taskId)}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      });
    },
  );

  registerTool(
    "move_task",
    {
      description:
        "Move a task to another project (and optional column status).",
      inputSchema: z.object({
        taskId: nonEmptyString,
        destinationProjectId: nonEmptyString,
        destinationStatus: optionalNonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task/move/${encodeURIComponent(args.taskId)}`, {
          method: "PUT",
          body: JSON.stringify({
            destinationProjectId: args.destinationProjectId,
            ...(args.destinationStatus !== undefined
              ? { destinationStatus: args.destinationStatus }
              : {}),
          }),
        }),
      ),
  );

  registerTool(
    "update_task_status",
    {
      description: "Update only the status (column) of a task.",
      inputSchema: z.object({ taskId: nonEmptyString, status: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task/status/${encodeURIComponent(args.taskId)}`, {
          method: "PUT",
          body: JSON.stringify({ status: args.status }),
        }),
      ),
  );

  registerTool(
    "list_task_comments",
    {
      description: "List comments on a task.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/comment/${encodeURIComponent(args.taskId)}`, {
          method: "GET",
        }),
      ),
  );

  registerTool(
    "create_task_comment",
    {
      description: "Add a comment to a task.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        content: nonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/comment/${encodeURIComponent(args.taskId)}`, {
          method: "POST",
          body: JSON.stringify({ content: args.content }),
        }),
      ),
  );

  registerTool(
    "update_task_comment",
    {
      description: "Update one of your comments on a task.",
      inputSchema: z.object({
        commentId: nonEmptyString,
        content: nonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/comment/${encodeURIComponent(args.commentId)}`, {
          method: "PUT",
          body: JSON.stringify({ content: args.content }),
        }),
      ),
  );

  registerTool(
    "delete_task_comment",
    {
      description: "Delete one of your comments from a task.",
      inputSchema: z.object({ commentId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/comment/${encodeURIComponent(args.commentId)}`, {
          method: "DELETE",
        }),
      ),
  );

  registerTool(
    "list_workspace_labels",
    {
      description: "List labels defined in a workspace.",
      inputSchema: z.object({ workspaceId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/label/workspace/${encodeURIComponent(args.workspaceId)}`,
          { method: "GET" },
        ),
      ),
  );

  registerTool(
    "create_label",
    {
      description:
        "Create a label in a workspace (optionally attach to a task).",
      inputSchema: z.object({
        name: nonEmptyString,
        color: hexColorSchema,
        workspaceId: nonEmptyString,
        taskId: optionalNonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json("/api/label", {
          method: "POST",
          body: JSON.stringify({
            name: args.name,
            color: args.color,
            workspaceId: args.workspaceId,
            ...(args.taskId !== undefined ? { taskId: args.taskId } : {}),
          }),
        }),
      ),
  );

  registerTool(
    "attach_label_to_task",
    {
      description: "Attach an existing label to a task.",
      inputSchema: z.object({
        labelId: nonEmptyString,
        taskId: nonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/label/${encodeURIComponent(args.labelId)}/task`, {
          method: "PUT",
          body: JSON.stringify({ taskId: args.taskId }),
        }),
      ),
  );

  registerTool(
    "detach_label_from_task",
    {
      description: "Detach a label from its current task.",
      inputSchema: z.object({ labelId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/label/${encodeURIComponent(args.labelId)}/task`, {
          method: "DELETE",
        }),
      ),
  );

  registerTool(
    "create_task_relation",
    {
      description:
        "Create a relation between two tasks. relationType: 'subtask' (sourceTaskId is the parent, targetTaskId the child), 'blocks' (sourceTaskId blocks targetTaskId), or 'related' (bidirectional). dependencyType/lagDays are only meaningful for 'blocks' (a 'related'/'subtask' relation is stored with fs/0 regardless of what is sent).",
      inputSchema: z
        .object({
          sourceTaskId: nonEmptyString,
          targetTaskId: nonEmptyString,
          relationType: z.enum(["subtask", "blocks", "related"]),
          dependencyType: dependencyTypeSchema
            .optional()
            .describe(
              "Finish-to-Start/Start-to-Start/Finish-to-Finish/Start-to-Finish. Defaults to fs.",
            ),
          lagDays: lagDaysSchema
            .optional()
            .describe(
              "Lag (positive) or lead (negative) in days. Defaults to 0.",
            ),
        })
        .strict(),
    },
    async (args) =>
      run(() =>
        client.json("/api/task-relation", {
          method: "POST",
          body: JSON.stringify({
            sourceTaskId: args.sourceTaskId,
            targetTaskId: args.targetTaskId,
            relationType: args.relationType,
            ...(args.dependencyType !== undefined
              ? { dependencyType: args.dependencyType }
              : {}),
            ...(args.lagDays !== undefined ? { lagDays: args.lagDays } : {}),
          }),
        }),
      ),
  );

  registerTool(
    "get_task_relations",
    {
      description:
        "List all relations (subtask/blocks/related) involving a task.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task-relation/${encodeURIComponent(args.taskId)}`, {
          method: "GET",
        }),
      ),
  );

  registerTool(
    "update_task_relation",
    {
      description:
        "Change a 'blocks' relation's dependency type and/or lag. Rejected for a 'related'/'subtask' relation, which has no dependency type/lag to edit.",
      inputSchema: z
        .object({
          id: nonEmptyString,
          dependencyType: dependencyTypeSchema.optional(),
          lagDays: lagDaysSchema.optional(),
        })
        .strict(),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task-relation/${encodeURIComponent(args.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...(args.dependencyType !== undefined
              ? { dependencyType: args.dependencyType }
              : {}),
            ...(args.lagDays !== undefined ? { lagDays: args.lagDays } : {}),
          }),
        }),
      ),
  );

  registerTool(
    "delete_task_relation",
    {
      description: "Delete a task relation by its relation ID.",
      inputSchema: z.object({ id: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task-relation/${encodeURIComponent(args.id)}`, {
          method: "DELETE",
        }),
      ),
  );

  registerTool(
    "delete_label",
    {
      description:
        "Delete a label by ID. Only task-associated labels can be deleted; workspace-level labels (taskId null) are rejected by the API.",
      inputSchema: z.object({ id: nonEmptyString }),
    },
    async (args) =>
      run(async () => {
        const label = (await client.json(
          `/api/label/${encodeURIComponent(args.id)}`,
          { method: "GET" },
        )) as { taskId?: string | null };
        if (!label?.taskId) {
          throw new Error(
            "Label is not associated with a task and cannot be deleted (workspace-level labels are not deletable via this endpoint).",
          );
        }
        return client.json(`/api/label/${encodeURIComponent(args.id)}`, {
          method: "DELETE",
        });
      }),
  );

  registerTool(
    "list_workspace_members",
    {
      description:
        "List the members of a workspace. Use this to resolve the user ID an assignee tool expects.",
      inputSchema: z.object({ workspaceId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/workspace/${encodeURIComponent(args.workspaceId)}/members`,
        ),
      ),
  );

  registerTool(
    "search",
    {
      description:
        "Search across tasks, projects, workspaces, comments, and activities.",
      inputSchema: z.object({
        q: nonEmptyString.describe("Search query"),
        type: z
          .enum([
            "all",
            "tasks",
            "projects",
            "workspaces",
            "comments",
            "activities",
          ])
          .optional()
          .describe("Restrict results to one kind. Defaults to all."),
        workspaceId: optionalNonEmptyString.describe("Limit to one workspace"),
        projectId: optionalNonEmptyString.describe("Limit to one project"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum results, 1 to 50. Defaults to 20."),
      }),
    },
    async (args) => {
      const qs = new URLSearchParams({ q: args.q });
      if (args.type) qs.set("type", args.type);
      if (args.workspaceId) qs.set("workspaceId", args.workspaceId);
      if (args.projectId) qs.set("projectId", args.projectId);
      if (args.limit !== undefined) qs.set("limit", String(args.limit));
      return run(() => client.json(`/api/search?${qs.toString()}`));
    },
  );

  registerTool(
    "list_project_columns",
    {
      description:
        "List a project's columns. Their slugs are the values update_task_status and create_task accept as a status.",
      inputSchema: z.object({ projectId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/column/${encodeURIComponent(args.projectId)}`),
      ),
  );

  registerTool(
    "delete_task",
    {
      description: "Delete a task by ID.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task/${encodeURIComponent(args.taskId)}`, {
          method: "DELETE",
        }),
      ),
  );

  registerTool(
    "update_task_assignee",
    {
      description:
        "Assign a task to a workspace member, or pass a null userId to unassign it.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        userId: nonEmptyString
          .nullable()
          .describe("Member user ID, or null to unassign"),
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task/assignee/${encodeURIComponent(args.taskId)}`, {
          method: "PUT",
          body: JSON.stringify({ userId: args.userId }),
        }),
      ),
  );

  registerTool(
    "update_task_due_date",
    {
      description: "Set a task's due date. Omit dueDate to clear it.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        dueDate: optionalIsoDateTimeSchema,
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task/due-date/${encodeURIComponent(args.taskId)}`, {
          method: "PUT",
          body: JSON.stringify(
            args.dueDate === undefined ? {} : { dueDate: args.dueDate },
          ),
        }),
      ),
  );

  registerTool(
    "set_task_baseline",
    {
      description:
        "Snapshot the task's current startDate/dueDate as its baseline, for plan-vs-actual comparison on the Gantt chart.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task/${encodeURIComponent(args.taskId)}/baseline`, {
          method: "POST",
        }),
      ),
  );

  registerTool(
    "clear_task_baseline",
    {
      description: "Remove the task's stored baseline dates, if any.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task/${encodeURIComponent(args.taskId)}/baseline`, {
          method: "DELETE",
        }),
      ),
  );

  registerTool(
    "list_task_time_entries",
    {
      description: "List the time entries logged against a task.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/time-entry/task/${encodeURIComponent(args.taskId)}`),
      ),
  );

  registerTool(
    "get_time_entry",
    {
      description: "Get a single time entry by ID.",
      inputSchema: z.object({ id: nonEmptyString }),
    },
    async (args) =>
      run(() => client.json(`/api/time-entry/${encodeURIComponent(args.id)}`)),
  );

  registerTool(
    "create_time_entry",
    {
      description:
        "Log time against a task. Omit endTime to leave the entry running.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        startTime: isoDateTimeSchema,
        endTime: optionalIsoDateTimeSchema,
        description: optionalNonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json("/api/time-entry", {
          method: "POST",
          body: JSON.stringify({
            taskId: args.taskId,
            startTime: args.startTime,
            ...(args.endTime ? { endTime: args.endTime } : {}),
            ...(args.description ? { description: args.description } : {}),
          }),
        }),
      ),
  );

  registerTool(
    "update_time_entry",
    {
      description:
        "Update a time entry. startTime is required; omitting endTime keeps the stored one. startTime cannot be later than the end time.",
      inputSchema: z.object({
        id: nonEmptyString,
        startTime: isoDateTimeSchema,
        endTime: optionalIsoDateTimeSchema,
        description: optionalNonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/time-entry/${encodeURIComponent(args.id)}`, {
          method: "PUT",
          body: JSON.stringify({
            startTime: args.startTime,
            ...(args.endTime ? { endTime: args.endTime } : {}),
            ...(args.description ? { description: args.description } : {}),
          }),
        }),
      ),
  );

  registerTool(
    "list_task_activity",
    {
      description: "List a task's activity history.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/activity/${encodeURIComponent(args.taskId)}`),
      ),
  );

  registerTool(
    "list_notifications",
    {
      description: "List the signed-in user's notifications.",
      inputSchema: z.object({}),
    },
    async () => run(() => client.json("/api/notification")),
  );

  registerTool(
    "get_workspace_calendar",
    {
      description:
        "Get the workspace's working-days bitmask and holidays, sorted by date.",
      inputSchema: z.object({ workspaceId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/calendar/${encodeURIComponent(args.workspaceId)}`, {
          method: "GET",
        }),
      ),
  );

  registerTool(
    "update_workspace_working_days",
    {
      description:
        "Set the workspace's working-weekday bitmask (bit i, i = 0..6, 0 = Sunday; 62 = Mon-Fri).",
      inputSchema: z
        .object({
          workspaceId: nonEmptyString,
          workingDays: z.number().int().min(0).max(127),
        })
        .strict(),
    },
    async (args) =>
      run(() =>
        client.json(`/api/calendar/${encodeURIComponent(args.workspaceId)}`, {
          method: "PUT",
          body: JSON.stringify({ workingDays: args.workingDays }),
        }),
      ),
  );

  registerTool(
    "add_workspace_holiday",
    {
      description:
        "Add a non-working date to the workspace calendar. The date is normalized to UTC midnight.",
      inputSchema: z
        .object({
          workspaceId: nonEmptyString,
          date: nonEmptyString.describe("ISO date (or date-time) string."),
          name: z.string().trim().min(1).max(120),
        })
        .strict(),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/calendar/${encodeURIComponent(args.workspaceId)}/holidays`,
          {
            method: "POST",
            body: JSON.stringify({ date: args.date, name: args.name }),
          },
        ),
      ),
  );

  registerTool(
    "delete_workspace_holiday",
    {
      description: "Remove a holiday from the workspace calendar.",
      inputSchema: z.object({
        workspaceId: nonEmptyString,
        holidayId: nonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/calendar/${encodeURIComponent(args.workspaceId)}/holidays/${encodeURIComponent(args.holidayId)}`,
          { method: "DELETE" },
        ),
      ),
  );

  registerTool(
    "list_project_custom_fields",
    {
      description:
        "List a project's custom field definitions (name, type, required, default value, and dropdown options).",
      inputSchema: z.strictObject({ projectId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/custom-field/project/${encodeURIComponent(args.projectId)}`,
          { method: "GET" },
        ),
      ),
  );

  registerTool(
    "get_task_custom_fields",
    {
      description:
        "List a task's custom field values, each alongside its field's name, type and dropdown options.",
      inputSchema: z.strictObject({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/custom-field/task/${encodeURIComponent(args.taskId)}`,
          { method: "GET" },
        ),
      ),
  );

  registerTool(
    "set_task_custom_field_value",
    {
      description:
        "Create or update a task's value for one of its project's custom fields. Pass an empty string to clear it (rejected if the field is required). Values are validated server-side against the field's type (number/boolean/dropdown option).",
      inputSchema: z.strictObject({
        taskId: nonEmptyString,
        fieldId: nonEmptyString,
        value: z.string(),
      }),
    },
    async (args) =>
      run(() =>
        client.json("/api/custom-field/value", {
          method: "PUT",
          body: JSON.stringify({
            taskId: args.taskId,
            fieldId: args.fieldId,
            value: args.value,
          }),
        }),
      ),
  );
}
