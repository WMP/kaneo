import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function fixture() {
  const member = await createWorkspaceMember();
  const otherMember = await createWorkspaceMember({
    workspaceName: member.workspace.name,
  });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: member.workspace.id,
    userId: otherMember.user.id,
    role: "member",
    joinedAt: new Date(),
  });

  const { project } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });

  const [taskA, taskB] = await db
    .insert(schema.taskTable)
    .values([
      {
        id: "activity-task-a",
        projectId: project.id,
        title: "First task",
        number: 1,
        status: "to-do",
        priority: "medium",
      },
      {
        id: "activity-task-b",
        projectId: project.id,
        title: "Second task",
        number: 2,
        status: "to-do",
        priority: "medium",
      },
    ])
    .returning();

  await db.insert(schema.activityTable).values([
    {
      id: "activity-1",
      taskId: taskA.id,
      type: "status_changed",
      userId: member.user.id,
      content: null,
      eventData: { oldStatus: "to-do", newStatus: "in-progress" },
      createdAt: new Date("2024-01-01T00:00:00Z"),
    },
    {
      id: "activity-2",
      taskId: taskB.id,
      type: "comment",
      userId: otherMember.user.id,
      content: "Looks good",
      createdAt: new Date("2024-02-01T00:00:00Z"),
    },
    {
      id: "activity-3",
      taskId: taskA.id,
      type: "priority_changed",
      userId: member.user.id,
      content: null,
      eventData: { oldPriority: "low", newPriority: "high" },
      createdAt: new Date("2024-03-01T00:00:00Z"),
    },
  ]);

  return { member, otherMember, project, taskA, taskB };
}

describe("API integration: workspace activity", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lists activity across every task in the workspace, newest first", async () => {
    const { member, project } = await fixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity`,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.pagination).toMatchObject({
      total: 3,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });
    expect(payload.data.map((a: { id: string }) => a.id)).toEqual([
      "activity-3",
      "activity-2",
      "activity-1",
    ]);
    expect(payload.data[0]).toMatchObject({
      id: "activity-3",
      taskId: "activity-task-a",
      taskTitle: "First task",
      taskNumber: 1,
      projectId: project.id,
      projectName: project.name,
      userId: member.user.id,
      userName: member.user.name,
      type: "priority_changed",
    });
  });

  it("filters by user", async () => {
    const { member, otherMember } = await fixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity?userId=${otherMember.user.id}`,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.pagination.total).toBe(1);
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({
      id: "activity-2",
      userId: otherMember.user.id,
    });
  });

  it("filters by activity type", async () => {
    const { member } = await fixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity?type=status_changed`,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].id).toBe("activity-1");
  });

  it("filters by a created-at date range", async () => {
    const { member } = await fixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity?from=2024-01-15T00:00:00Z&to=2024-02-15T00:00:00Z`,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.map((a: { id: string }) => a.id)).toEqual([
      "activity-2",
    ]);
  });

  it("paginates results", async () => {
    const { member } = await fixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity?limit=1&page=2`,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.pagination).toMatchObject({
      total: 3,
      page: 2,
      pageSize: 1,
      totalPages: 3,
    });
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].id).toBe("activity-2");
  });

  it("rejects a user with no access to the workspace", async () => {
    const { member } = await fixture();
    const outsider = await createWorkspaceMember();

    mockAuthenticatedSession(outsider.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity`,
    );

    expect(response.status).toBe(403);
  });

  it("rejects a custom role without task:read permission", async () => {
    const { member } = await fixture();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: member.workspace.id,
      role: "restricted",
      permission: JSON.stringify({}),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "restricted" })
      .where(eq(schema.workspaceUserTable.userId, member.user.id));

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity`,
    );

    expect(response.status).toBe(403);
  });
});
