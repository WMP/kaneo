import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { publishEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import updateTimeEntry from "../../apps/api/src/time-entry/controllers/update-time-entry";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

async function seed() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId: project.id, title: "T", number: 1 })
    .returning();
  return { owner, project, task };
}

function send(method: string, path: string, body?: unknown) {
  return createApp().app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const activitiesOf = (taskId: string) =>
  db
    .select()
    .from(schema.activityTable)
    .where(eq(schema.activityTable.taskId, taskId));

describe("time entry update route", () => {
  async function seedEntry() {
    const ctx = await seed();
    const [entry] = await db
      .insert(schema.timeEntryTable)
      .values({
        taskId: ctx.task.id,
        userId: ctx.owner.user.id,
        startTime: new Date("2026-01-01T09:00:00.000Z"),
        endTime: new Date("2026-01-01T10:00:00.000Z"),
        duration: 3600,
        description: "before",
      })
      .returning();
    return { ...ctx, entry };
  }
  const stored = (id: string) =>
    db.query.timeEntryTable.findFirst({
      where: eq(schema.timeEntryTable.id, id),
    });

  it("recomputes the duration in seconds from the new range and updates the description", async () => {
    const { owner, entry } = await seedEntry();
    mockAuthenticatedSession(owner.user);

    const response = await send("PUT", `/api/time-entry/${entry.id}`, {
      startTime: "2026-01-01T09:00:00Z",
      endTime: "2026-01-01T11:30:00Z",
      description: "after",
    });

    expect(response.status).toBe(200);
    expect(await stored(entry.id)).toMatchObject({
      duration: 9000,
      description: "after",
    });
    expect((await stored(entry.id))?.endTime?.toISOString()).toBe(
      "2026-01-01T11:30:00.000Z",
    );
  });

  it("keeps the stored end time when none is sent and leaves the description alone", async () => {
    const { owner, entry } = await seedEntry();
    mockAuthenticatedSession(owner.user);

    const response = await send("PUT", `/api/time-entry/${entry.id}`, {
      startTime: "2026-01-01T09:30:00Z",
    });

    expect(response.status).toBe(200);
    expect(await stored(entry.id)).toMatchObject({
      duration: 1800,
      description: "before",
    });
  });

  it("refuses a range that ends before it starts and changes nothing", async () => {
    const { owner, entry } = await seedEntry();
    mockAuthenticatedSession(owner.user);

    const response = await send("PUT", `/api/time-entry/${entry.id}`, {
      startTime: "2026-01-01T12:00:00Z",
      endTime: "2026-01-01T11:00:00Z",
    });

    expect(response.status).toBe(400);
    expect(await stored(entry.id)).toMatchObject({
      duration: 3600,
      description: "before",
    });
  });

  it("refuses an outsider and a viewer, and a controller call for a missing entry is a 404", async () => {
    const { owner, project, entry } = await seedEntry();
    const outsider = await createWorkspaceMember({ role: "owner" });
    const viewer = await addWorkspaceMember(owner.workspace.id, "viewer");
    const body = {
      startTime: "2026-01-01T09:00:00Z",
      endTime: "2026-01-01T09:10:00Z",
    };

    mockAuthenticatedSession(outsider.user);
    expect(
      (await send("PUT", `/api/time-entry/${entry.id}`, body)).status,
    ).toBe(403);
    mockAuthenticatedSession(viewer);
    expect(
      (await send("PUT", `/api/time-entry/${entry.id}`, body)).status,
    ).toBe(403);
    expect((await stored(entry.id))?.duration).toBe(3600);
    expect(project.id).toBeTruthy();

    await expect(
      updateTimeEntry({ timeEntryId: "missing", startTime: new Date() }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("comment update and delete routes", () => {
  async function seedComment() {
    const ctx = await seed();
    const colleague = await addWorkspaceMember(
      ctx.owner.workspace.id,
      "member",
    );
    await db.insert(schema.projectMemberTable).values({
      projectId: ctx.project.id,
      userId: colleague.id,
      role: "member",
    });
    const [comment] = await db
      .insert(schema.activityTable)
      .values({
        taskId: ctx.task.id,
        userId: ctx.owner.user.id,
        type: "comment",
        content: "original",
      })
      .returning();
    return { ...ctx, colleague, comment };
  }

  it("only the author can edit; someone else gets 404 and the text is unchanged", async () => {
    const { owner, colleague, comment } = await seedComment();

    mockAuthenticatedSession(colleague);
    const denied = await send("PUT", "/api/activity/comment", {
      activityId: comment.id,
      comment: "hijack",
    });
    expect(denied.status).toBe(404);
    expect((await activitiesOf(comment.taskId as string))[0]?.content).toBe(
      "original",
    );

    mockAuthenticatedSession(owner.user);
    const ok = await send("PUT", "/api/activity/comment", {
      activityId: comment.id,
      comment: "edited",
    });
    expect(ok.status).toBe(200);
    expect((await activitiesOf(comment.taskId as string))[0]?.content).toBe(
      "edited",
    );
  });

  it("only the author can delete; the author's delete removes the row and returns it", async () => {
    const { owner, colleague, comment } = await seedComment();

    mockAuthenticatedSession(colleague);
    const denied = await send("DELETE", "/api/activity/comment", {
      activityId: comment.id,
    });
    expect(denied.status).toBe(404);
    expect(await activitiesOf(comment.taskId as string)).toHaveLength(1);

    mockAuthenticatedSession(owner.user);
    const ok = await send("DELETE", "/api/activity/comment", {
      activityId: comment.id,
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      id: comment.id,
      taskId: comment.taskId,
    });
    expect(await activitiesOf(comment.taskId as string)).toHaveLength(0);

    const again = await send("DELETE", "/api/activity/comment", {
      activityId: comment.id,
    });
    expect(again.status).toBe(400);
  });

  it("a non-comment activity cannot be deleted through the comment route", async () => {
    const { owner, task } = await seed();
    const [row] = await db
      .insert(schema.activityTable)
      .values({
        taskId: task.id,
        userId: owner.user.id,
        type: "status_changed",
        content: "x",
      })
      .returning();
    mockAuthenticatedSession(owner.user);

    const response = await send("DELETE", "/api/activity/comment", {
      activityId: row.id,
    });

    expect(response.status).toBe(404);
    expect(await activitiesOf(task.id)).toHaveLength(1);
  });

  it("the activity feed collapses blank lines of system messages but leaves comments verbatim", async () => {
    const { owner, task } = await seed();
    await db.insert(schema.activityTable).values([
      {
        taskId: task.id,
        userId: owner.user.id,
        type: "created",
        content: "a\n\n\nb",
      },
      {
        taskId: task.id,
        userId: owner.user.id,
        type: "comment",
        content: "c\n\n\nd",
      },
    ]);
    mockAuthenticatedSession(owner.user);

    const response = await send("GET", `/api/activity/${task.id}`);
    const rows = (await response.json()) as Array<{
      type: string;
      content: string;
    }>;

    expect(response.status).toBe(200);
    expect(rows.find((r) => r.type === "created")?.content).toBe("a\nb");
    expect(rows.find((r) => r.type === "comment")?.content).toBe("c\n\n\nd");
  });
});

describe("activity event subscribers", () => {
  const publish = (type: string, data: Record<string, unknown>) =>
    publishEvent(type, data, { waitForHandlers: true });

  it("task.created records an activity only when the actor, task and type are all present", async () => {
    const { owner, task } = await seed();
    await publish("task.created", { taskId: task.id, type: "task" });
    await publish("task.created", {
      taskId: task.id,
      currentUserId: owner.user.id,
    });
    expect(await activitiesOf(task.id)).toHaveLength(0);

    await publish("task.created", {
      taskId: task.id,
      currentUserId: owner.user.id,
      type: "task",
    });
    const rows = await activitiesOf(task.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "task", userId: owner.user.id });
  });

  it("task.due_date_changed stores ISO strings and keeps a null previous date", async () => {
    const { owner, task } = await seed();
    await publish("task.due_date_changed", {
      taskId: task.id,
      userId: owner.user.id,
      type: "due_date_changed",
      title: "T",
      oldDueDate: null,
      newDueDate: new Date("2026-05-06T07:08:09.000Z"),
    });
    const [row] = await activitiesOf(task.id);
    expect(row?.eventData).toEqual({
      oldDueDate: null,
      newDueDate: "2026-05-06T07:08:09.000Z",
    });
  });

  it("task.updated needs a non-empty change set", async () => {
    const { owner, task } = await seed();
    await publish("task.updated", { taskId: task.id, userId: owner.user.id });
    await publish("task.updated", {
      taskId: task.id,
      userId: owner.user.id,
      changes: {},
    });
    await publish("task.updated", {
      taskId: task.id,
      changes: { progress: { from: 0, to: 5 } },
    });
    expect(await activitiesOf(task.id)).toHaveLength(0);

    await publish("task.updated", {
      taskId: task.id,
      userId: owner.user.id,
      changes: { progress: { from: 0, to: 5 } },
    });
    const [row] = await activitiesOf(task.id);
    expect(row).toMatchObject({
      type: "updated",
      eventData: { changes: { progress: { from: 0, to: 5 } } },
    });
  });

  it.each([
    ["task-relation.created", "relation_created"],
    ["task-relation.updated", "relation_updated"],
    ["task-relation.deleted", "relation_deleted"],
  ])(
    "%s logs once for the source task and ignores the secondary notification and incomplete events",
    async (eventType, activityType) => {
      const { owner, task } = await seed();
      const base = {
        taskId: task.id,
        userId: owner.user.id,
        sourceTaskId: task.id,
        targetTaskId: "other",
        relationType: "blocks",
      };

      await publish(eventType, {
        ...base,
        id: "rel-1",
        secondaryNotification: true,
      });
      await publish(eventType, { ...base, id: "" });
      await publish(eventType, { ...base, id: "rel-1", userId: undefined });
      expect(await activitiesOf(task.id)).toHaveLength(0);

      await publish(eventType, { ...base, id: "rel-1" });
      const rows = await activitiesOf(task.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: activityType,
        eventData: expect.objectContaining({
          relationId: "rel-1",
          relationType: "blocks",
          targetTaskId: "other",
        }),
      });
    },
  );
});
