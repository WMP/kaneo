import { and, eq, isNotNull } from "drizzle-orm";
import db from "../database";
import {
  activityTable,
  jiraIssueLinkTable,
  jiraStatusProposalTable,
  projectTable,
  taskAssignmentTable,
  taskTable,
} from "../database/schema";
import { publishEvent } from "../events";
import createNotification from "../notification/controllers/create-notification";
import { getValidTaskStatuses } from "../task/validate-task-fields";
import type { JiraIssueLinkRow, JiraStatusProposalRow } from "./links";
import { findMappedKaneoStatus, resolveJiraMapping } from "./mapping";
import { loadMapping } from "./mapping-store";

export type JiraStatusChangeSource = "webhook" | "poll" | "manual";

export type JiraStatusChange = {
  statusId: string | null;
  statusName: string;
  // Jira's own name of the person who made the change (webhook only).
  changedBy?: string | null;
  changedAt?: Date | null;
  // The status Jira says it moved from; the link's last known one otherwise.
  fromStatusName?: string | null;
  source: JiraStatusChangeSource;
  // The Kaneo user who asked for the refresh, if any. They are not notified
  // about a change they just pulled in themselves.
  actorUserId?: string | null;
};

export type JiraStatusChangeResult = {
  // False when the status was already known, or when this was the first
  // observation of a link (a baseline, not a change).
  changed: boolean;
  proposal: JiraStatusProposalRow | null;
  proposalCreated: boolean;
};

const NO_CHANGE: JiraStatusChangeResult = {
  changed: false,
  proposal: null,
  proposalCreated: false,
};

export function describeStatusChange(
  fromStatusName: string | null,
  toStatusName: string,
): string {
  return fromStatusName ? `${fromStatusName} → ${toStatusName}` : toStatusName;
}

// A Jira status change is information for Kaneo, never an instruction: this
// records it (activity, link state, at most one pending proposal) and tells
// clients, but it NEVER changes the task's status. Only a person accepting the
// proposal does, through `updateTaskStatus`.
//
// Safe to call twice for the same change, and from the webhook and the poll at
// the same time: the link row is locked, and a status the link already knows is
// a no-op.
export async function processJiraStatusChange(
  link: JiraIssueLinkRow,
  change: JiraStatusChange,
): Promise<JiraStatusChangeResult> {
  const [task] = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      projectId: taskTable.projectId,
      userId: taskTable.userId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(eq(taskTable.id, link.taskId))
    .limit(1);
  if (!task) return NO_CHANGE;

  // Statuses belong to the task, not to a person: default, workspace and
  // project levels only. A mapped status that is no longer a column of the
  // project counts as not mapped.
  const [workspaceMapping, projectMapping, validStatuses] = await Promise.all([
    loadMapping({ scope: "workspace", workspaceId: task.workspaceId }),
    loadMapping({
      scope: "project",
      workspaceId: task.workspaceId,
      projectId: task.projectId,
    }),
    getValidTaskStatuses(task.projectId),
  ]);
  const mapped = findMappedKaneoStatus(
    resolveJiraMapping({
      workspace: workspaceMapping?.config,
      project: projectMapping?.config,
    }).statusMappings,
    change,
  );
  const mappedStatus = mapped && validStatuses.includes(mapped) ? mapped : null;

  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(jiraIssueLinkTable)
      .where(eq(jiraIssueLinkTable.id, link.id))
      .for("update");
    if (!current) return null;

    const now = new Date();
    const known = change.statusId
      ? current.lastStatusId === change.statusId
      : current.lastStatusName === change.statusName;
    if (known) {
      await tx
        .update(jiraIssueLinkTable)
        .set({ lastSyncedAt: now, syncError: null })
        .where(eq(jiraIssueLinkTable.id, current.id));
      return null;
    }

    await tx
      .update(jiraIssueLinkTable)
      .set({
        lastStatusId: change.statusId,
        lastStatusName: change.statusName,
        lastSyncedAt: now,
        syncError: null,
      })
      .where(eq(jiraIssueLinkTable.id, current.id));

    // The first status ever read for a link is where we start from. A webhook
    // is by definition a change, so it is never a baseline.
    const baseline =
      current.lastStatusId === null &&
      current.lastStatusName === null &&
      change.source !== "webhook";
    if (baseline) return null;

    const fromStatusName =
      change.fromStatusName ?? current.lastStatusName ?? null;

    const [currentTask] = await tx
      .select({ status: taskTable.status })
      .from(taskTable)
      .where(eq(taskTable.id, task.id))
      .limit(1);
    if (!currentTask) return null;

    // A newer change replaces an older pending proposal.
    const superseded = await tx
      .update(jiraStatusProposalTable)
      .set({ state: "superseded" })
      .where(
        and(
          eq(jiraStatusProposalTable.taskId, task.id),
          eq(jiraStatusProposalTable.state, "pending"),
        ),
      )
      .returning({ id: jiraStatusProposalTable.id });

    let proposal: JiraStatusProposalRow | null = null;
    if (!(mappedStatus !== null && mappedStatus === currentTask.status)) {
      const [inserted] = await tx
        .insert(jiraStatusProposalTable)
        .values({
          taskId: task.id,
          linkId: current.id,
          fromStatusName,
          toStatusId: change.statusId,
          toStatusName: change.statusName,
          proposedStatus: mappedStatus,
          state: "pending",
          jiraChangedBy: change.changedBy ?? null,
          jiraChangedAt: change.changedAt ?? null,
          source: change.source,
        })
        .returning();
      proposal = inserted ?? null;
    }

    // Written in the same transaction so a change that is recorded is never
    // missing its activity. No Kaneo user made it.
    await tx.insert(activityTable).values({
      taskId: task.id,
      type: "jira_status_changed",
      userId: null,
      content: describeStatusChange(fromStatusName, change.statusName),
      eventData: {
        issueKey: current.issueKey,
        fromStatus: fromStatusName,
        toStatus: change.statusName,
        proposedStatus: mappedStatus,
      },
    });

    return {
      current,
      fromStatusName,
      proposal,
      supersededCount: superseded.length,
    };
  });

  if (!outcome) return NO_CHANGE;

  const { current, fromStatusName, proposal } = outcome;
  const eventBase = {
    taskId: task.id,
    projectId: task.projectId,
    userId: change.actorUserId ?? null,
    linkId: current.id,
    issueKey: current.issueKey,
  };

  // The change is committed: a failing side effect must not undo or repeat it.
  await publishSafely("jira.status_changed", {
    ...eventBase,
    fromStatus: fromStatusName,
    toStatus: change.statusName,
    proposedStatus: mappedStatus,
    proposalId: proposal?.id ?? null,
    source: change.source,
  });

  if (proposal) {
    await publishSafely("jira.status_proposal_created", {
      ...eventBase,
      proposalId: proposal.id,
      toStatus: change.statusName,
      proposedStatus: mappedStatus,
      source: change.source,
    });
    await notifyAboutProposal({
      taskId: task.id,
      taskTitle: task.title,
      projectId: task.projectId,
      workspaceId: task.workspaceId,
      assigneeId: task.userId,
      link: current,
      proposal,
      exceptUserId: change.actorUserId ?? null,
    });
  }

  return { changed: true, proposal, proposalCreated: proposal !== null };
}

