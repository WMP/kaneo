import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const publish = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../apps/api/src/events", async (original) => ({
  ...(await original<object>()),
  publishEvent: publish,
}));

import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import claimTaskNumbers from "../../apps/api/src/task/controllers/claim-task-numbers";
import deleteTask from "../../apps/api/src/task/controllers/delete-task";
import duplicateTask from "../../apps/api/src/task/controllers/duplicate-task";
import exportTasks from "../../apps/api/src/task/controllers/export-tasks";
import importTasks from "../../apps/api/src/task/controllers/import-tasks";
import moveTask from "../../apps/api/src/task/controllers/move-task";
import { assertTaskPosition } from "../../apps/api/src/task/controllers/next-task-position";
import updateTask from "../../apps/api/src/task/controllers/update-task";
import updateTaskApproval from "../../apps/api/src/task/controllers/update-task-approval";
import updateTaskAssignee from "../../apps/api/src/task/controllers/update-task-assignee";
import {
  clearTaskBaseline,
  setTaskBaseline,
} from "../../apps/api/src/task/controllers/update-task-baseline";
import updateTaskDescription from "../../apps/api/src/task/controllers/update-task-description";
import updateTaskDueDate from "../../apps/api/src/task/controllers/update-task-due-date";
import updateTaskPriority from "../../apps/api/src/task/controllers/update-task-priority";
import updateTaskStatus from "../../apps/api/src/task/controllers/update-task-status";
import updateTaskTitle from "../../apps/api/src/task/controllers/update-task-title";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
});

const stored = (id: string) =>
  db.query.taskTable.findFirst({ where: eq(schema.taskTable.id, id) });

