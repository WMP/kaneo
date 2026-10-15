import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Observes the real event bus and lets one test make the resolved-event publish
// fail, the way a broken subscriber would.
const bus = vi.hoisted(() => ({
  failResolvedPublish: false,
  failUnlinkedPublish: false,
}));
vi.mock("../../apps/api/src/events", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../apps/api/src/events")>();
  return {
    ...original,
    publishEvent: vi.fn(
      async (
        type: string,
        data: unknown,
        options?: { waitForHandlers?: boolean },
      ) => {
        if (bus.failResolvedPublish && type === "jira.status_proposal_resolved")
          throw new Error("subscriber failed");
        if (bus.failUnlinkedPublish && type === "jira.issue_unlinked")
          throw new Error("subscriber failed");
        return original.publishEvent(type, data, options);
      },
    ),
  };
});

// The status update is the step that can fail after the proposal was claimed.
// By default it is the real controller.
const statusUpdate = vi.hoisted(() => ({
  failWith: null as null | (() => Promise<never>),
}));
vi.mock(
  "../../apps/api/src/task/controllers/update-task-status",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("../../apps/api/src/task/controllers/update-task-status")
      >();
    return {
      ...original,
      default: (...args: Parameters<typeof original.default>) =>
        statusUpdate.failWith
          ? statusUpdate.failWith()
          : original.default(...args),
    };
  },
);

import db, { schema } from "../../apps/api/src/database";
import { loadDraftTaskValues } from "../../apps/api/src/jira-integration/draft-loader";
import {
  acceptProposal,
  rejectProposal,
} from "../../apps/api/src/jira-integration/proposals";
import { unlinkTask } from "../../apps/api/src/jira-integration/task-link";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
  bus.failResolvedPublish = false;
  bus.failUnlinkedPublish = false;
  statusUpdate.failWith = null;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

async function seed() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId: project.id, title: "T", number: 1, status: "to-do" })
    .returning();
  const [connection] = await db
    .insert(schema.jiraConnectionTable)
    .values({
      workspaceId: owner.workspace.id,
      baseUrl: "https://jira.example.test",
      deployment: "server",
      webhookSecret: "secret-secret-secret",
    })
    .returning();
  const [link] = await db
    .insert(schema.jiraIssueLinkTable)
    .values({
      taskId: task.id,
      connectionId: connection.id,
      issueId: "10001",
      issueKey: "PRJ-1",
      issueUrl: "https://jira.example.test/browse/PRJ-1",
      jiraProjectKey: "PRJ",
      createdByUserId: owner.user.id,
    })
    .returning();
  const proposal = await addProposal(task.id, link.id);
  return { owner, task, link, proposal };
}

async function addProposal(taskId: string, linkId: string, state = "pending") {
  const [proposal] = await db
    .insert(schema.jiraStatusProposalTable)
    .values({
      taskId,
      linkId,
      fromStatusName: "To Do",
      toStatusId: "5",
      toStatusName: "Done",
      proposedStatus: "done",
      source: "webhook",
      state,
    })
    .returning();
  return proposal;
}

const proposalRow = (id: string) =>
  db.query.jiraStatusProposalTable.findFirst({
    where: eq(schema.jiraStatusProposalTable.id, id),
  });
const taskRow = (id: string) =>
  db.query.taskTable.findFirst({ where: eq(schema.taskTable.id, id) });

