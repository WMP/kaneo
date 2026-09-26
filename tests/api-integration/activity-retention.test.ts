import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  deleteExpiredActivity,
  enforceActivityRetention,
} from "../../apps/api/src/scheduler/activity-retention";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedTask(workspaceId: string) {
  const { project, columns } = await createProjectFixture({ workspaceId });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Integration task",
      columnId: columns.todo.id,
    })
    .returning();
  return task;
}

async function insertTaskActivity(
  taskId: string,
  userId: string,
  createdAt: Date,
) {
  const [activity] = await db
    .insert(schema.activityTable)
    .values({ taskId, type: "comment", userId, content: "hi", createdAt })
    .returning();
  return activity;
}

async function insertWorkspaceActivity(
  workspaceId: string,
  userId: string,
  createdAt: Date,
) {
  const [activity] = await db
    .insert(schema.activityTable)
    .values({
      workspaceId,
      type: "holiday_added",
      userId,
      createdAt,
    })
    .returning();
  return activity;
}

describe("API integration: activity retention", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("deletes task-scoped activity older than the cutoff and keeps newer rows", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const task = await seedTask(owner.workspace.id);

    const old = await insertTaskActivity(
      task.id,
      owner.user.id,
      new Date(Date.now() - 40 * DAY_MS),
    );
    const recent = await insertTaskActivity(
      task.id,
      owner.user.id,
      new Date(Date.now() - 2 * DAY_MS),
    );

    const deletedCount = await deleteExpiredActivity(owner.workspace.id, 30);
    expect(deletedCount).toBe(1);

    const remaining = await db
      .select({ id: schema.activityTable.id })
      .from(schema.activityTable);
    const remainingIds = remaining.map((row) => row.id);
    expect(remainingIds).not.toContain(old.id);
    expect(remainingIds).toContain(recent.id);
  });

  it("deletes workspace-level (calendar) activity older than the cutoff and keeps newer rows", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });

    const old = await insertWorkspaceActivity(
      owner.workspace.id,
      owner.user.id,
      new Date(Date.now() - 40 * DAY_MS),
    );
    const recent = await insertWorkspaceActivity(
      owner.workspace.id,
      owner.user.id,
      new Date(Date.now() - 2 * DAY_MS),
    );

    const deletedCount = await deleteExpiredActivity(owner.workspace.id, 30);
    expect(deletedCount).toBe(1);

    const remaining = await db
      .select({ id: schema.activityTable.id })
      .from(schema.activityTable);
    const remainingIds = remaining.map((row) => row.id);
    expect(remainingIds).not.toContain(old.id);
    expect(remainingIds).toContain(recent.id);
  });

  it("never deletes another workspace's activity", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const other = await createWorkspaceMember({ role: "owner" });

    const otherOld = await insertWorkspaceActivity(
      other.workspace.id,
      other.user.id,
      new Date(Date.now() - 40 * DAY_MS),
    );

    const deletedCount = await deleteExpiredActivity(owner.workspace.id, 30);
    expect(deletedCount).toBe(0);

    const remaining = await db
      .select({ id: schema.activityTable.id })
      .from(schema.activityTable)
      .where(eq(schema.activityTable.id, otherOld.id));
    expect(remaining).toHaveLength(1);
  });

  it("leaves activity untouched when retention is unset (enforceActivityRetention)", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const task = await seedTask(owner.workspace.id);

    const old = await insertTaskActivity(
      task.id,
      owner.user.id,
      new Date(Date.now() - 400 * DAY_MS),
    );

    // activityRetentionDays defaults to null (keep forever).
    await expect(enforceActivityRetention()).resolves.toEqual({
      degraded: false,
    });

    const remaining = await db
      .select({ id: schema.activityTable.id })
      .from(schema.activityTable)
      .where(eq(schema.activityTable.id, old.id));
    expect(remaining).toHaveLength(1);
  });

  it("leaves activity untouched when retention is set to zero", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const task = await seedTask(owner.workspace.id);

    await db
      .update(schema.workspaceTable)
      .set({ activityRetentionDays: 0 })
      .where(eq(schema.workspaceTable.id, owner.workspace.id));

    const old = await insertTaskActivity(
      task.id,
      owner.user.id,
      new Date(Date.now() - 400 * DAY_MS),
    );

    await enforceActivityRetention();

    const remaining = await db
      .select({ id: schema.activityTable.id })
      .from(schema.activityTable)
      .where(eq(schema.activityTable.id, old.id));
    expect(remaining).toHaveLength(1);
  });

  it("enforceActivityRetention deletes expired activity when retention is set", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const task = await seedTask(owner.workspace.id);

    await db
      .update(schema.workspaceTable)
      .set({ activityRetentionDays: 30 })
      .where(eq(schema.workspaceTable.id, owner.workspace.id));

    const old = await insertTaskActivity(
      task.id,
      owner.user.id,
      new Date(Date.now() - 40 * DAY_MS),
    );
    const recent = await insertTaskActivity(
      task.id,
      owner.user.id,
      new Date(Date.now() - 2 * DAY_MS),
    );

    await expect(enforceActivityRetention()).resolves.toEqual({
      degraded: false,
    });

    const remaining = await db
      .select({ id: schema.activityTable.id })
      .from(schema.activityTable);
    const remainingIds = remaining.map((row) => row.id);
    expect(remainingIds).not.toContain(old.id);
    expect(remainingIds).toContain(recent.id);
  });
});
