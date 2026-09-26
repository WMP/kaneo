import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Covers the audit gap found in review: a full task update (drag/cascade,
// progress, milestone, constraint, and baseline edits) and a task-relation
// create/delete all publish "task.updated"/"task-relation.*" but, before
// this fix, the activity module never subscribed to them — leaving no
// trace in the task's activity feed. See apps/api/src/activity/index.ts.

async function taskFixture() {
  const member = await createWorkspaceMember();
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Original title",
      description: "Schedule activity test task",
      status: "to-do",
      columnId: columns.todo.id,
      priority: "medium",
      number: 1,
      position: 1,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      dueDate: new Date("2026-01-05T00:00:00.000Z"),
      progress: 0,
    })
    .returning();

  return { member, project, columns, task };
}

async function activitiesFor(taskId: string, type: string) {
  return db
    .select()
    .from(schema.activityTable)
    .where(
      and(
        eq(schema.activityTable.taskId, taskId),
        eq(schema.activityTable.type, type),
      ),
    );
}

describe("API integration: task schedule/plan activity", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("logs an 'updated' activity with a changes diff for a full task update (dates + progress)", async () => {
    const { member, project, task } = await taskFixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: task.title,
        status: task.status,
        projectId: project.id,
        priority: task.priority,
        position: task.position,
        startDate: "2026-01-10T00:00:00.000Z",
        dueDate: "2026-01-15T00:00:00.000Z",
        progress: 42,
      }),
    });

    expect(response.status).toBe(200);

    const activities = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.taskId, task.id));

    const updated = activities.filter(
      (activity) => activity.type === "updated",
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      taskId: task.id,
      userId: member.user.id,
      type: "updated",
    });
    const changes = updated[0]?.eventData as {
      changes: Record<string, { from: unknown; to: unknown }>;
    };
    expect(changes.changes.startDate).toEqual({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-10T00:00:00.000Z",
    });
    expect(changes.changes.dueDate).toEqual({
      from: "2026-01-05T00:00:00.000Z",
      to: "2026-01-15T00:00:00.000Z",
    });
    expect(changes.changes.progress).toEqual({ from: 0, to: 42 });
  });

  it("does not log an 'updated' activity when nothing schedule-related changed", async () => {
    const { member, project, task } = await taskFixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "A different title only",
        status: task.status,
        projectId: project.id,
        priority: task.priority,
        position: task.position,
        startDate: task.startDate?.toISOString(),
        dueDate: task.dueDate?.toISOString(),
        progress: task.progress,
      }),
    });

    expect(response.status).toBe(200);

    const updated = await activitiesFor(task.id, "updated");
    expect(updated).toHaveLength(0);
  });

  it("logs a 'relation_created' activity on the source task for POST /task-relation", async () => {
    const { member, project, task } = await taskFixture();
    const { columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [otherTask] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Blocked task",
        status: "to-do",
        columnId: columns.todo.id,
        number: 2,
        position: 2,
      })
      .returning();
    if (!otherTask) throw new Error("Expected the second task to be seeded");

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/task-relation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceTaskId: task.id,
        targetTaskId: otherTask.id,
        relationType: "blocks",
        dependencyType: "fs",
        lagDays: 1,
      }),
    });

    expect(response.status).toBe(200);

    const created = await activitiesFor(task.id, "relation_created");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      taskId: task.id,
      userId: member.user.id,
      type: "relation_created",
      eventData: {
        relationType: "blocks",
        sourceTaskId: task.id,
        targetTaskId: otherTask.id,
        dependencyType: "fs",
        lagDays: 1,
      },
    });
  });

  it("logs a 'relation_deleted' activity on the source task for DELETE /task-relation/{id}", async () => {
    const { member, project, task } = await taskFixture();
    const { columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [otherTask] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Blocked task",
        status: "to-do",
        columnId: columns.todo.id,
        number: 2,
        position: 2,
      })
      .returning();
    if (!otherTask) throw new Error("Expected the second task to be seeded");

    const [relation] = await db
      .insert(schema.taskRelationTable)
      .values({
        sourceTaskId: task.id,
        targetTaskId: otherTask.id,
        relationType: "blocks",
      })
      .returning();
    if (!relation) throw new Error("Expected the relation to be seeded");

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task-relation/${relation.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);

    const deleted = await activitiesFor(task.id, "relation_deleted");
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({
      taskId: task.id,
      userId: member.user.id,
      type: "relation_deleted",
      eventData: {
        relationType: "blocks",
        sourceTaskId: task.id,
        targetTaskId: otherTask.id,
      },
    });
  });

  it("logs exactly one 'relation_created' activity when the relation spans two projects", async () => {
    const { member, task } = await taskFixture();
    const { project: otherProject, columns: otherColumns } =
      await createProjectFixture({ workspaceId: member.workspace.id });
    const [otherTask] = await db
      .insert(schema.taskTable)
      .values({
        projectId: otherProject.id,
        title: "Cross-project task",
        status: "to-do",
        columnId: otherColumns.todo.id,
        number: 1,
        position: 1,
      })
      .returning();
    if (!otherTask) throw new Error("Expected the second task to be seeded");

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/task-relation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceTaskId: task.id,
        targetTaskId: otherTask.id,
        relationType: "related",
      }),
    });

    expect(response.status).toBe(200);

    // The event is published twice (once per project, so each project's WS
    // subscribers refresh) but must only ever be logged once.
    const created = await activitiesFor(task.id, "relation_created");
    expect(created).toHaveLength(1);
  });
});
