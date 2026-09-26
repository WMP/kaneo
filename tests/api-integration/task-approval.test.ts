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

async function createTaskFixture() {
  const member = await createWorkspaceMember();
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Cutover approval gate",
      description: "Approval gate test task",
      status: "to-do",
      columnId: columns.todo.id,
      priority: "medium",
      number: 1,
      position: 1,
    })
    .returning();

  return { member, project, task };
}

describe("API integration: task approval gate", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("defaults a new task's approval status to none with no note", async () => {
    const { task } = await createTaskFixture();

    expect(task.approvalStatus).toBe("none");
    expect(task.approvalNote).toBeNull();
  });

  it("updates approval status and note through the focused endpoint", async () => {
    const { member, task } = await createTaskFixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/approval/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approvalStatus: "pending",
        approvalNote: "Waiting on client sign-off before cutover",
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      id: string;
      approvalStatus: string;
      approvalNote: string | null;
    };

    expect(payload).toMatchObject({
      id: task.id,
      approvalStatus: "pending",
      approvalNote: "Waiting on client sign-off before cutover",
    });

    const persistedTask = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, task.id),
    });
    expect(persistedTask?.approvalStatus).toBe("pending");
    expect(persistedTask?.approvalNote).toBe(
      "Waiting on client sign-off before cutover",
    );

    const activities = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.taskId, task.id));
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      taskId: task.id,
      userId: member.user.id,
      type: "approval_changed",
      eventData: {
        oldApprovalStatus: "none",
        newApprovalStatus: "pending",
        approvalNote: "Waiting on client sign-off before cutover",
      },
    });
  });

  it("rejects an unknown approval status", async () => {
    const { member, task } = await createTaskFixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/approval/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalStatus: "waiting-forever" }),
    });

    expect(response.status).toBe(400);
  });

  it("does not create activity when the approval status is unchanged", async () => {
    const { member, task } = await createTaskFixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/approval/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalStatus: "none" }),
    });

    expect(response.status).toBe(200);
    const activities = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.taskId, task.id));
    expect(activities).toHaveLength(0);
  });

  it("preserves approval status and note through the full task update route when omitted", async () => {
    const { member, task } = await createTaskFixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    await app.request(`/api/task/approval/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approvalStatus: "rejected",
        approvalNote: "Client asked for another round",
      }),
    });

    const response = await app.request(`/api/task/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Renamed while gate stays rejected",
        priority: "medium",
        status: "to-do",
        projectId: task.projectId,
        position: task.position ?? 1,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      approvalStatus: "rejected",
      approvalNote: "Client asked for another round",
    });
  });

  it("updates approval status and note together through the full task update route", async () => {
    const { member, task } = await createTaskFixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: task.title,
        priority: "medium",
        status: "to-do",
        projectId: task.projectId,
        position: task.position ?? 1,
        approvalStatus: "approved",
        approvalNote: null,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      approvalStatus: "approved",
      approvalNote: null,
    });

    const activities = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.taskId, task.id));
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ type: "approval_changed" });
  });

  it("surfaces the approval status on the linked task summary for a blocks relation", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [gateTask] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Client sign-off",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "high",
        number: 1,
        position: 1,
        approvalStatus: "pending",
      })
      .returning();
    const [blockedTask] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Cutover",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "high",
        number: 2,
        position: 2,
      })
      .returning();
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: gateTask.id,
      targetTaskId: blockedTask.id,
      relationType: "blocks",
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task-relation/${blockedTask.id}`, {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const relations = (await response.json()) as Array<{
      relationType: string;
      sourceTask: { id: string; approvalStatus: string } | null;
    }>;

    const blocksRelation = relations.find(
      (rel) => rel.relationType === "blocks",
    );
    expect(blocksRelation?.sourceTask).toMatchObject({
      id: gateTask.id,
      approvalStatus: "pending",
    });
  });
});
