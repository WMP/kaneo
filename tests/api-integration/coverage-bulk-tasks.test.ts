import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import bulkUpdateTasks from "../../apps/api/src/task/controllers/bulk-update-tasks";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const publish = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../apps/api/src/events", () => ({ publishEvent: publish }));

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
});

async function seedTasks(count = 2, workspaceId?: string) {
  const owner = workspaceId
    ? null
    : await createWorkspaceMember({ role: "owner" });
  const wsId = workspaceId ?? (owner?.workspace.id as string);
  const { project } = await createProjectFixture({ workspaceId: wsId });
  const tasks = await db
    .insert(schema.taskTable)
    .values(
      Array.from({ length: count }, (_, i) => ({
        projectId: project.id,
        title: `Task ${i + 1}`,
        number: i + 1,
        status: "to-do",
        priority: "low",
      })),
    )
    .returning();
  return { owner, project, tasks, workspaceId: wsId };
}

const stored = (id: string) =>
  db.query.taskTable.findFirst({ where: eq(schema.taskTable.id, id) });

describe("bulkUpdateTasks: scope and access refusals", () => {
  it("answers 404 for ids that match no task and publishes nothing", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await expect(
      bulkUpdateTasks({
        taskIds: ["missing-1", "missing-2"],
        operation: "updateStatus",
        value: "done",
        userId: owner.user.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("refuses tasks that span two workspaces and changes none", async () => {
    const a = await seedTasks(1);
    const b = await seedTasks(1);
    await expect(
      bulkUpdateTasks({
        taskIds: [a.tasks[0]?.id as string, b.tasks[0]?.id as string],
        operation: "updateStatus",
        value: "done",
        userId: a.owner?.user.id as string,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await stored(a.tasks[0]?.id as string))?.status).toBe("to-do");
    expect((await stored(b.tasks[0]?.id as string))?.status).toBe("to-do");
  });

  it("refuses a user outside the workspace and a workspace member without project access", async () => {
    const { owner, project, tasks } = await seedTasks(1);
    const outsider = await createWorkspaceMember();
    await expect(
      bulkUpdateTasks({
        taskIds: [tasks[0]?.id as string],
        operation: "updateStatus",
        value: "done",
        userId: outsider.user.id,
      }),
    ).rejects.toMatchObject({ status: 403 });

    // A workspace member who is not a member of the project is refused too.
    const bystander = await addWorkspaceMember(
      owner?.workspace.id as string,
      "member",
    );
    await expect(
      bulkUpdateTasks({
        taskIds: [tasks[0]?.id as string],
        operation: "updateStatus",
        value: "done",
        userId: bystander.id,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await stored(tasks[0]?.id as string))?.status).toBe("to-do");
    expect(publish).not.toHaveBeenCalled();

    // Positive control: the project owner can.
    const ok = await bulkUpdateTasks({
      taskIds: [tasks[0]?.id as string],
      operation: "updateStatus",
      value: "done",
      userId: owner?.user.id as string,
    });
    expect(ok).toEqual({ success: true, updatedCount: 1 });
    expect(project.id).toBeTruthy();
  });

  it("rejects an unknown operation", async () => {
    const { owner, tasks } = await seedTasks(1);
    await expect(
      bulkUpdateTasks({
        taskIds: [tasks[0]?.id as string],
        operation: "explode" as never,
        userId: owner?.user.id as string,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Unknown operation "explode"',
    });
  });
});

describe("bulkUpdateTasks: required values", () => {
  it.each([
    ["updateStatus", undefined],
    ["updatePriority", undefined],
    ["updateProgress", undefined],
    ["updateProgress", "   "],
    ["addLabel", undefined],
    ["removeLabel", undefined],
  ])(
    "%s without a usable value answers 400 and writes nothing",
    async (operation, value) => {
      const { owner, tasks } = await seedTasks(1);
      await expect(
        bulkUpdateTasks({
          taskIds: [tasks[0]?.id as string],
          operation: operation as never,
          value,
          userId: owner?.user.id as string,
        }),
      ).rejects.toMatchObject({ status: 400 });
      const row = await stored(tasks[0]?.id as string);
      expect(row).toMatchObject({
        status: "to-do",
        priority: "low",
        progress: 0,
      });
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it.each(["abc", "101", "-1", "5.5", "07"])(
    "updateProgress rejects %s",
    async (value) => {
      const { owner, tasks } = await seedTasks(1);
      await expect(
        bulkUpdateTasks({
          taskIds: [tasks[0]?.id as string],
          operation: "updateProgress",
          value,
          userId: owner?.user.id as string,
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect((await stored(tasks[0]?.id as string))?.progress).toBe(0);
    },
  );
});

describe("bulkUpdateTasks: labels", () => {
  async function seedLabel(
    workspaceId: string,
    name = "Bug",
    color = "#ff0000",
  ) {
    const [label] = await db
      .insert(schema.labelTable)
      .values({ name, color, workspaceId })
      .returning();
    return label;
  }

  const copies = (workspaceId: string, name: string) =>
    db
      .select()
      .from(schema.labelTable)
      .where(
        and(
          eq(schema.labelTable.workspaceId, workspaceId),
          eq(schema.labelTable.name, name),
        ),
      );

  it("addLabel gives each task its own copy once and is idempotent", async () => {
    const { owner, tasks, workspaceId } = await seedTasks(2);
    const label = await seedLabel(workspaceId);
    const args = {
      taskIds: tasks.map((t) => t.id),
      operation: "addLabel" as const,
      value: label?.id,
      userId: owner?.user.id as string,
    };

    expect(await bulkUpdateTasks(args)).toEqual({
      success: true,
      updatedCount: 2,
    });
    const attached = (await copies(workspaceId, "Bug")).filter((l) => l.taskId);
    expect(attached.map((l) => l.taskId).sort()).toEqual(
      tasks.map((t) => t.id).sort(),
    );
    expect(attached.every((l) => l.color === "#ff0000")).toBe(true);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith(
      "task.label_assigned",
      expect.objectContaining({ taskId: tasks[0]?.id, type: "label_assigned" }),
    );

    publish.mockClear();
    expect(await bulkUpdateTasks(args)).toEqual({
      success: true,
      updatedCount: 0,
    });
    expect(
      (await copies(workspaceId, "Bug")).filter((l) => l.taskId),
    ).toHaveLength(2);
    expect(publish).not.toHaveBeenCalled();
  });

  it("addLabel answers 404 for an unknown label and 400 for a label of another workspace", async () => {
    const { owner, tasks } = await seedTasks(1);
    const foreign = await createWorkspaceMember();
    const foreignLabel = await seedLabel(foreign.workspace.id, "Foreign");
    const base = {
      taskIds: [tasks[0]?.id as string],
      operation: "addLabel" as const,
      userId: owner?.user.id as string,
    };

    await expect(
      bulkUpdateTasks({ ...base, value: "missing-label" }),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      bulkUpdateTasks({ ...base, value: foreignLabel?.id }),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(
      await db
        .select()
        .from(schema.labelTable)
        .where(eq(schema.labelTable.taskId, tasks[0]?.id as string)),
    ).toHaveLength(0);
  });

  it("removeLabel deletes the copies of that name on the selected tasks only", async () => {
    const { owner, tasks, workspaceId } = await seedTasks(3);
    const label = await seedLabel(workspaceId);
    const [a, b, c] = tasks;
    await db.insert(schema.labelTable).values(
      [a, b, c].map((task) => ({
        name: "Bug",
        color: "#ff0000",
        workspaceId,
        taskId: task?.id,
      })),
    );

    const result = await bulkUpdateTasks({
      taskIds: [a?.id as string, b?.id as string],
      operation: "removeLabel",
      value: label?.id,
      userId: owner?.user.id as string,
    });

    expect(result).toEqual({ success: true, updatedCount: 2 });
    const remaining = await copies(workspaceId, "Bug");
    expect(remaining.map((l) => l.taskId).sort()).toEqual([null, c?.id].sort());
    expect(publish).toHaveBeenCalledWith(
      "task.label_unassigned",
      expect.objectContaining({ type: "label_unassigned", taskId: a?.id }),
    );
    await expect(
      bulkUpdateTasks({
        taskIds: [a?.id as string],
        operation: "removeLabel",
        value: "missing-label",
        userId: owner?.user.id as string,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("bulkUpdateTasks: due dates and schedules", () => {
  it("sets a due date on every task, clears it with an empty value and rejects garbage", async () => {
    const { owner, tasks } = await seedTasks(2);
    const base = {
      taskIds: tasks.map((t) => t.id),
      operation: "updateDueDate" as const,
      userId: owner?.user.id as string,
    };

    await expect(
      bulkUpdateTasks({ ...base, value: "not-a-date" }),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect((await stored(tasks[0]?.id as string))?.dueDate).toBeNull();

    expect(
      await bulkUpdateTasks({ ...base, value: "2026-03-04T00:00:00.000Z" }),
    ).toEqual({
      success: true,
      updatedCount: 2,
    });
    for (const task of tasks) {
      expect((await stored(task.id))?.dueDate?.toISOString()).toBe(
        "2026-03-04T00:00:00.000Z",
      );
    }
    expect(publish).toHaveBeenCalledWith(
      "task.due_date_changed",
      expect.objectContaining({
        taskId: tasks[0]?.id,
        oldDueDate: null,
        newDueDate: new Date("2026-03-04T00:00:00.000Z"),
      }),
    );

    await bulkUpdateTasks({ ...base, value: null });
    for (const task of tasks) {
      expect((await stored(task.id))?.dueDate).toBeNull();
    }
  });

  it("refuses a due date that would give an estimated task both dates, changing none of the batch", async () => {
    const { owner, project, tasks } = await seedTasks(1);
    const [estimated] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Estimated",
        number: 9,
        estimateMinutes: 480,
        startDate: new Date("2026-01-01T00:00:00.000Z"),
      })
      .returning();

    await expect(
      bulkUpdateTasks({
        taskIds: [tasks[0]?.id as string, estimated?.id as string],
        operation: "updateDueDate",
        value: "2026-02-01T00:00:00.000Z",
        userId: owner?.user.id as string,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await stored(tasks[0]?.id as string))?.dueDate).toBeNull();
    expect((await stored(estimated?.id as string))?.dueDate).toBeNull();
  });

  it("updateSchedule needs entries that match a selected task", async () => {
    const { owner, tasks } = await seedTasks(1);
    const base = {
      taskIds: [tasks[0]?.id as string],
      operation: "updateSchedule" as const,
      userId: owner?.user.id as string,
    };
    await expect(
      bulkUpdateTasks({ ...base, scheduleUpdates: [] }),
    ).rejects.toMatchObject({
      status: 400,
      message: "scheduleUpdates is required for updateSchedule",
    });
    await expect(bulkUpdateTasks(base)).rejects.toMatchObject({ status: 400 });
    await expect(
      bulkUpdateTasks({
        ...base,
        scheduleUpdates: [
          {
            taskId: "another-task",
            startDate: "2026-01-01T00:00:00.000Z",
            dueDate: null,
          },
        ],
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "No matching tasks for the given scheduleUpdates",
    });
    expect((await stored(tasks[0]?.id as string))?.startDate).toBeNull();
  });
});