describe("task controllers: a missing task is a 404 and nothing is published", () => {
  it("every single-field update refuses an unknown task id", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const currentUserId = owner.user.id;
    const calls: Array<[string, () => Promise<unknown>]> = [
      [
        "title",
        () => updateTaskTitle({ id: "missing", title: "x", currentUserId }),
      ],
      [
        "status",
        () =>
          updateTaskStatus({ id: "missing", status: "done", currentUserId }),
      ],
      [
        "priority",
        () =>
          updateTaskPriority({
            id: "missing",
            priority: "high",
            currentUserId,
          }),
      ],
      [
        "dueDate",
        () =>
          updateTaskDueDate({
            id: "missing",
            dueDate: new Date(),
            currentUserId,
          }),
      ],
      [
        "description",
        () =>
          updateTaskDescription({
            id: "missing",
            description: "x",
            currentUserId,
          }),
      ],
      [
        "approval",
        () =>
          updateTaskApproval({
            id: "missing",
            approvalStatus: "approved",
            currentUserId,
          }),
      ],
      ["setBaseline", () => setTaskBaseline({ id: "missing", currentUserId })],
      [
        "clearBaseline",
        () => clearTaskBaseline({ id: "missing", currentUserId }),
      ],
      [
        "assignee",
        () =>
          updateTaskAssignee({
            id: "missing",
            userId: currentUserId,
            currentUserId,
          }),
      ],
      ["delete", () => deleteTask("missing", currentUserId)],
    ];
    for (const [label, run] of calls) {
      await expect(run(), label).rejects.toMatchObject({ status: 404 });
    }
    expect(publish).not.toHaveBeenCalled();
    expect(await db.select().from(schema.activityTable)).toHaveLength(0);
  });

  it("move, duplicate, export, import and claim refuse unknown tasks and projects", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await expect(
      moveTask({
        taskId: "missing",
        destinationProjectId: "p",
        currentUserId: owner.user.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      duplicateTask({ taskId: "missing", currentUserId: owner.user.id }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(exportTasks("missing", null)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      importTasks("missing", [], owner.user.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(claimTaskNumbers("missing", 1)).rejects.toMatchObject({
      status: 404,
    });
    expect(await db.select().from(schema.taskTable)).toHaveLength(0);
  });
});

describe("task controllers: update-task and move-task preconditions", () => {
  it("update refuses an unknown task, a project change, and an out-of-range position, leaving the task unchanged", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const { project: other } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Keep",
        number: 1,
        status: "to-do",
        position: 3,
      })
      .returning();
    const update = (id: string, projectId: string, position = 3) =>
      updateTask(
        id,
        "Changed",
        "to-do",
        undefined,
        undefined,
        projectId,
        undefined,
        "low",
        position,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        owner.user.id,
      );

    await expect(update("missing", project.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(update(task.id, other.id)).rejects.toMatchObject({
      status: 400,
      message: "Use the task move endpoint to move tasks between projects",
    });
    await expect(update(task.id, project.id, -1)).rejects.toMatchObject({
      status: 400,
    });
    await expect(update(task.id, project.id, 1.5)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      update(task.id, project.id, 2_147_483_647),
    ).rejects.toMatchObject({ status: 400 });
    expect(await stored(task.id)).toMatchObject({
      title: "Keep",
      projectId: project.id,
      position: 3,
    });
    expect(() => assertTaskPosition(0)).not.toThrow();
    expect(() => assertTaskPosition(2_147_483_646)).not.toThrow();
  });

  it("move refuses the same project, a destination without columns and an unknown destination status", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const { project: bare } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await db
      .delete(schema.columnTable)
      .where(eq(schema.columnTable.projectId, bare.id));
    const { project: board } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Mover",
        number: 1,
        status: "to-do",
      })
      .returning();
    const base = { taskId: task.id, currentUserId: owner.user.id };

    await expect(
      moveTask({ ...base, destinationProjectId: project.id }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Task is already in that project",
    });
    await expect(
      moveTask({ ...base, destinationProjectId: bare.id }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Destination project does not have a workflow",
    });
    await expect(
      moveTask({
        ...base,
        destinationProjectId: board.id,
        destinationStatus: "no-such-column",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Selected status is not valid for the destination project",
    });
    expect(await stored(task.id)).toMatchObject({
      projectId: project.id,
      status: "to-do",
    });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("task list sorting and filters", () => {
  async function seedBoard() {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const day = (d: number) =>
      new Date(`2026-01-${String(d).padStart(2, "0")}T00:00:00.000Z`);
    await db.insert(schema.taskTable).values([
      {
        projectId: project.id,
        title: "Bravo",
        number: 1,
        status: "to-do",
        priority: "low",
        dueDate: day(20),
        position: 1,
        userId: owner.user.id,
        createdAt: day(3),
      },
      {
        projectId: project.id,
        title: "Alpha",
        number: 2,
        status: "to-do",
        priority: "urgent",
        dueDate: day(10),
        position: 2,
        createdAt: day(1),
      },
      {
        projectId: project.id,
        title: "Charlie",
        number: 3,
        status: "to-do",
        priority: "medium",
        dueDate: day(15),
        position: 3,
        createdAt: day(2),
      },
    ]);
    mockAuthenticatedSession(owner.user);
    return { owner, project };
  }

  async function titles(projectId: string, query: string) {
    const response = await createApp().app.request(
      `/api/task/tasks/${projectId}?${query}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { columns: Array<{ tasks: Array<{ title: string }> }> };
    };
    return body.data.columns.flatMap((column) =>
      column.tasks.map((task) => task.title),
    );
  }

  it.each([
    ["sortBy=createdAt&sortOrder=asc", ["Alpha", "Charlie", "Bravo"]],
    ["sortBy=priority&sortOrder=desc", ["Alpha", "Charlie", "Bravo"]],
    ["sortBy=priority&sortOrder=asc", ["Bravo", "Charlie", "Alpha"]],
    ["sortBy=dueDate&sortOrder=asc", ["Alpha", "Charlie", "Bravo"]],
    ["sortBy=title&sortOrder=desc", ["Charlie", "Bravo", "Alpha"]],
    ["sortBy=number&sortOrder=desc", ["Charlie", "Alpha", "Bravo"]],
    ["sortBy=position&sortOrder=asc", ["Bravo", "Alpha", "Charlie"]],
  ])("orders by %s", async (query, expected) => {
    const { project } = await seedBoard();
    expect(await titles(project.id, query)).toEqual(expected);
  });

  it("filters by assignee, priority and due-date window", async () => {
    const { owner, project } = await seedBoard();
    expect(await titles(project.id, `assigneeId=${owner.user.id}`)).toEqual([
      "Bravo",
    ]);
    expect(await titles(project.id, "priority=urgent")).toEqual(["Alpha"]);
    expect(
      (
        await titles(
          project.id,
          "dueBefore=2026-01-15T00:00:00.000Z&sortBy=dueDate",
        )
      ).sort(),
    ).toEqual(["Alpha", "Charlie"]);
    expect(
      (
        await titles(
          project.id,
          "dueAfter=2026-01-15T00:00:00.000Z&sortBy=dueDate",
        )
      ).sort(),
    ).toEqual(["Bravo", "Charlie"]);
    expect(await titles(project.id, "assigneeId=nobody")).toEqual([]);
  });
});
