import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { publishEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Delivery to external channels is covered elsewhere; here it is replaced so
// no background work outlives a test.
const { deliver } = vi.hoisted(() => ({
  deliver: vi.fn(async (_id: string) => undefined),
}));
vi.mock("../../apps/api/src/notification-preferences/delivery", () => ({
  deliverNotification: deliver,
}));

type App = ReturnType<typeof createApp>["app"];

function call(app: App, method: string, path: string, body?: unknown) {
  return app.request(`/api/notification${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function world() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project, columns } = await createProjectFixture({
    workspaceId: owner.workspace.id,
    name: "Apollo",
  });
  const assignee = await addWorkspaceMember(owner.workspace.id, "member");
  await addProjectMember(project.id, assignee.id, "member");
  const outsider = await createWorkspaceMember();
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      columnId: columns.todo.id,
      title: "Ship it",
      userId: assignee.id,
    })
    .returning();
  if (!task) throw new Error("task not created");
  const { app } = createApp();
  return { owner, project, assignee, outsider, task, app };
}

async function notificationsOf(userId: string) {
  return db
    .select()
    .from(schema.notificationTable)
    .where(eq(schema.notificationTable.userId, userId));
}

async function publishAndWait(type: string, data: Record<string, unknown>) {
  await publishEvent(type, data, { waitForHandlers: true });
}

describe("API integration: notification routes", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    deliver.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("creates, lists, marks read and clears only the caller's notifications", async () => {
    const { owner, assignee, project, task, app } = await world();
    mockAuthenticatedSession(assignee);

    const created = await call(app, "POST", "", {
      title: "Hello",
      message: "World",
      type: "info",
    });
    expect(created.status).toBe(200);
    const first = await created.json();
    expect(first).toMatchObject({
      userId: assignee.id,
      title: "Hello",
      content: "World",
      type: "info",
      isRead: false,
      resourceId: null,
      resourceType: null,
    });
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledWith(first.id));

    const withTask = await (
      await call(app, "POST", "", {
        type: "task_comment",
        eventData: { taskTitle: "Ship it" },
        relatedEntityId: task.id,
        relatedEntityType: "task",
      })
    ).json();
    expect(withTask).toMatchObject({
      title: null,
      content: null,
      resourceId: task.id,
      resourceType: "task",
    });

    // A notification of another user exists but is invisible.
    await db.insert(schema.notificationTable).values({
      userId: owner.user.id,
      type: "info",
      title: "private",
    });

    const list = await (await call(app, "GET", "")).json();
    expect(list.map((n: { id: string }) => n.id)).toEqual([
      withTask.id,
      first.id,
    ]);
    // A task notification carries the ids the client needs to open it.
    expect(list[0].eventData).toEqual({
      taskTitle: "Ship it",
      projectId: project.id,
      workspaceId: owner.workspace.id,
    });
    expect(list[1].eventData).toBeNull();

    // Reading marks only the addressed one, and not somebody else's.
    const read = await call(app, "PATCH", `/${first.id}/read`);
    expect(read.status).toBe(200);
    expect((await read.json()).isRead).toBe(true);
    const [theirs] = await notificationsOf(owner.user.id);
    const foreign = await call(app, "PATCH", `/${theirs?.id}/read`);
    expect(foreign.status).toBe(404);
    expect((await notificationsOf(owner.user.id))[0]?.isRead).toBe(false);
    expect((await call(app, "PATCH", "/nope/read")).status).toBe(404);

    const all = await call(app, "PATCH", "/read-all");
    expect(await all.json()).toEqual({ success: true });
    expect((await notificationsOf(assignee.id)).every((n) => n.isRead)).toBe(
      true,
    );
    expect((await notificationsOf(owner.user.id))[0]?.isRead).toBe(false);

    const cleared = await call(app, "DELETE", "/clear-all");
    expect(await cleared.json()).toEqual({ success: true });
    expect(await notificationsOf(assignee.id)).toHaveLength(0);
    expect(await notificationsOf(owner.user.id)).toHaveLength(1);
  });

  it("logs a failing background delivery without leaking the error text and still returns the notification", async () => {
    const { assignee, app } = await world();
    mockAuthenticatedSession(assignee);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    deliver.mockRejectedValueOnce(new Error("smtp password=hunter2"));
    const response = await call(app, "POST", "", { type: "info" });
    expect(response.status).toBe(200);
    const created = await response.json();
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith("Failed to deliver notification", {
        notificationId: created.id,
        error: "Outbound request failed",
      }),
    );
    expect(JSON.stringify(errors.mock.calls)).not.toContain("hunter2");
    expect(await notificationsOf(assignee.id)).toHaveLength(1);
  });

  it("returns only the 50 most recent notifications", async () => {
    const { assignee, app } = await world();
    mockAuthenticatedSession(assignee);
    const base = Date.now();
    await db.insert(schema.notificationTable).values(
      Array.from({ length: 52 }, (_, index) => ({
        userId: assignee.id,
        type: "info",
        title: `n${index}`,
        createdAt: new Date(base + index * 1000),
      })),
    );
    const list = await (await call(app, "GET", "")).json();
    expect(list).toHaveLength(50);
    expect(list[0].title).toBe("n51");
    expect(list[49].title).toBe("n2");
  });

  it.each([
    ["task_assignee_changed", "taskAssignmentEnabled"],
    ["task_created", "taskAssignmentEnabled"],
    ["task_comment", "taskCommentEnabled"],
    ["task_mention", "taskCommentEnabled"],
    ["task_status_changed", "taskStatusChangeEnabled"],
    ["due_date_reminder", "dueDateReminderEnabled"],
    ["task_overdue", "dueDateReminderEnabled"],
  ] as const)(
    "%s is muted by %s and nothing else mutes it",
    async (type, key) => {
      const { assignee, app } = await world();
      mockAuthenticatedSession(assignee);
      await db.insert(schema.userNotificationPreferenceTable).values({
        userId: assignee.id,
        [key]: false,
      });
      const muted = await call(app, "POST", "", { type });
      expect(muted.status).toBe(200);
      expect(await muted.json()).toBeNull();
      expect(await notificationsOf(assignee.id)).toHaveLength(0);
      expect(deliver).not.toHaveBeenCalled();

      // Another category stays deliverable while this one is muted.
      const unmuted = await call(app, "POST", "", { type: "info" });
      expect(await unmuted.json()).toMatchObject({ type: "info" });

      // And the same type is delivered once its own switch is on again.
      await db
        .update(schema.userNotificationPreferenceTable)
        .set({ [key]: true })
        .where(eq(schema.userNotificationPreferenceTable.userId, assignee.id));
      expect(
        await (await call(app, "POST", "", { type })).json(),
      ).toMatchObject({
        type,
      });
    },
  );

  it("does not create a notification about a task the caller cannot open or a foreign workspace", async () => {
    const { assignee, outsider, task, app } = await world();
    mockAuthenticatedSession(outsider.user);
    const taskResponse = await call(app, "POST", "", {
      type: "task_comment",
      relatedEntityId: task.id,
      relatedEntityType: "task",
    });
    expect(await taskResponse.json()).toBeNull();
    const workspaceResponse = await call(app, "POST", "", {
      type: "info",
      relatedEntityId: "workspace-of-someone-else",
      relatedEntityType: "workspace",
    });
    expect(await workspaceResponse.json()).toBeNull();
    const noId = await call(app, "POST", "", {
      type: "info",
      relatedEntityType: "task",
    });
    expect(await noId.json()).toBeNull();
    expect(await notificationsOf(outsider.user.id)).toHaveLength(0);
    expect(await notificationsOf(assignee.id)).toHaveLength(0);
  });

  it("rejects a request without a type", async () => {
    const { assignee, app } = await world();
    mockAuthenticatedSession(assignee);
    expect((await call(app, "POST", "", { title: "x" })).status).toBe(400);
    expect(await notificationsOf(assignee.id)).toHaveLength(0);
  });
});

describe("API integration: assignee notifications", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    deliver.mockClear();
  });

  it("task.assignee_changed with source resource_link notifies nobody", async () => {
    const { owner, assignee, task } = await world();
    const event = {
      taskId: task.id,
      userId: owner.user.id,
      oldAssignee: null,
      newAssignee: "A",
      newAssigneeId: assignee.id,
      title: "Ship it",
    };
    await publishEvent(
      "task.assignee_changed",
      { ...event, source: "resource_link" },
      { waitForHandlers: true },
    );
    expect(await notificationsOf(assignee.id)).toHaveLength(0);
    await publishEvent("task.assignee_changed", event, {
      waitForHandlers: true,
    });
    expect(await notificationsOf(assignee.id)).toHaveLength(1);
  });
});

describe("API integration: notification event subscribers", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    deliver.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("task.created notifies the assignee unless the actor assigned themselves", async () => {
    const { owner, assignee, project, task } = await world();
    await publishAndWait("task.created", {
      taskId: task.id,
      userId: assignee.id,
      currentUserId: owner.user.id,
      title: "Ship it",
      projectId: project.id,
    });
    const [row] = await notificationsOf(assignee.id);
    expect(row).toMatchObject({
      type: "task_created",
      resourceId: task.id,
      resourceType: "task",
      eventData: {
        taskTitle: "Ship it",
        projectId: project.id,
        workspaceId: owner.workspace.id,
      },
    });

    await publishAndWait("task.created", {
      taskId: task.id,
      userId: assignee.id,
      currentUserId: assignee.id,
      title: "Ship it",
      projectId: project.id,
    });
    expect(await notificationsOf(assignee.id)).toHaveLength(1);
  });

  it("task.created creates nothing for a user who cannot open the project", async () => {
    const { owner, outsider, project, task } = await world();
    await publishAndWait("task.created", {
      taskId: task.id,
      userId: outsider.user.id,
      currentUserId: owner.user.id,
      title: "Ship it",
      projectId: project.id,
    });
    expect(await notificationsOf(outsider.user.id)).toHaveLength(0);
  });

  it("workspace.created notifies the owner only when an owner id is known", async () => {
    const { owner } = await world();
    await publishAndWait("workspace.created", {
      workspaceId: owner.workspace.id,
      workspaceName: "Acme",
      ownerEmail: owner.user.email,
    });
    expect(await notificationsOf(owner.user.id)).toHaveLength(0);
    await publishAndWait("workspace.created", {
      workspaceId: owner.workspace.id,
      workspaceName: "Acme",
      ownerEmail: owner.user.email,
      ownerId: owner.user.id,
    });
    const [row] = await notificationsOf(owner.user.id);
    expect(row).toMatchObject({
      type: "workspace_created",
      resourceId: owner.workspace.id,
      resourceType: "workspace",
      eventData: { workspaceName: "Acme" },
    });
  });

  it("task.status_changed notifies the assignee about someone else's change only", async () => {
    const { owner, assignee, project, task } = await world();
    const base = {
      taskId: task.id,
      oldStatus: "to-do",
      newStatus: "done",
      title: "Ship it",
    };
    await publishAndWait("task.status_changed", {
      ...base,
      userId: owner.user.id,
    });
    expect(await notificationsOf(assignee.id)).toHaveLength(0);
    await publishAndWait("task.status_changed", {
      ...base,
      userId: assignee.id,
      assigneeId: assignee.id,
    });
    expect(await notificationsOf(assignee.id)).toHaveLength(0);
    await publishAndWait("task.status_changed", {
      ...base,
      userId: owner.user.id,
      assigneeId: assignee.id,
    });
    const [row] = await notificationsOf(assignee.id);
    expect(row).toMatchObject({
      type: "task_status_changed",
      resourceId: task.id,
      eventData: {
        taskTitle: "Ship it",
        oldStatus: "to-do",
        newStatus: "done",
        projectId: project.id,
        workspaceId: owner.workspace.id,
      },
    });

    // A task that no longer exists still yields no crash and no scope data.
    await db.delete(schema.taskTable).where(eq(schema.taskTable.id, task.id));
    await publishAndWait("task.status_changed", {
      ...base,
      userId: owner.user.id,
      assigneeId: assignee.id,
    });
    expect(await notificationsOf(assignee.id)).toHaveLength(1);
  });

  it("time-entry.created notifies the task owner about someone else's entry only", async () => {
    const { owner, assignee, project, task } = await world();
    const base = {
      timeEntryId: "te-1",
      taskId: task.id,
      taskTitle: "Ship it",
    };
    await publishAndWait("time-entry.created", {
      ...base,
      userId: assignee.id,
      taskOwnerId: assignee.id,
    });
    await publishAndWait("time-entry.created", {
      ...base,
      userId: owner.user.id,
    });
    expect(await notificationsOf(assignee.id)).toHaveLength(0);
    await publishAndWait("time-entry.created", {
      ...base,
      userId: owner.user.id,
      taskOwnerId: assignee.id,
    });
    const [row] = await notificationsOf(assignee.id);
    expect(row).toMatchObject({
      type: "time_entry_created",
      resourceId: task.id,
      eventData: {
        taskTitle: "Ship it",
        projectId: project.id,
        workspaceId: owner.workspace.id,
      },
    });

    // Without a title the field is stored as null.
    await publishAndWait("time-entry.created", {
      timeEntryId: "te-2",
      taskId: task.id,
      userId: owner.user.id,
      taskOwnerId: assignee.id,
    });
    const rows = await notificationsOf(assignee.id);
    expect(rows).toHaveLength(2);
    expect(
      rows.some(
        (r) => (r.eventData as { taskTitle: unknown }).taskTitle === null,
      ),
    ).toBe(true);
  });
});
