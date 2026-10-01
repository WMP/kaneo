import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireEntitlement } from "../../billing/require-entitlement-middleware";
import db from "../../database";
import { taskTable } from "../../database/schema";
import { requireWorkspacePermission } from "../../utils/require-workspace-permission";

type BulkTaskOperation =
  | "updateStatus"
  | "updatePriority"
  | "updateAssignee"
  | "updateProgress"
  | "delete"
  | "addLabel"
  | "removeLabel"
  | "updateDueDate"
  | "updateSchedule";

const BULK_OPERATIONS: readonly BulkTaskOperation[] = [
  "updateStatus",
  "updatePriority",
  "updateAssignee",
  "updateProgress",
  "delete",
  "addLabel",
  "removeLabel",
  "updateDueDate",
  "updateSchedule",
];

// Route middleware runs before the validators, so c.req.valid() is unavailable.
async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  const raw = (await c.req.json().catch(() => ({}))) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

async function bulkOperation(c: Context): Promise<BulkTaskOperation> {
  const { operation } = await readJsonBody(c);
  if (
    typeof operation !== "string" ||
    !(BULK_OPERATIONS as readonly string[]).includes(operation)
  ) {
    throw new HTTPException(400, {
      message: `operation must be one of: ${BULK_OPERATIONS.join(", ")}`,
    });
  }
  return operation as BulkTaskOperation;
}

export async function requireBulkTaskPermission(c: Context, next: Next) {
  const operation = await bulkOperation(c);

  if (operation === "delete") {
    return requireWorkspacePermission({ task: ["delete"] })(c, next);
  }

  if (operation === "updateAssignee") {
    return requireWorkspacePermission({ task: ["assign"] })(c, next);
  }

  if (operation === "addLabel" || operation === "removeLabel") {
    return requireWorkspacePermission({ label: ["update"] })(c, next);
  }

  return requireWorkspacePermission({ task: ["update"] })(c, next);
}

export async function requireBulkTaskEntitlement(c: Context, next: Next) {
  const operation = await bulkOperation(c);

  if (
    operation === "delete" ||
    operation === "addLabel" ||
    operation === "removeLabel"
  ) {
    return next();
  }

  return requireEntitlement(c, next);
}

export async function requireTaskAssigneePermission(c: Context, next: Next) {
  const id = c.req.param("id");
  const body = await readJsonBody(c);

  const [existingTask] = await db
    .select({ userId: taskTable.userId })
    .from(taskTable)
    .where(eq(taskTable.id, id ?? ""))
    .limit(1);

  if (!existingTask) {
    return next();
  }

  // The `/assignees` route's body carries a full list rather than a single
  // value; compare it against the current assignee set (today, at most the
  // primary — this middleware has no cheap access to the full assignment
  // table) rather than reusing the single-value branch below.
  if (Array.isArray(body.userIds)) {
    const nextAssignees = new Set(
      body.userIds.filter(
        (value): value is string => typeof value === "string",
      ),
    );
    const currentAssignees = new Set(
      existingTask.userId ? [existingTask.userId] : [],
    );
    const changed =
      nextAssignees.size !== currentAssignees.size ||
      [...nextAssignees].some((userId) => !currentAssignees.has(userId));

    if (changed) {
      return requireWorkspacePermission({ task: ["assign"] })(c, next);
    }

    return next();
  }

  // PUT /api/task/{id} leaves the assignees alone when userId is omitted, so
  // that is not an assignment change. A blank userId unassigns the primary.
  if (body.userId === undefined) {
    return next();
  }

  const nextAssignee =
    typeof body.userId === "string" ? body.userId.trim() || null : null;

  if (existingTask.userId !== nextAssignee) {
    return requireWorkspacePermission({ task: ["assign"] })(c, next);
  }

  return next();
}