async function publishSafely(eventType: string, data: unknown): Promise<void> {
  try {
    await publishEvent(eventType, data);
  } catch (error) {
    console.error(`Failed to publish ${eventType}`, error);
  }
}

// The people who should look at a proposal: the task's user assignees and
// the person who linked the issue. `createNotification` drops anybody who can
// no longer open the task's project.
async function notifyAboutProposal({
  taskId,
  taskTitle,
  projectId,
  workspaceId,
  assigneeId,
  link,
  proposal,
  exceptUserId,
}: {
  taskId: string;
  taskTitle: string;
  projectId: string;
  workspaceId: string;
  assigneeId: string | null;
  link: JiraIssueLinkRow;
  proposal: JiraStatusProposalRow;
  exceptUserId: string | null;
}): Promise<void> {
  const assignments = await db
    .select({ userId: taskAssignmentTable.userId })
    .from(taskAssignmentTable)
    .where(
      and(
        eq(taskAssignmentTable.taskId, taskId),
        isNotNull(taskAssignmentTable.userId),
      ),
    );

  const recipients = new Set<string>();
  if (assigneeId) recipients.add(assigneeId);
  for (const assignment of assignments) {
    if (assignment.userId) recipients.add(assignment.userId);
  }
  if (link.createdByUserId) recipients.add(link.createdByUserId);
  if (exceptUserId) recipients.delete(exceptUserId);

  for (const userId of recipients) {
    try {
      await createNotification({
        userId,
        type: "jira_status_proposal",
        eventData: {
          taskTitle,
          projectId,
          workspaceId,
          issueKey: link.issueKey,
          fromStatus: proposal.fromStatusName,
          toStatus: proposal.toStatusName,
          proposedStatus: proposal.proposedStatus,
          proposalId: proposal.id,
        },
        resourceId: taskId,
        resourceType: "task",
      });
    } catch (error) {
      console.error("Failed to notify about a Jira status proposal", {
        taskId,
        userId,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }
}
