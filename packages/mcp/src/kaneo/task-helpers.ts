const PRIORITIES = ["no-priority", "low", "medium", "high", "urgent"] as const;

export type TaskPriority = (typeof PRIORITIES)[number];

export function isTaskPriority(v: string): v is TaskPriority {
  return (PRIORITIES as readonly string[]).includes(v);
}

export const CONSTRAINT_TYPES = [
  "none",
  "start_no_earlier_than",
  "finish_no_later_than",
  "must_start_on",
] as const;

export type TaskConstraintType = (typeof CONSTRAINT_TYPES)[number];

export type TaskUpdatePatch = {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: TaskPriority;
  projectId?: string;
  position?: number;
  startDate?: string | null;
  dueDate?: string | null;
  userId?: string | null;
  progress?: number;
  isMilestone?: boolean;
  constraintType?: TaskConstraintType;
  constraintDate?: string | null;
};

/**
 * Builds the JSON body for `PUT /api/task/:id` from an existing task plus a patch.
 */
export function buildFullTaskUpdateBody(
  existing: Record<string, unknown>,
  patch: TaskUpdatePatch,
): Record<string, string | number | boolean | null | undefined> {
  const positionRaw = patch.position ?? existing.position;
  const position =
    typeof positionRaw === "number"
      ? positionRaw
      : typeof positionRaw === "string"
        ? Number(positionRaw)
        : Number.NaN;
  if (!Number.isFinite(position)) {
    throw new Error(
      "Cannot update task: missing numeric `position` on existing task.",
    );
  }

  const title =
    patch.title ??
    (typeof existing.title === "string" ? existing.title : undefined);
  if (!title) {
    throw new Error("Cannot update task: missing title.");
  }

  const description =
    patch.description !== undefined
      ? patch.description === null
        ? ""
        : String(patch.description)
      : existing.description == null
        ? ""
        : String(existing.description);

  const status =
    patch.status ??
    (typeof existing.status === "string" ? existing.status : undefined);
  if (!status) {
    throw new Error("Cannot update task: missing status.");
  }

  const priorityRaw =
    patch.priority ??
    (typeof existing.priority === "string" ? existing.priority : undefined);
  if (!priorityRaw || !isTaskPriority(priorityRaw)) {
    throw new Error("Cannot update task: invalid or missing priority.");
  }

  const projectId =
    patch.projectId ??
    (typeof existing.projectId === "string" ? existing.projectId : undefined);
  if (!projectId) {
    throw new Error("Cannot update task: missing projectId.");
  }

  // When patch.userId is explicitly null, we set userId to "" so the API clears assignee; the API
  // treats "" as unassigned (userId || null). When patch.userId is undefined, keep existing.userId
  // unchanged (leave assignee as-is).
  const userId =
    patch.userId !== undefined
      ? patch.userId === null
        ? ""
        : patch.userId
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

  if (startDate !== undefined) {
    body.startDate = startDate;
  }
  if (dueDate !== undefined) {
    body.dueDate = dueDate;
  }
  if (userId !== undefined) {
    body.userId = userId;
  }
  // Left untouched when omitted, same as the API's PUT /api/task/:id
  // contract: an older caller that never mentions these fields must not
  // silently reset them.
  if (patch.progress !== undefined) {
    body.progress = patch.progress;
  }
  if (patch.isMilestone !== undefined) {
    body.isMilestone = patch.isMilestone;
  }
  // constraintType is what opts the request into touching either
  // constraint field at all; passing constraintDate alone leaves both
  // untouched (mirrors updateTaskBody's refine in apps/api/src/task/schema.ts).
  if (patch.constraintType !== undefined) {
    body.constraintType = patch.constraintType;
    body.constraintDate = patch.constraintDate ?? null;
  }

  return body;
}

function formatOptionalIso(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}
