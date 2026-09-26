import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import bulkUpdateTasks from "../../apps/api/src/task/controllers/bulk-update-tasks";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const publish = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../apps/api/src/events", () => ({ publishEvent: publish }));

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
});

describe("bulk task event snapshots", () => {
  it("preserves each task's old status, title and assignee for reopening and notifications", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const tasks = await db
      .insert(schema.taskTable)
      .values([
        {
          projectId: project.id,
          title: "Completed",
          status: "done",
          userId: user.id,
          number: 1,
        },
        { projectId: project.id, title: "Queued", status: "to-do", number: 2 },
      ])
      .returning();
    await bulkUpdateTasks({
      taskIds: tasks.map((task) => task.id),
      operation: "updateStatus",
      value: "in-progress",
      userId: user.id,
    });
    for (const task of tasks) {
      expect(publish).toHaveBeenCalledWith(
        "task.status_changed",
        expect.objectContaining({
          taskId: task.id,
          projectId: project.id,
          oldStatus: task.status,
          newStatus: "in-progress",
          title: task.title,
          assigneeId: task.userId,
        }),
      );
    }
    expect(await db.query.taskTable.findMany()).toEqual(
      expect.arrayContaining(
        tasks.map((task) =>
          expect.objectContaining({ id: task.id, status: "in-progress" }),
        ),
      ),
    );
  });

  it("preserves differing old priorities and titles in a single bulk operation", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const tasks = await db
      .insert(schema.taskTable)
      .values([
        { projectId: project.id, title: "Low", priority: "low", number: 1 },
        { projectId: project.id, title: "High", priority: "high", number: 2 },
      ])
      .returning();
    await bulkUpdateTasks({
      taskIds: tasks.map((task) => task.id),
      operation: "updatePriority",
      value: "medium",
      userId: user.id,
    });
    for (const task of tasks) {
      expect(publish).toHaveBeenCalledWith(
        "task.priority_changed",
        expect.objectContaining({
          taskId: task.id,
          oldPriority: task.priority,
          newPriority: "medium",
          title: task.title,
        }),
      );
    }
  });

  it("bulk-sets progress on every task and publishes the same generic notice a single-task edit would", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const tasks = await db
      .insert(schema.taskTable)
      .values([
        {
          projectId: project.id,
          title: "Started",
          progress: 10,
          number: 1,
        },
        { projectId: project.id, title: "Fresh", progress: 0, number: 2 },
      ])
      .returning();

    const result = await bulkUpdateTasks({
      taskIds: tasks.map((task) => task.id),
      operation: "updateProgress",
      value: "75",
      userId: user.id,
    });

    expect(result).toEqual({ success: true, updatedCount: 2 });
    for (const task of tasks) {
      expect(publish).toHaveBeenCalledWith(
        "task.updated",
        expect.objectContaining({
          taskId: task.id,
          projectId: project.id,
          title: task.title,
        }),
        { waitForHandlers: true },
      );
    }
    expect(await db.query.taskTable.findMany()).toEqual(
      expect.arrayContaining(
        tasks.map((task) =>
          expect.objectContaining({ id: task.id, progress: 75 }),
        ),
      ),
    );
  });

  it("rejects an out-of-range or non-integer progress value without touching any task", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const tasks = await db
      .insert(schema.taskTable)
      .values([{ projectId: project.id, title: "A", progress: 20, number: 1 }])
      .returning();

    await expect(
      bulkUpdateTasks({
        taskIds: tasks.map((task) => task.id),
        operation: "updateProgress",
        value: "150",
        userId: user.id,
      }),
    ).rejects.toThrow();

    await expect(
      bulkUpdateTasks({
        taskIds: tasks.map((task) => task.id),
        operation: "updateProgress",
        value: "not-a-number",
        userId: user.id,
      }),
    ).rejects.toThrow();

    const [unchanged] = await db.query.taskTable.findMany({
      where: (fields, { eq }) => eq(fields.id, tasks[0].id),
    });
    expect(unchanged?.progress).toBe(20);
  });
});
