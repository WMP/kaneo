import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The three code-host label syncs call external services (GitHub, Gitea,
// GitLab). They are replaced by rejecting stubs to prove that a failing sync
// is logged and never fails or rolls back the label change.
const sync = vi.hoisted(() => {
  const fail = (name: string) =>
    vi.fn(async () => {
      throw new Error(`${name} unavailable`);
    });
  return {
    syncLabelToGitHub: fail("github"),
    removeLabelFromGitHub: fail("github"),
    syncLabelToGitea: fail("gitea"),
    removeLabelFromGitea: fail("gitea"),
    syncLabelToGitlab: fail("gitlab"),
    removeLabelFromGitlab: fail("gitlab"),
  };
});
vi.mock("../../apps/api/src/plugins/github/utils/sync-label-to-github", () => ({
  syncLabelToGitHub: sync.syncLabelToGitHub,
  removeLabelFromGitHub: sync.removeLabelFromGitHub,
}));
vi.mock("../../apps/api/src/plugins/gitea/utils/sync-label-to-gitea", () => ({
  syncLabelToGitea: sync.syncLabelToGitea,
  removeLabelFromGitea: sync.removeLabelFromGitea,
}));
vi.mock("../../apps/api/src/plugins/gitlab/utils/sync-label-to-gitlab", () => ({
  syncLabelToGitlab: sync.syncLabelToGitlab,
  removeLabelFromGitlab: sync.removeLabelFromGitlab,
}));

import db, { schema } from "../../apps/api/src/database";
import assignLabelToTask from "../../apps/api/src/label/controllers/assign-label-to-task";
import createLabel from "../../apps/api/src/label/controllers/create-label";
import deleteLabel from "../../apps/api/src/label/controllers/delete-label";
import getLabel from "../../apps/api/src/label/controllers/get-label";
import unassignLabelFromTask from "../../apps/api/src/label/controllers/unassign-label-from-task";
import updateLabel from "../../apps/api/src/label/controllers/update-label";
import bulkUpdateTasks from "../../apps/api/src/task/controllers/bulk-update-tasks";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

async function seed() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const [taskA, taskB] = await db
    .insert(schema.taskTable)
    .values([
      { projectId: project.id, title: "A", number: 1 },
      { projectId: project.id, title: "B", number: 2 },
    ])
    .returning();
  return { owner, project, taskA, taskB };
}

const labelsNamed = (workspaceId: string, name: string) =>
  db
    .select()
    .from(schema.labelTable)
    .where(
      and(
        eq(schema.labelTable.workspaceId, workspaceId),
        eq(schema.labelTable.name, name),
      ),
    );

const loggedMessages = () =>
  errorLog.mock.calls.map((call: unknown[]) => String(call[0]));

