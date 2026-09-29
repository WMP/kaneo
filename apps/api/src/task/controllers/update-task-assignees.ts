import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable, userTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { filterWorkspaceResources } from "../../resource/workspace-resources";
import {
  filterProjectAssignableUsers,
  getProjectWorkspaceId,
} from "../../utils/assert-assignable-user";
import type { AssigneeTarget } from "../assignments";
import { readTaskAssignees, setTaskAssignees } from "../assignments";

function dedupe(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

async function updateTaskAssignees({
  id,
  userIds,
  resourceIds = [],
  currentUserId,
}: {
  id: string;
  userIds: string[];
  resourceIds?: string[];
  currentUserId: string;
}) {
  const existingTask = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, id),
  });

  if (!existingTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  const trimmedUserIds = dedupe(userIds);
  const trimmedResourceIds = dedupe(resourceIds);

  // Read the pre-mutation assignee list once: it decides which assignees are
  // NEW (only those need project access) and, below, the added/removed diff
  // the published event carries.
  const previousAssigneesByTaskId = await readTaskAssignees(db, [id]);

  if (trimmedUserIds.length > 0 || trimmedResourceIds.length > 0) {
    const workspaceId = await getProjectWorkspaceId(existingTask.projectId);

    if (trimmedUserIds.length > 0) {
      // Only NEW assignees are checked (they must be able to open the project).
      // Assignees already on the task are carried over without any check, even
      // if they lost their project membership or left the workspace: the web
      // client always sends the whole list back, so checking them would make
      // every edit of such a task fail and stop others from being added.
      const currentUserIds = new Set(
        (previousAssigneesByTaskId.get(id) ?? [])
          .map((assignee) => assignee.userId)
          .filter((userId): userId is string => userId !== null),
      );
      const added = trimmedUserIds.filter(
        (userId) => !currentUserIds.has(userId),
      );
      const assignable = await filterProjectAssignableUsers(
        added,
        existingTask.projectId,
      );
      const notAssignable = added.filter((userId) => !assignable.has(userId));

      if (notAssignable.length > 0) {
        throw new HTTPException(403, {
          message: "One or more assignees are not members of this project",
        });
      }
    }

    if (trimmedResourceIds.length > 0) {
      const assignable = await filterWorkspaceResources(
        trimmedResourceIds,
        workspaceId,
      );
      const notAssignable = trimmedResourceIds.filter(
        (resourceId) => !assignable.has(resourceId),
      );

      if (notAssignable.length > 0) {
        throw new HTTPException(403, {
          message:
            "One or more resources do not belong to this task's workspace",
        });
      }
    }
  }

  const targets: AssigneeTarget[] = [
    ...trimmedUserIds.map((userId) => ({ userId }) satisfies AssigneeTarget),
    ...trimmedResourceIds.map(
      (resourceId) => ({ resourceId }) satisfies AssigneeTarget,
    ),
  ];

  const previousPrimaryId = existingTask.userId;

  // The pre-mutation list (read above) lets the published event carry the
  // full added/removed diff, not just the primary-mirror change. Only user
  // ids are ever diffed/notified — a resource has no account to notify, and
  // no event fires for a resource-only change (see below).
  const previousAssigneeIds = (previousAssigneesByTaskId.get(id) ?? [])
    .map((assignee) => assignee.userId)
    .filter((userId): userId is string => userId !== null);
  const previousAssigneeIdSet = new Set(previousAssigneeIds);

  const newTargets = await setTaskAssignees(db, id, targets);
  const newAssigneeIds = newTargets
    .filter((target): target is { userId: string } => "userId" in target)
    .map((target) => target.userId);
  const newAssigneeIdSet = new Set(newAssigneeIds);

  const addedAssigneeIds = newAssigneeIds.filter(
    (userId) => !previousAssigneeIdSet.has(userId),
  );
  const removedAssigneeIds = previousAssigneeIds.filter(
    (userId) => !newAssigneeIdSet.has(userId),
  );

  const [updatedTask] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      position: taskTable.position,
      number: taskTable.number,
      userId: taskTable.userId,
      title: taskTable.title,
      description: taskTable.description,
      status: taskTable.status,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      progress: taskTable.progress,
      isMilestone: taskTable.isMilestone,
      baselineStartDate: taskTable.baselineStartDate,
      baselineDueDate: taskTable.baselineDueDate,
      constraintType: taskTable.constraintType,
      constraintDate: taskTable.constraintDate,
      approvalStatus: taskTable.approvalStatus,
      approvalNote: taskTable.approvalNote,
      createdAt: taskTable.createdAt,
      assigneeName: userTable.name,
      assigneeId: userTable.id,
    })
    .from(taskTable)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(eq(taskTable.id, id))
    .limit(1);

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task assignees",
    });
  }

  // Preserve the same primary-based events the single-assignee route fires
  // (so external webhooks/GitHub sync stay unaffected by this route
  // existing), but also fire when only a secondary user assignee was added
  // or removed, carrying the full diff additively via
  // addedAssigneeIds/removedAssigneeIds so every user assignee — not just
  // the primary — can be notified downstream. A resource-only change (no
  // user added/removed, primary unchanged) fires neither event: a resource
  // has no account to notify, and the activity entry this event drives
  // (see activity/index.ts) is written in terms of the primary user, which
  // did not change.
  const primaryChanged = previousPrimaryId !== updatedTask.userId;
  const membershipChanged =
    addedAssigneeIds.length > 0 || removedAssigneeIds.length > 0;

  if (primaryChanged || membershipChanged) {
    if (!updatedTask.userId) {
      await publishEvent("task.unassigned", {
        taskId: updatedTask.id,
        projectId: updatedTask.projectId,
        userId: currentUserId,
        title: updatedTask.title,
        type: "unassigned",
      });
    } else {
      await publishEvent("task.assignee_changed", {
        taskId: updatedTask.id,
        projectId: updatedTask.projectId,
        userId: currentUserId,
        oldAssignee: previousPrimaryId,
        newAssignee: updatedTask.assigneeName ?? undefined,
        newAssigneeId: updatedTask.userId,
        addedAssigneeIds,
        removedAssigneeIds,
        title: updatedTask.title,
        type: "assignee_changed",
      });
    }
  }

  const assigneesByTaskId = await readTaskAssignees(db, [id]);

  return {
    ...updatedTask,
    assignees: assigneesByTaskId.get(id) ?? [],
  };
}

export default updateTaskAssignees;
