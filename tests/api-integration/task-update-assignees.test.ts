import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

// A task with two user assignees (first, second) and one resource, set up
// through the real assignees route so the table and task.userId mirror agree.
async function setup() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const first = await addWorkspaceMember(owner.workspace.id, "member");
  const second = await addWorkspaceMember(owner.workspace.id, "member");
  const third = await addWorkspaceMember(owner.workspace.id, "member");
  const { project, columns } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const [resource] = await db
    .insert(schema.resourceTable)
    .values({
      workspaceId: owner.workspace.id,
      kind: "equipment",
      name: "Crane",
    })
    .returning();
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      columnId: columns.todo.id,
      title: "Original",
      description: "Body",
      priority: "medium",
      status: "to-do",
      number: 1,
      position: 1,
    })
    .returning();

  mockAuthenticatedSession(owner.user);
  const { app } = createApp();

  const putJson = (path: string, body: Record<string, unknown>) =>
    app.request(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const assign = await putJson(`/api/task/${task.id}/assignees`, {
    userIds: [first.id, second.id],
    resourceIds: [resource.id],
  });
  expect(assign.status).toBe(200);

  const update = (values: Record<string, unknown>) =>
    putJson(`/api/task/${task.id}`, {
      title: task.title,
      status: task.status,
      priority: task.priority,
      projectId: project.id,
      position: task.position,
      ...values,
    });

  async function readAssignment() {
    const rows = await db
      .select({
        userId: schema.taskAssignmentTable.userId,
        resourceId: schema.taskAssignmentTable.resourceId,
      })
      .from(schema.taskAssignmentTable)
      .where(eq(schema.taskAssignmentTable.taskId, task.id))
      .orderBy(
        asc(schema.taskAssignmentTable.createdAt),
        asc(schema.taskAssignmentTable.id),
      );
    const [row] = await db
      .select({
        userId: schema.taskTable.userId,
        title: schema.taskTable.title,
        dueDate: schema.taskTable.dueDate,
      })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    return {
      primary: row.userId,
      title: row.title,
      dueDate: row.dueDate,
      users: rows.flatMap((r) => (r.userId ? [r.userId] : [])).sort(),
      resources: rows.flatMap((r) => (r.resourceId ? [r.resourceId] : [])),
    };
  }

  return {
    first,
    second,
    third,
    resource,
    task,
    update,
    putJson,
    readAssignment,
  };
}

describe("PUT /api/task/{id} keeps the assignee list", () => {
  it("starts with the primary mirror on the first assignee", async () => {
    const { first, second, resource, readAssignment } = await setup();

    expect(await readAssignment()).toMatchObject({
      primary: first.id,
      users: [first.id, second.id].sort(),
      resources: [resource.id],
    });
  });

  it("keeps every assignee on a title and date update that sends the primary userId", async () => {
    const { first, second, resource, update, readAssignment } = await setup();

    const response = await update({
      title: "Renamed",
      dueDate: "2030-01-15T00:00:00.000Z",
      userId: first.id,
    });

    expect(response.status).toBe(200);
    expect((await response.json()).userId).toBe(first.id);
    expect(await readAssignment()).toMatchObject({
      title: "Renamed",
      primary: first.id,
      users: [first.id, second.id].sort(),
      resources: [resource.id],
    });
  });

  it("leaves the assignees and the primary alone when userId is omitted", async () => {
    const { first, second, resource, update, readAssignment } = await setup();

    const response = await update({
      title: "Renamed again",
      dueDate: "2030-01-15T00:00:00.000Z",
    });

    expect(response.status).toBe(200);
    expect((await response.json()).userId).toBe(first.id);
    const state = await readAssignment();
    expect(state).toMatchObject({
      title: "Renamed again",
      primary: first.id,
      users: [first.id, second.id].sort(),
      resources: [resource.id],
    });
    expect(state.dueDate).toEqual(new Date("2030-01-15T00:00:00.000Z"));
  });

  it("replaces only the previous primary when the primary changes to a new member", async () => {
    const { first, second, third, resource, update, readAssignment } =
      await setup();

    const response = await update({ userId: third.id });

    expect(response.status).toBe(200);
    expect((await response.json()).userId).toBe(third.id);
    const state = await readAssignment();
    expect(state).toMatchObject({
      primary: third.id,
      users: [second.id, third.id].sort(),
      resources: [resource.id],
    });
    expect(state.users).not.toContain(first.id);
  });

  it("promotes an existing secondary assignee without duplicating it", async () => {
    const { first, second, resource, update, readAssignment } = await setup();

    const response = await update({ userId: second.id });

    expect(response.status).toBe(200);
    expect((await response.json()).userId).toBe(second.id);
    const state = await readAssignment();
    expect(state).toMatchObject({
      primary: second.id,
      users: [second.id],
      resources: [resource.id],
    });
    expect(state.users).not.toContain(first.id);
  });

  it.each([
    ["an empty string", ""],
    ["whitespace", "   "],
  ])("unassigns only the primary when userId is %s", async (_label, userId) => {
    const { first, second, resource, update, readAssignment } = await setup();

    const response = await update({ userId });

    expect(response.status).toBe(200);
    // The first remaining user becomes the primary mirror, as everywhere else.
    expect((await response.json()).userId).toBe(second.id);
    const state = await readAssignment();
    expect(state).toMatchObject({
      primary: second.id,
      users: [second.id],
      resources: [resource.id],
    });
    expect(state.users).not.toContain(first.id);
  });

  it("keeps resource assignees when a blank userId is sent for a task without a primary", async () => {
    const { resource, task, putJson, update, readAssignment } = await setup();
    // Resource-only assignment: no user, so no primary assignee.
    const clear = await putJson(`/api/task/${task.id}/assignees`, {
      userIds: [],
      resourceIds: [resource.id],
    });
    expect(clear.status).toBe(200);
    expect(await readAssignment()).toMatchObject({
      primary: null,
      users: [],
      resources: [resource.id],
    });

    // The web client sends "" for a task without a primary assignee.
    const response = await update({ title: "Resource only", userId: "" });

    expect(response.status).toBe(200);
    expect(await readAssignment()).toMatchObject({
      title: "Resource only",
      primary: null,
      users: [],
      resources: [resource.id],
    });
  });

  it("rejects a primary that is not a member of the workspace and persists nothing", async () => {
    const { first, second, resource, update, readAssignment } = await setup();
    const outsider = await createWorkspaceMember({ role: "owner" });

    const response = await update({
      title: "Must not persist",
      userId: outsider.user.id,
    });

    expect(response.status).toBe(403);
    expect(await readAssignment()).toMatchObject({
      title: "Original",
      primary: first.id,
      users: [first.id, second.id].sort(),
      resources: [resource.id],
    });
  });
});
