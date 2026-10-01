import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { jiraStatusProposalTable, taskTable } from "../database/schema";
import { publishEvent } from "../events";
import updateTaskStatus from "../task/controllers/update-task-status";
import { assertValidTaskStatus } from "../task/validate-task-fields";
import { isUniqueViolation } from "../utils/pg-error";
import { jiraError } from "./errors";
import type { JiraStatusProposalRow } from "./links";

async function loadProposal(proposalId: string) {
  const [proposal] = await db
    .select()
    .from(jiraStatusProposalTable)
    .where(eq(jiraStatusProposalTable.id, proposalId))
    .limit(1);
  if (!proposal) {
    throw new HTTPException(404, { message: "Status proposal not found" });
  }
  return proposal;
}

function notPending() {
  return jiraError(
    409,
    "PROPOSAL_NOT_PENDING",
    "This status proposal is no longer pending.",
  );
}

async function publishResolved(
  proposal: JiraStatusProposalRow,
  projectId: string,
  userId: string,
  state: "accepted" | "rejected",
  status: string | null,
) {
  try {
    await publishEvent("jira.status_proposal_resolved", {
      taskId: proposal.taskId,
      projectId,
      userId,
      proposalId: proposal.id,
      linkId: proposal.linkId,
      state,
      status,
    });
  } catch (error) {
    console.error("Failed to publish jira.status_proposal_resolved", error);
  }
}

// Atomically takes a pending proposal: exactly one of two simultaneous
// resolutions gets the row back, the other one sees 409.
async function claimProposal(
  proposalId: string,
  values: {
    state: "accepted" | "rejected";
    resolvedByUserId: string;
    resolvedStatus: string | null;
  },
): Promise<JiraStatusProposalRow | null> {
  const [claimed] = await db
    .update(jiraStatusProposalTable)
    .set({ ...values, resolvedAt: new Date() })
    .where(
      and(
        eq(jiraStatusProposalTable.id, proposalId),
        eq(jiraStatusProposalTable.state, "pending"),
      ),
    )
    .returning();
  return claimed ?? null;
}

// Gives a claimed proposal back when applying it failed, so a person can try
// again. If a newer change already produced a pending proposal meanwhile, this
// one is superseded instead (at most one is pending per task).
async function releaseProposal(proposalId: string): Promise<void> {
  const release = (state: "pending" | "superseded") =>
    db
      .update(jiraStatusProposalTable)
      .set({
        state,
        resolvedByUserId: null,
        resolvedStatus: null,
        resolvedAt: null,
      })
      .where(
        and(
          eq(jiraStatusProposalTable.id, proposalId),
          eq(jiraStatusProposalTable.state, "accepted"),
        ),
      );
  try {
    await release("pending");
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await release("superseded");
  }
}

// Accepting is the only way a Jira status reaches a task: it goes through
// `updateTaskStatus`, so the ordinary status event, activity, notifications,
// integrations and realtime delivery all apply, attributed to the caller.
export async function acceptProposal({
  proposalId,
  userId,
  status: requestedStatus,
}: {
  proposalId: string;
  userId: string;
  status?: string;
}): Promise<JiraStatusProposalRow> {
  const proposal = await loadProposal(proposalId);
  if (proposal.state !== "pending") throw notPending();

  const status = requestedStatus ?? proposal.proposedStatus;
  if (!status) {
    throw jiraError(
      400,
      "STATUS_REQUIRED",
      "This Jira status is not mapped to a Kaneo status. Choose the status to set.",
    );
  }

  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, proposal.taskId))
    .limit(1);
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  await assertValidTaskStatus(status, task.projectId);

  const claimed = await claimProposal(proposalId, {
    state: "accepted",
    resolvedByUserId: userId,
    resolvedStatus: status,
  });
  if (!claimed) throw notPending();

  try {
    await updateTaskStatus({
      id: proposal.taskId,
      status,
      currentUserId: userId,
    });
  } catch (error) {
    await releaseProposal(proposalId).catch((releaseError) => {
      console.error("Failed to release a Jira status proposal", releaseError);
    });
    throw error;
  }

  await publishResolved(claimed, task.projectId, userId, "accepted", status);
  return claimed;
}

export async function rejectProposal({
  proposalId,
  userId,
}: {
  proposalId: string;
  userId: string;
}): Promise<JiraStatusProposalRow> {
  const proposal = await loadProposal(proposalId);
  if (proposal.state !== "pending") throw notPending();

  const claimed = await claimProposal(proposalId, {
    state: "rejected",
    resolvedByUserId: userId,
    resolvedStatus: null,
  });
  if (!claimed) throw notPending();

  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, proposal.taskId))
    .limit(1);
  await publishResolved(
    claimed,
    task?.projectId ?? "",
    userId,
    "rejected",
    null,
  );
  return claimed;
}