describe("Jira status proposals: refusals", () => {
  it("answers 404 for an unknown proposal on accept and reject", async () => {
    const { owner } = await seed();
    await expect(
      acceptProposal({ proposalId: "missing", userId: owner.user.id }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      rejectProposal({ proposalId: "missing", userId: owner.user.id }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("Jira status proposals: a failing status update gives the proposal back", () => {
  it("returns the claimed proposal to pending, clears who resolved it and leaves the task status alone", async () => {
    const { owner, task, proposal } = await seed();
    statusUpdate.failWith = async () => {
      throw new Error("status update failed");
    };

    await expect(
      acceptProposal({ proposalId: proposal.id, userId: owner.user.id }),
    ).rejects.toThrow("status update failed");

    expect(await proposalRow(proposal.id)).toMatchObject({
      state: "pending",
      resolvedByUserId: null,
      resolvedStatus: null,
      resolvedAt: null,
    });
    expect((await taskRow(task.id))?.status).toBe("to-do");

    // Positive control: the same proposal can be accepted once the update works.
    statusUpdate.failWith = null;
    await acceptProposal({ proposalId: proposal.id, userId: owner.user.id });
    expect(await proposalRow(proposal.id)).toMatchObject({
      state: "accepted",
      resolvedStatus: "done",
    });
    expect((await taskRow(task.id))?.status).toBe("done");
  });

  it("marks it superseded when a newer proposal became pending meanwhile (one pending per task)", async () => {
    const { owner, task, link, proposal } = await seed();
    let newer: string | undefined;
    statusUpdate.failWith = async () => {
      newer = (await addProposal(task.id, link.id)).id;
      throw new Error("status update failed");
    };

    await expect(
      acceptProposal({ proposalId: proposal.id, userId: owner.user.id }),
    ).rejects.toThrow("status update failed");

    expect((await proposalRow(proposal.id))?.state).toBe("superseded");
    expect((await proposalRow(newer as string))?.state).toBe("pending");
  });

  it("still reports the original error when giving the proposal back fails too", async () => {
    const { owner, proposal } = await seed();
    statusUpdate.failWith = async () => {
      throw new Error("status update failed");
    };
    await db.execute(
      sql.raw(
        "CREATE FUNCTION cov_block_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'release blocked'; END $$",
      ),
    );
    await db.execute(
      sql.raw(
        "CREATE TRIGGER cov_block_release BEFORE UPDATE ON ganttpro_jira_status_proposal FOR EACH ROW WHEN (NEW.state = 'pending') EXECUTE FUNCTION cov_block_release()",
      ),
    );
    try {
      await expect(
        acceptProposal({ proposalId: proposal.id, userId: owner.user.id }),
      ).rejects.toThrow("status update failed");
      expect(console.error).toHaveBeenCalledWith(
        "Failed to release a Jira status proposal",
        expect.anything(),
      );
      // The proposal stays claimed: nobody can silently accept it twice.
      expect((await proposalRow(proposal.id))?.state).toBe("accepted");
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER cov_block_release ON ganttpro_jira_status_proposal",
        ),
      );
      await db.execute(sql.raw("DROP FUNCTION cov_block_release()"));
    }
  });
});

describe("Jira status proposals: a failing resolved-event publish is logged, not fatal", () => {
  it("accept and reject still resolve and store their outcome", async () => {
    const { owner, task, link, proposal } = await seed();
    bus.failResolvedPublish = true;

    const accepted = await acceptProposal({
      proposalId: proposal.id,
      userId: owner.user.id,
    });
    expect(accepted).toMatchObject({
      state: "accepted",
      resolvedStatus: "done",
    });
    expect((await taskRow(task.id))?.status).toBe("done");
    expect(console.error).toHaveBeenCalledWith(
      "Failed to publish jira.status_proposal_resolved",
      expect.any(Error),
    );

    const second = await addProposal(task.id, link.id);
    const rejected = await rejectProposal({
      proposalId: second.id,
      userId: owner.user.id,
    });
    expect(rejected).toMatchObject({ state: "rejected", resolvedStatus: null });
    expect((await taskRow(task.id))?.status).toBe("done");
  });
});

describe("Jira task link and draft values", () => {
  it("unlinking removes the link and its proposals even when publishing the event fails, and a second unlink reports nothing to remove", async () => {
    const { owner, task, link, proposal } = await seed();
    bus.failUnlinkedPublish = true;
    const taskFull = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, task.id),
    });

    expect(
      await unlinkTask({ task: taskFull as never, userId: owner.user.id }),
    ).toBe(true);

    expect(console.error).toHaveBeenCalledWith(
      "Failed to publish jira.issue_unlinked",
      expect.any(Error),
    );
    expect(
      await db.query.jiraIssueLinkTable.findFirst({
        where: eq(schema.jiraIssueLinkTable.id, link.id),
      }),
    ).toBeUndefined();
    expect(await proposalRow(proposal.id)).toBeUndefined();
    const activity = await db.query.activityTable.findFirst({
      where: eq(schema.activityTable.type, "jira_issue_unlinked"),
    });
    expect(activity?.eventData).toMatchObject({ issueKey: "PRJ-1" });

    expect(
      await unlinkTask({ task: taskFull as never, userId: owner.user.id }),
    ).toBe(false);
  });

  it("draft values carry labels in name order and only the custom values of fields the project still shows", async () => {
    const { owner, task } = await seed();
    const taskFull = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, task.id),
    });
    const projectId = task.projectId;
    await db.insert(schema.labelTable).values([
      {
        name: "zeta",
        color: "#111111",
        workspaceId: owner.workspace.id,
        taskId: task.id,
      },
      {
        name: "alpha",
        color: "#222222",
        workspaceId: owner.workspace.id,
        taskId: task.id,
      },
      {
        name: "dying",
        color: "#333333",
        workspaceId: owner.workspace.id,
        taskId: task.id,
        deletionStartedAt: new Date(),
      },
    ]);
    const [shown] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({ projectId, name: "Points", type: "number" })
      .returning();
    const [otherProject] = await db
      .insert(schema.projectTable)
      .values({
        workspaceId: owner.workspace.id,
        name: "Other",
        icon: "Folder",
        slug: "other-p",
      })
      .returning();
    const [foreignField] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({ projectId: otherProject.id, name: "Elsewhere", type: "text" })
      .returning();
    await db.insert(schema.customFieldValueTable).values([
      { taskId: task.id, fieldId: shown.id, value: "5" },
      { taskId: task.id, fieldId: foreignField.id, value: "stale" },
    ]);

    const { values, customValues } = await loadDraftTaskValues(
      taskFull as never,
    );

    expect(values.labels).toEqual(["alpha", "zeta"]);
    expect(customValues).toEqual({
      [shown.id]: { type: "number", value: "5" },
    });
  });
});
