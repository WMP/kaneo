import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const { syncGithub, syncGitea, syncGitlab, publish } = vi.hoisted(() => ({
  syncGithub: vi.fn(async () => undefined),
  syncGitea: vi.fn(async () => undefined),
  syncGitlab: vi.fn(async () => undefined),
  publish: vi.fn(async () => undefined),
}));
vi.mock("../../apps/api/src/plugins/github/utils/sync-label-to-github", () => ({
  syncLabelToGitHub: syncGithub,
  removeLabelFromGitHub: vi.fn(async () => undefined),
}));
vi.mock("../../apps/api/src/plugins/gitea/utils/sync-label-to-gitea", () => ({
  syncLabelToGitea: syncGitea,
  removeLabelFromGitea: vi.fn(async () => undefined),
}));
vi.mock("../../apps/api/src/plugins/gitlab/utils/sync-label-to-gitlab", () => ({
  syncLabelToGitlab: syncGitlab,
  removeLabelFromGitlab: vi.fn(async () => undefined),
}));
vi.mock("../../apps/api/src/events", async (original) => ({
  ...(await original<object>()),
  publishEvent: publish,
}));

async function context(role = "member") {
  const member = await createWorkspaceMember({ role });
  const { project } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      title: "Synthetic task",
      projectId: project.id,
      number: 1,
    })
    .returning();
  return { ...member, project, task };
}
function attach(labelId: string, taskId: string) {
  return createApp().app.request(`/api/label/${labelId}/task`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId }),
  });
}
async function workspaceLabel(workspaceId: string) {
  const [row] = await db
    .insert(schema.labelTable)
    .values({
      workspaceId,
      taskId: null,
      name: "bug",
      color: "#ff0000",
    })
    .returning();
  return row;
}
async function labelRows() {
  return (await db.select().from(schema.labelTable)).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}
function expectNoSideEffects() {
  expect(syncGithub).not.toHaveBeenCalled();
  expect(syncGitea).not.toHaveBeenCalled();
  expect(syncGitlab).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
}

describe("label assignment bounds", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    vi.clearAllMocks();
  });

  it("attaches a workspace label to a task of the same workspace", async () => {
    const own = await context();
    const label = await workspaceLabel(own.workspace.id);
    mockAuthenticatedSession(own.user);

    const response = await attach(label.id, own.task.id);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      workspaceId: own.workspace.id,
      taskId: own.task.id,
      name: "bug",
      color: "#ff0000",
    });
    // The workspace label stays; the task gets its own copy.
    const rows = await labelRows();
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(label);
    expect(rows.filter((row) => row.taskId === own.task.id)).toHaveLength(1);
    expect(syncGithub).toHaveBeenCalledWith(own.task.id, "bug", "#ff0000");
    expect(publish).toHaveBeenCalledWith(
      "task.label_assigned",
      expect.objectContaining({ taskId: own.task.id, userId: own.user.id }),
    );
  });

  it("rejects a label of the caller's workspace paired with a task of another workspace", async () => {
    const own = await context();
    const foreign = await context();
    const label = await workspaceLabel(own.workspace.id);
    mockAuthenticatedSession(own.user);
    const before = await labelRows();

    const response = await attach(label.id, foreign.task.id);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "Label and task must belong to the same workspace",
    );
    expect(await labelRows()).toEqual(before);
    expect(before).toEqual([label]);
    expectNoSideEffects();
  });

  it("rejects a label of a workspace the caller is not a member of", async () => {
    const own = await context();
    const foreign = await context();
    const label = await workspaceLabel(foreign.workspace.id);
    mockAuthenticatedSession(own.user);
    const before = await labelRows();

    const response = await attach(label.id, foreign.task.id);

    expect(response.status).toBe(403);
    expect(await response.text()).toBe(
      "You don't have access to this workspace",
    );
    expect(await labelRows()).toEqual(before);
    expect(before).toEqual([label]);
    expectNoSideEffects();
  });

  it("rejects a viewer of the same workspace", async () => {
    const own = await context();
    const viewer = await addWorkspaceMember(own.workspace.id, "viewer");
    // Project access alone must not be enough: the role lacks label:update.
    await addProjectMember(own.project.id, viewer.id, "viewer");
    const label = await workspaceLabel(own.workspace.id);
    mockAuthenticatedSession(viewer);
    const before = await labelRows();

    const response = await attach(label.id, own.task.id);

    expect(response.status).toBe(403);
    expect(await labelRows()).toEqual(before);
    expect(before).toEqual([label]);
    expectNoSideEffects();

    // The same request from a member proves the setup is otherwise valid.
    mockAuthenticatedSession(own.user);
    expect((await attach(label.id, own.task.id)).status).toBe(200);
  });

  it("rejects a nonexistent task without persisting anything", async () => {
    const own = await context();
    const label = await workspaceLabel(own.workspace.id);
    mockAuthenticatedSession(own.user);
    const before = await labelRows();

    const response = await attach(label.id, "missing-task");

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Task not found");
    expect(await labelRows()).toEqual(before);
    expect(before).toEqual([label]);
    expectNoSideEffects();
  });
});
