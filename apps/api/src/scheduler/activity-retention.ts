import { and, eq, gt, inArray, isNotNull, lt, or } from "drizzle-orm";
import db from "../database";
import {
  activityTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../database/schema";
import { withJobLease } from "./leader-lock";

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_RETENTION_LEASE = "activity-retention";

// Escape hatch for support/debugging: unset (the default) or any value other
// than "false" runs the job normally.
function isEnabled() {
  return process.env.ACTIVITY_RETENTION_ENABLED !== "false";
}

// Deletes activity rows older than `retentionDays` for one workspace: both
// task-scoped rows (matched via task -> project -> workspace, since activity
// itself doesn't carry a workspace id for those) and workspace-level rows
// (e.g. calendar changes, which set activityTable.workspaceId directly).
// Exported for the focused unit test; also used by the cron job below.
export async function deleteExpiredActivity(
  workspaceId: string,
  retentionDays: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);

  const workspaceTaskIds = db
    .select({ id: taskTable.id })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(eq(projectTable.workspaceId, workspaceId));

  const deleted = await db
    .delete(activityTable)
    .where(
      and(
        lt(activityTable.createdAt, cutoff),
        or(
          eq(activityTable.workspaceId, workspaceId),
          inArray(activityTable.taskId, workspaceTaskIds),
        ),
      ),
    )
    .returning({ id: activityTable.id });

  return deleted.length;
}

async function getWorkspacesWithRetention() {
  return db
    .select({
      id: workspaceTable.id,
      activityRetentionDays: workspaceTable.activityRetentionDays,
    })
    .from(workspaceTable)
    .where(
      and(
        isNotNull(workspaceTable.activityRetentionDays),
        gt(workspaceTable.activityRetentionDays, 0),
      ),
    );
}

async function runRetention(): Promise<{ degraded: boolean }> {
  let workspaces: Awaited<ReturnType<typeof getWorkspacesWithRetention>>;
  try {
    workspaces = await getWorkspacesWithRetention();
  } catch (error) {
    console.error("activity retention: failed to query workspaces", error);
    return { degraded: true };
  }

  if (workspaces.length === 0) {
    return { degraded: false };
  }

  const now = new Date();
  let totalDeleted = 0;
  let degraded = false;

  for (const workspace of workspaces) {
    if (!workspace.activityRetentionDays) continue;
    try {
      totalDeleted += await deleteExpiredActivity(
        workspace.id,
        workspace.activityRetentionDays,
        now,
      );
    } catch (error) {
      degraded = true;
      console.error(
        `activity retention: failed for workspace ${workspace.id}`,
        error,
      );
    }
  }

  if (totalDeleted > 0) {
    console.log(
      `activity retention: deleted ${totalDeleted} expired activity row(s) across ${workspaces.length} workspace(s)`,
    );
  }

  return { degraded };
}

export async function enforceActivityRetention(): Promise<{
  degraded: boolean;
}> {
  if (!isEnabled()) {
    return { degraded: false };
  }

  return withJobLease(ACTIVITY_RETENTION_LEASE, runRetention, () => ({
    degraded: false,
  }));
}