describe("label controllers: refusals", () => {
  it("assign answers 404, 409 and 400 for unknown label, label being deleted and foreign label, and writes nothing", async () => {
    const { owner, taskA } = await seed();
    const foreign = await createWorkspaceMember();
    const [mine] = await db
      .insert(schema.labelTable)
      .values({
        name: "Mine",
        color: "#111111",
        workspaceId: owner.workspace.id,
      })
      .returning();
    const [deleting] = await db
      .insert(schema.labelTable)
      .values({
        name: "Dying",
        color: "#222222",
        workspaceId: owner.workspace.id,
        deletionStartedAt: new Date(),
      })
      .returning();
    const [theirs] = await db
      .insert(schema.labelTable)
      .values({
        name: "Theirs",
        color: "#333333",
        workspaceId: foreign.workspace.id,
      })
      .returning();

    await expect(
      assignLabelToTask("nope", taskA.id, owner.user.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      assignLabelToTask(deleting.id, taskA.id, owner.user.id),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      assignLabelToTask(mine.id, "no-task", owner.user.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      assignLabelToTask(theirs.id, taskA.id, owner.user.id),
    ).rejects.toMatchObject({ status: 400 });

    const attached = await db
      .select()
      .from(schema.labelTable)
      .where(eq(schema.labelTable.taskId, taskA.id));
    expect(attached).toHaveLength(0);
    expect(sync.syncLabelToGitHub).not.toHaveBeenCalled();
  });

  it("create answers 404 for a task of another workspace or none, 409 for a label being deleted", async () => {
    const { owner, taskA } = await seed();
    const foreign = await createWorkspaceMember();
    await db.insert(schema.labelTable).values({
      name: "Dying",
      color: "#222222",
      workspaceId: owner.workspace.id,
      deletionStartedAt: new Date(),
    });

    await expect(
      createLabel("X", "#000000", "no-task", owner.workspace.id, owner.user.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createLabel(
        "X",
        "#000000",
        taskA.id,
        foreign.workspace.id,
        foreign.user.id,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createLabel(
        "Dying",
        "#000000",
        undefined,
        owner.workspace.id,
        owner.user.id,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await labelsNamed(owner.workspace.id, "X")).toHaveLength(0);
    expect(await labelsNamed(foreign.workspace.id, "X")).toHaveLength(0);
  });

  it("get, update, delete and unassign answer 404 for an unknown label; unassign needs an attached label on a task of its own workspace", async () => {
    const { owner, taskA } = await seed();
    const other = await createWorkspaceMember();
    await expect(getLabel("nope")).rejects.toMatchObject({ status: 404 });
    await expect(updateLabel("nope", "n", "#000000")).rejects.toMatchObject({
      status: 404,
    });
    await expect(deleteLabel("nope", owner.user.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      unassignLabelFromTask("nope", owner.user.id),
    ).rejects.toMatchObject({ status: 404 });

    const [detached] = await db
      .insert(schema.labelTable)
      .values({
        name: "Free",
        color: "#444444",
        workspaceId: owner.workspace.id,
      })
      .returning();
    await expect(
      unassignLabelFromTask(detached.id, owner.user.id),
    ).rejects.toMatchObject({ status: 400 });

    // A label row claiming another workspace than its task's is not detachable through the task.
    const [mismatched] = await db
      .insert(schema.labelTable)
      .values({
        name: "Mismatch",
        color: "#555555",
        workspaceId: other.workspace.id,
        taskId: taskA.id,
      })
      .returning();
    await expect(
      unassignLabelFromTask(mismatched.id, other.user.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      deleteLabel(mismatched.id, other.user.id),
    ).rejects.toMatchObject({ status: 404 });
    expect(await getLabel(mismatched.id)).toMatchObject({ id: mismatched.id });
  });

  it("update refuses a label whose deletion has started and leaves name and color", async () => {
    const { owner } = await seed();
    const [deleting] = await db
      .insert(schema.labelTable)
      .values({
        name: "Dying",
        color: "#222222",
        workspaceId: owner.workspace.id,
        deletionStartedAt: new Date(),
      })
      .returning();
    await expect(
      updateLabel(deleting.id, "Renamed", "#999999"),
    ).rejects.toMatchObject({ status: 409 });
    expect(await getLabel(deleting.id)).toMatchObject({
      name: "Dying",
      color: "#222222",
    });
  });
});

describe("label controllers: external sync failures are logged, not fatal", () => {
  it("create on a task stores the label once, logs three failing syncs and skips them for a duplicate", async () => {
    const { owner, project, taskA } = await seed();

    const first = await createLabel(
      "Bug",
      "#ff0000",
      taskA.id,
      owner.workspace.id,
      owner.user.id,
    );
    expect(first).toMatchObject({
      name: "Bug",
      color: "#ff0000",
      taskId: taskA.id,
      workspaceId: owner.workspace.id,
    });
    await vi.waitFor(() =>
      expect(loggedMessages()).toEqual(
        expect.arrayContaining([
          "Failed to sync label to GitHub:",
          "Failed to sync label to Gitea:",
          "Failed to sync label to GitLab:",
        ]),
      ),
    );
    expect(sync.syncLabelToGitHub).toHaveBeenCalledWith(
      taskA.id,
      "Bug",
      "#ff0000",
    );

    errorLog.mockClear();
    vi.clearAllMocks();
    const again = await createLabel(
      "Bug",
      "#00ff00",
      taskA.id,
      owner.workspace.id,
      owner.user.id,
    );
    expect(again.id).toBe(first.id);
    expect(again.color).toBe("#ff0000");
    expect(sync.syncLabelToGitHub).not.toHaveBeenCalled();
    expect(project.id).toBeTruthy();
  });

  it("assign copies a workspace label to the task, then moving a task label deletes the old copy and logs failing removals", async () => {
    const { owner, taskA, taskB } = await seed();
    const [workspaceLabel] = await db
      .insert(schema.labelTable)
      .values({
        name: "Docs",
        color: "#123456",
        workspaceId: owner.workspace.id,
      })
      .returning();

    const onA = await assignLabelToTask(
      workspaceLabel.id,
      taskA.id,
      owner.user.id,
    );
    expect(onA).toMatchObject({
      name: "Docs",
      taskId: taskA.id,
      color: "#123456",
    });
    await vi.waitFor(() =>
      expect(loggedMessages()).toContain("Failed to sync label to GitLab:"),
    );

    // Assigning the copy that sits on task A to task B moves it.
    const onB = await assignLabelToTask(onA.id, taskB.id, owner.user.id);
    expect(onB).toMatchObject({ name: "Docs", taskId: taskB.id });
    await vi.waitFor(() =>
      expect(loggedMessages()).toContain("Failed to remove label from GitLab:"),
    );
    expect(sync.removeLabelFromGitHub).toHaveBeenCalledWith(taskA.id, "Docs");
    expect(sync.removeLabelFromGitea).toHaveBeenCalledWith(taskA.id, "Docs");

    const rows = await labelsNamed(owner.workspace.id, "Docs");
    expect(rows.map((r) => r.taskId).sort()).toEqual([null, taskB.id].sort());
  });

  it("assigning a label that already sits on the task changes nothing and calls no sync", async () => {
    const { owner, taskA } = await seed();
    const onA = await createLabel(
      "Dup",
      "#abcdef",
      taskA.id,
      owner.workspace.id,
      owner.user.id,
    );
    vi.clearAllMocks();
    const result = await assignLabelToTask(onA.id, taskA.id, owner.user.id);
    expect(result.id).toBe(onA.id);
    expect(sync.syncLabelToGitHub).not.toHaveBeenCalled();
    expect(sync.removeLabelFromGitHub).not.toHaveBeenCalled();
  });

  it("assigning a workspace label to a task that already has that name returns the existing copy without a sync", async () => {
    const { owner, taskA } = await seed();
    const [workspaceLabel] = await db
      .insert(schema.labelTable)
      .values({
        name: "Twin",
        color: "#654321",
        workspaceId: owner.workspace.id,
      })
      .returning();
    const existing = await createLabel(
      "Twin",
      "#654321",
      taskA.id,
      owner.workspace.id,
      owner.user.id,
    );
    vi.clearAllMocks();

    const result = await assignLabelToTask(
      workspaceLabel.id,
      taskA.id,
      owner.user.id,
    );
    expect(result.id).toBe(existing.id);
    expect(sync.syncLabelToGitHub).not.toHaveBeenCalled();
    expect(
      (await labelsNamed(owner.workspace.id, "Twin")).filter((l) => l.taskId),
    ).toHaveLength(1);
  });

  it("unassign removes the task copy and logs a failing GitHub removal", async () => {
    const { owner, taskA } = await seed();
    const onA = await createLabel(
      "Gone",
      "#0000ff",
      taskA.id,
      owner.workspace.id,
      owner.user.id,
    );
    errorLog.mockClear();

    const removed = await unassignLabelFromTask(onA.id, owner.user.id);
    expect(removed.id).toBe(onA.id);
    await vi.waitFor(() =>
      expect(loggedMessages()).toContain("Failed to remove label from GitHub:"),
    );
    expect(sync.removeLabelFromGitHub).toHaveBeenCalledWith(taskA.id, "Gone");
    expect(await labelsNamed(owner.workspace.id, "Gone")).toHaveLength(0);
  });

  it("bulk removeLabel logs failing code-host removals while still deleting the copies", async () => {
    const { owner, taskA, taskB } = await seed();
    const [workspaceLabel] = await db
      .insert(schema.labelTable)
      .values({
        name: "Bulk",
        color: "#101010",
        workspaceId: owner.workspace.id,
      })
      .returning();
    await db.insert(schema.labelTable).values(
      [taskA, taskB].map((task) => ({
        name: "Bulk",
        color: "#101010",
        workspaceId: owner.workspace.id,
        taskId: task.id,
      })),
    );

    const result = await bulkUpdateTasks({
      taskIds: [taskA.id, taskB.id],
      operation: "removeLabel",
      value: workspaceLabel.id,
      userId: owner.user.id,
    });

    expect(result).toEqual({ success: true, updatedCount: 2 });
    await vi.waitFor(() =>
      expect(loggedMessages()).toContain("Failed to remove label from GitLab:"),
    );
    expect(loggedMessages()).toContain("Failed to remove label from Gitea:");
    expect(
      (await labelsNamed(owner.workspace.id, "Bulk")).filter((l) => l.taskId),
    ).toHaveLength(0);
  });
});
