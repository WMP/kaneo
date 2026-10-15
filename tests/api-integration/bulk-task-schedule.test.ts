import { sql } from "drizzle-orm";
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

describe("bulk updateSchedule (Gantt dependency cascade persistence)", () => {
  it("writes each task's own start/due dates in one call and publishes task.updated per task", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const tasks = await db
      .insert(schema.taskTable)
      .values([
        {
          projectId: project.id,
          title: "A",
          status: "to-do",
          number: 1,
          startDate: new Date("2026-01-01T00:00:00.000Z"),
          dueDate: new Date("2026-01-05T00:00:00.000Z"),
        },
        {
          projectId: project.id,
          title: "B",
          status: "to-do",
          number: 2,
          startDate: new Date("2026-01-06T00:00:00.000Z"),
          dueDate: new Date("2026-01-08T00:00:00.000Z"),
        },
      ])
      .returning();
    const [taskA, taskB] = tasks;
    if (!taskA || !taskB) throw new Error("Expected both tasks to be seeded");

    const result = await bulkUpdateTasks({
      taskIds: [taskA.id, taskB.id],
      operation: "updateSchedule",
      scheduleUpdates: [
        {
          taskId: taskA.id,
          startDate: "2026-01-10T00:00:00.000Z",
          dueDate: "2026-01-15T00:00:00.000Z",
        },
        {
          taskId: taskB.id,
          startDate: "2026-01-16T00:00:00.000Z",
          dueDate: "2026-01-18T00:00:00.000Z",
        },
      ],
      userId: user.id,
    });

    expect(result).toEqual({ success: true, updatedCount: 2 });

    const stored = await db.query.taskTable.findMany({
      where: (task, { inArray }) => inArray(task.id, [taskA.id, taskB.id]),
    });
    const byId = new Map(stored.map((task) => [task.id, task]));
    expect(byId.get(taskA.id)?.startDate?.toISOString()).toBe(
      "2026-01-10T00:00:00.000Z",
    );
    expect(byId.get(taskA.id)?.dueDate?.toISOString()).toBe(
      "2026-01-15T00:00:00.000Z",
    );
    expect(byId.get(taskB.id)?.startDate?.toISOString()).toBe(
      "2026-01-16T00:00:00.000Z",
    );
    expect(byId.get(taskB.id)?.dueDate?.toISOString()).toBe(
      "2026-01-18T00:00:00.000Z",
    );

    for (const task of [taskA, taskB]) {
      expect(publish).toHaveBeenCalledWith(
        "task.updated",
        expect.objectContaining({
          taskId: task.id,
          projectId: project.id,
          userId: user.id,
        }),
        { waitForHandlers: true },
      );
    }
    // The dedicated due-date activity event is deliberately NOT used for a
    // cascaded reschedule — it reads in realtime/activity the same way a
    // plain manual drag already does (see update-task.ts, which only ever
    // publishes task.updated for a date change).
    expect(publish).not.toHaveBeenCalledWith(
      "task.due_date_changed",
      expect.anything(),
    );
  });

  it("rejects a start date after the due date for any single task in the batch", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({ projectId: project.id, title: "A", status: "to-do", number: 1 })
      .returning();
    if (!task) throw new Error("Expected task to be seeded");

    await expect(
      bulkUpdateTasks({
        taskIds: [task.id],
        operation: "updateSchedule",
        scheduleUpdates: [
          {
            taskId: task.id,
            startDate: "2026-01-15T00:00:00.000Z",
            dueDate: "2026-01-10T00:00:00.000Z",
          },
        ],
        userId: user.id,
      }),
    ).rejects.toThrow();
  });

  it("ignores a scheduleUpdates entry for a task outside the requested taskIds", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const tasks = await db
      .insert(schema.taskTable)
      .values([
        { projectId: project.id, title: "A", status: "to-do", number: 1 },
        { projectId: project.id, title: "B", status: "to-do", number: 2 },
      ])
      .returning();
    const [taskA, taskB] = tasks;
    if (!taskA || !taskB) throw new Error("Expected both tasks to be seeded");

    const result = await bulkUpdateTasks({
      taskIds: [taskA.id],
      operation: "updateSchedule",
      scheduleUpdates: [
        {
          taskId: taskA.id,
          startDate: "2026-02-01T00:00:00.000Z",
          dueDate: "2026-02-02T00:00:00.000Z",
        },
        {
          // Not in taskIds — must be silently ignored, not applied.
          taskId: taskB.id,
          startDate: "2026-03-01T00:00:00.000Z",
          dueDate: "2026-03-02T00:00:00.000Z",
        },
      ],
      userId: user.id,
    });

    expect(result.updatedCount).toBe(1);
    const untouchedB = await db.query.taskTable.findFirst({
      where: (task, { eq }) => eq(task.id, taskB.id),
    });
    expect(untouchedB?.startDate).toBeNull();
  });

  // KAN-SCHED-003: all schedule writes share one transaction. The trigger fails
  // the SECOND write whichever task it is (the controller has no ORDER BY), so
  // the first write has already happened when the failure comes. A sequence is
  // not transactional, so it counts writes on every connection, including one
  // that is not part of the transaction.
  it("leaves every task unchanged and publishes nothing when the second write fails", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const [taskA, taskB] = await db
      .insert(schema.taskTable)
      .values([
        {
          projectId: project.id,
          title: "A",
          status: "to-do",
          number: 1,
          startDate: new Date("2026-01-01T00:00:00.000Z"),
          dueDate: new Date("2026-01-05T00:00:00.000Z"),
        },
        {
          projectId: project.id,
          title: "B",
          status: "to-do",
          number: 2,
          startDate: new Date("2026-01-06T00:00:00.000Z"),
          dueDate: new Date("2026-01-08T00:00:00.000Z"),
        },
      ])
      .returning();
    if (!taskA || !taskB) throw new Error("Expected both tasks to be seeded");

    const storedDates = async (id: string) => {
      const row = await db.query.taskTable.findFirst({
        where: (task, { eq }) => eq(task.id, id),
      });
      return [row?.startDate?.toISOString(), row?.dueDate?.toISOString()];
    };
    const run = () =>
      bulkUpdateTasks({
        taskIds: [taskA.id, taskB.id],
        operation: "updateSchedule",
        scheduleUpdates: [
          {
            taskId: taskA.id,
            startDate: "2026-01-10T00:00:00.000Z",
            dueDate: "2026-01-15T00:00:00.000Z",
          },
          {
            taskId: taskB.id,
            startDate: "2026-01-16T00:00:00.000Z",
            dueDate: "2026-01-18T00:00:00.000Z",
          },
        ],
        userId: user.id,
      });

    await db.execute(
      sql.raw("DROP TRIGGER IF EXISTS fail_second_write ON task"),
    );
    await db.execute(sql.raw("DROP FUNCTION IF EXISTS fail_second_write()"));
    await db.execute(sql.raw("DROP SEQUENCE IF EXISTS bulk_schedule_writes"));
    await db.execute(sql.raw("CREATE SEQUENCE bulk_schedule_writes"));
    await db.execute(
      sql.raw(
        "CREATE FUNCTION fail_second_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('bulk_schedule_writes') >= 2 THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$",
      ),
    );
    await db.execute(
      sql.raw(
        "CREATE TRIGGER fail_second_write BEFORE UPDATE ON task FOR EACH ROW EXECUTE FUNCTION fail_second_write()",
      ),
    );
    try {
      // Drizzle wraps the PostgreSQL error; the original is in `cause`.
      await expect(run()).rejects.toMatchObject({
        cause: { message: expect.stringContaining("injected failure") },
      });
      expect(await storedDates(taskA.id)).toEqual([
        "2026-01-01T00:00:00.000Z",
        "2026-01-05T00:00:00.000Z",
      ]);
      expect(await storedDates(taskB.id)).toEqual([
        "2026-01-06T00:00:00.000Z",
        "2026-01-08T00:00:00.000Z",
      ]);
      expect(publish).not.toHaveBeenCalled();
    } finally {
      await db.execute(sql.raw("DROP TRIGGER fail_second_write ON task"));
      await db.execute(sql.raw("DROP FUNCTION fail_second_write()"));
      await db.execute(sql.raw("DROP SEQUENCE bulk_schedule_writes"));
    }

    // Positive control: without the trigger the same batch succeeds.
    await expect(run()).resolves.toEqual({ success: true, updatedCount: 2 });
    expect(await storedDates(taskA.id)).toEqual([
      "2026-01-10T00:00:00.000Z",
      "2026-01-15T00:00:00.000Z",
    ]);
    expect(await storedDates(taskB.id)).toEqual([
      "2026-01-16T00:00:00.000Z",
      "2026-01-18T00:00:00.000Z",
    ]);
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
