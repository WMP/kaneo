import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type Assignee = {
  id: string;
  name: string;
};

async function addWorkspaceMember(
  workspaceId: string,
  name: string,
): Promise<Assignee> {
  const userId = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      name,
    })
    .returning();

  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role: "member",
    joinedAt: new Date(),
  });

  return { id: user.id, name };
}

async function insertTask(options: {
  projectId: string;
  columnId: string;
  status: string;
  userId?: string | null;
  startDate?: Date | null;
  dueDate?: Date | null;
  number: number;
}) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: options.projectId,
      columnId: options.columnId,
      status: options.status,
      userId: options.userId ?? null,
      startDate: options.startDate ?? null,
      dueDate: options.dueDate ?? null,
      title: `Task ${options.number}`,
      priority: "medium",
      number: options.number,
      position: options.number,
    })
    .returning();
  return task;
}

describe("API integration: workspace workload", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects unauthenticated requests", async () => {
    mockAnonymousSession();
    const { app } = createApp();

    const response = await app.request(
      "/api/workload/workspace-missing?from=2024-01-01&to=2024-01-21",
    );

    expect(response.status).toBe(401);
  });

  it("rejects a user outside the workspace", async () => {
    const member = await createWorkspaceMember();
    const outsiderId = `user-${randomUUID()}`;
    const [outsider] = await db
      .insert(schema.userTable)
      .values({
        id: outsiderId,
        email: `${outsiderId}@example.com`,
        emailVerified: true,
        name: "Outsider",
      })
      .returning();

    mockAuthenticatedSession(outsider);
    const { app } = createApp();

    const response = await app.request(
      `/api/workload/${member.workspace.id}?from=2024-01-01&to=2024-01-21`,
    );

    expect(response.status).toBe(403);
  });

  it("rejects a malformed date range", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workload/${member.workspace.id}?from=not-a-date&to=2024-01-21`,
    );

    expect(response.status).toBe(400);
  });

  it("rejects `to` before `from`", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workload/${member.workspace.id}?from=2024-01-21&to=2024-01-01`,
    );

    expect(response.status).toBe(400);
  });

  it("aggregates dated, not-done tasks by assignee over weekly buckets", async () => {
    const member = await createWorkspaceMember({ userName: "Alice" });
    const bob = await addWorkspaceMember(member.workspace.id, "Bob");
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    // Alice: a single day in the first bucket...
    await insertTask({
      projectId: project.id,
      columnId: columns.todo.id,
      status: columns.todo.slug,
      userId: member.user.id,
      dueDate: new Date("2024-01-02T00:00:00.000Z"),
      number: 1,
    });
    // ...and a task spanning the boundary between buckets 1 and 2.
    await insertTask({
      projectId: project.id,
      columnId: columns.inProgress.id,
      status: columns.inProgress.slug,
      userId: member.user.id,
      startDate: new Date("2024-01-10T00:00:00.000Z"),
      dueDate: new Date("2024-01-16T00:00:00.000Z"),
      number: 2,
    });
    // Bob: one dated task in the first bucket.
    await insertTask({
      projectId: project.id,
      columnId: columns.todo.id,
      status: columns.todo.slug,
      userId: bob.id,
      dueDate: new Date("2024-01-03T00:00:00.000Z"),
      number: 3,
    });
    // Unassigned: one dated task in the first bucket.
    await insertTask({
      projectId: project.id,
      columnId: columns.inReview.id,
      status: columns.inReview.slug,
      userId: null,
      dueDate: new Date("2024-01-04T00:00:00.000Z"),
      number: 4,
    });
    // Done and dated: must be excluded.
    await insertTask({
      projectId: project.id,
      columnId: columns.done.id,
      status: columns.done.slug,
      userId: member.user.id,
      dueDate: new Date("2024-01-05T00:00:00.000Z"),
      number: 5,
    });
    // Not done but undated: must be excluded.
    await insertTask({
      projectId: project.id,
      columnId: columns.todo.id,
      status: columns.todo.slug,
      userId: member.user.id,
      number: 6,
    });
    // Not done and dated, but outside the requested range: must be excluded.
    await insertTask({
      projectId: project.id,
      columnId: columns.todo.id,
      status: columns.todo.slug,
      userId: member.user.id,
      dueDate: new Date("2025-06-01T00:00:00.000Z"),
      number: 7,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workload/${member.workspace.id}?from=2024-01-01&to=2024-01-21`,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      buckets: { start: string; end: string }[];
      assignees: {
        userId: string | null;
        name: string | null;
        counts: number[];
      }[];
      truncated: boolean;
    };

    expect(payload.truncated).toBe(false);
    // Jan1-8, Jan8-15, Jan15-22.
    expect(payload.buckets).toHaveLength(3);
    expect(payload.buckets[0]).toMatchObject({
      start: "2024-01-01T00:00:00.000Z",
      end: "2024-01-08T00:00:00.000Z",
    });

    expect(payload.assignees).toHaveLength(3);

    const alice = payload.assignees.find(
      (row) => row.userId === member.user.id,
    );
    expect(alice).toMatchObject({ name: "Alice", counts: [1, 1, 1] });

    const bobRow = payload.assignees.find((row) => row.userId === bob.id);
    expect(bobRow).toMatchObject({ name: "Bob", counts: [1, 0, 0] });

    const unassigned = payload.assignees.find((row) => row.userId === null);
    expect(unassigned).toMatchObject({ name: null, counts: [1, 0, 0] });

    // The unassigned row always sorts last.
    expect(payload.assignees.at(-1)?.userId).toBeNull();
  });
});
