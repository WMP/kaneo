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
        id: "export-task-a",
        projectId: project.id,
        title: "First task",
        number: 1,
        status: "to-do",
        priority: "medium",
      },
      {
        id: "export-task-b",
        projectId: project.id,
        title: 'Second task, "quoted"',
        number: 2,
        status: "to-do",
        priority: "medium",
      },
    ])
    .returning();

  await db.insert(schema.activityTable).values([
    {
      id: "export-activity-1",
      taskId: taskA.id,
      type: "status_changed",
      userId: member.user.id,
      content: null,
      eventData: { oldStatus: "to-do", newStatus: "in-progress" },
      createdAt: new Date("2024-01-01T00:00:00Z"),
    },
    {
      id: "export-activity-2",
      taskId: taskB.id,
      type: "comment",
      userId: otherMember.user.id,
      content: "Looks good,\nthanks!",
      createdAt: new Date("2024-02-01T00:00:00Z"),
    },
    {
      id: "export-activity-3",
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

describe("API integration: workspace activity export", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("exports activity as CSV by default, newest first", async () => {
    const { member } = await fixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity/export`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(response.headers.get("X-Kaneo-Export-Truncated")).toBe("false");

    const csv = await response.text();
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");

    expect(lines[0]).toBe(
      "id,taskId,taskNumber,taskTitle,projectId,projectName,projectSlug,type,createdAt,userId,userName,content,eventData,externalUserName,externalUserAvatar,externalSource,externalUrl",
    );
    // Newest first, matching the listing endpoint's order.
    expect(lines[1]).toContain("export-activity-3");
    expect(lines[2]).toContain("export-activity-2");
    expect(lines[3]).toContain("export-activity-1");

    // A quoted, comma-free title still round-trips; the embedded newline in
    // activity-2's comment is quoted per RFC 4180.
    expect(lines[2]).toContain('"Looks good,\nthanks!"');
  });

  it("exports activity as JSON when format=json", async () => {
    const { member, project } = await fixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity/export?format=json`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");

    const payload = await response.json();
    expect(payload.truncated).toBe(false);
    expect(payload.data).toHaveLength(3);
    expect(payload.data[0]).toMatchObject({
      id: "export-activity-3",
      taskId: "export-task-a",
      projectId: project.id,
      type: "priority_changed",
    });
  });

  it("applies the same filters as the listing endpoint", async () => {
    const { member, otherMember } = await fixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const byUser = await app.request(
      `/api/workspace/${member.workspace.id}/activity/export?format=json&userId=${otherMember.user.id}`,
    );
    expect(byUser.status).toBe(200);
    const byUserPayload = await byUser.json();
    expect(byUserPayload.data).toHaveLength(1);
    expect(byUserPayload.data[0].id).toBe("export-activity-2");

    const byType = await app.request(
      `/api/workspace/${member.workspace.id}/activity/export?format=json&type=status_changed`,
    );
    expect(byType.status).toBe(200);
    const byTypePayload = await byType.json();
    expect(byTypePayload.data).toHaveLength(1);
    expect(byTypePayload.data[0].id).toBe("export-activity-1");

    const byRange = await app.request(
      `/api/workspace/${member.workspace.id}/activity/export?format=json&from=2024-01-15T00:00:00Z&to=2024-02-15T00:00:00Z`,
    );
    expect(byRange.status).toBe(200);
    const byRangePayload = await byRange.json();
    expect(byRangePayload.data.map((a: { id: string }) => a.id)).toEqual([
      "export-activity-2",
    ]);
  });

  it("rejects a user with no access to the workspace", async () => {
    const { member } = await fixture();
    const outsider = await createWorkspaceMember();

    mockAuthenticatedSession(outsider.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity/export`,
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
      `/api/workspace/${member.workspace.id}/activity/export`,
    );

    expect(response.status).toBe(403);
  });

  it("rejects an invalid format value", async () => {
    const { member } = await fixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity/export?format=xml`,
    );

    expect(response.status).toBe(400);
  });
});
