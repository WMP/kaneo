import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { publishEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Spy on publishEvent but keep the real implementation, so the activity
// subscriber still writes rows for a genuine status change.
vi.mock("../../apps/api/src/events", async (original) => {
  const actual = await original<typeof import("../../apps/api/src/events")>();
  return {
    ...actual,
    publishEvent: vi.fn(actual.publishEvent),
  };
});

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
});

async function setup() {
  const member = await createWorkspaceMember();
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  mockAuthenticatedSession(member.user);
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      columnId: columns.inProgress.id,
      title: "Status task",
      priority: "medium",
      status: "in-progress",
      number: 1,
      position: 1,
    })
    .returning();
  const { app } = createApp();
  const setStatus = (status: string) =>
    app.request(`/api/task/status/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
  const statusActivities = () =>
    db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.taskId, task.id),
          eq(schema.activityTable.type, "status_changed"),
        ),
      );
  const publishedNames = () =>
    vi.mocked(publishEvent).mock.calls.map(([name]) => name);
  return {
    task,
    project,
    user: member.user,
    setStatus,
    statusActivities,
    publishedNames,
  };
}

describe("API integration: task status no-op", () => {
  it("returns the task unchanged and records nothing when the status is the same", async () => {
    const { task, setStatus, statusActivities, publishedNames } = await setup();

    const response = await setStatus(task.status);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: task.id,
      status: "in-progress",
      columnId: task.columnId,
      title: task.title,
    });
    expect(publishedNames()).toEqual([]);
    expect(await statusActivities()).toHaveLength(0);
    expect(
      await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      }),
    ).toMatchObject({ status: "in-progress", columnId: task.columnId });
  });

  it("still rejects an invalid status", async () => {
    const { setStatus, statusActivities, publishedNames } = await setup();

    const response = await setStatus("not-a-column");

    expect(response.status).toBe(400);
    expect(publishedNames()).toEqual([]);
    expect(await statusActivities()).toHaveLength(0);
  });

  it("still logs a real status change", async () => {
    const { task, user, project, setStatus, statusActivities } = await setup();

    const response = await setStatus("done");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: task.id,
      status: "done",
    });
    expect(publishEvent).toHaveBeenCalledWith(
      "task.status_changed",
      expect.objectContaining({
        taskId: task.id,
        projectId: project.id,
        userId: user.id,
        oldStatus: "in-progress",
        newStatus: "done",
      }),
    );
    const activities = await statusActivities();
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      eventData: { oldStatus: "in-progress", newStatus: "done" },
    });
  });
});
