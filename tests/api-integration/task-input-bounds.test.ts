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

function request(path: string, method: string, body?: unknown) {
  return createApp().app.request(`/api${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

async function context() {
  const member = await createWorkspaceMember({ role: "owner" });
  const own = await createProjectFixture({ workspaceId: member.workspace.id });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: own.project.id,
      title: "Bounded task",
      status: "to-do",
      columnId: own.columns.todo.id,
      number: 1,
      position: 1,
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      dueDate: new Date("2026-05-10T00:00:00.000Z"),
    })
    .returning();
  if (!task) throw new Error("Expected task to be seeded");
  return { ...member, project: own.project, columns: own.columns, task };
}

// A complete, valid PUT /task/{id} body: each test overrides only the field it
// is about, so that field is the only reason for a rejection.
function updateBody(
  task: typeof schema.taskTable.$inferSelect,
  overrides: Record<string, unknown> = {},
) {
  return {
    title: task.title,
    status: task.status,
    projectId: task.projectId,
    priority: task.priority,
    position: task.position ?? 1,
    startDate: "2026-05-01T00:00:00.000Z",
    dueDate: "2026-05-10T00:00:00.000Z",
    ...overrides,
  };
}

async function storedTask(taskId: string) {
  const row = await db.query.taskTable.findFirst({
    where: eq(schema.taskTable.id, taskId),
  });
  if (!row) throw new Error("Expected task to exist");
  return row;
}

async function tasksOf(projectId: string) {
  return db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.projectId, projectId));
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("task input bounds", () => {
  it("applies a valid full update, so the rejections below are not a broken setup", async () => {
    const { user, task } = await context();
    mockAuthenticatedSession(user);

    const response = await request(
      `/task/${task.id}`,
      "PUT",
      updateBody(task, {
        title: "Renamed task",
        startDate: "2026-05-02T00:00:00.000Z",
        dueDate: "2026-05-12T00:00:00.000Z",
      }),
    );

    expect(response.status).toBe(200);
    const stored = await storedTask(task.id);
    expect(stored.title).toBe("Renamed task");
    expect(stored.startDate?.toISOString()).toBe("2026-05-02T00:00:00.000Z");
    expect(stored.dueDate?.toISOString()).toBe("2026-05-12T00:00:00.000Z");
  });

  describe("PUT /task/{id} project change", () => {
    it("rejects a different project in the same workspace and keeps the task where it is", async () => {
      const { user, workspace, task } = await context();
      const sibling = await createProjectFixture({ workspaceId: workspace.id });
      mockAuthenticatedSession(user);

      const response = await request(
        `/task/${task.id}`,
        "PUT",
        updateBody(task, { projectId: sibling.project.id }),
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain(
        "Use the task move endpoint to move tasks between projects",
      );
      expect((await storedTask(task.id)).projectId).toBe(task.projectId);
      expect(await tasksOf(sibling.project.id)).toHaveLength(0);
    });

    it("rejects a project from another workspace and keeps the task where it is", async () => {
      const { user, task } = await context();
      const foreignMember = await createWorkspaceMember({ role: "owner" });
      const foreign = await createProjectFixture({
        workspaceId: foreignMember.workspace.id,
      });
      mockAuthenticatedSession(user);

      const response = await request(
        `/task/${task.id}`,
        "PUT",
        updateBody(task, { projectId: foreign.project.id }),
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain(
        "Use the task move endpoint to move tasks between projects",
      );
      expect((await storedTask(task.id)).projectId).toBe(task.projectId);
      expect(await tasksOf(foreign.project.id)).toHaveLength(0);
    });
  });

  describe("start and due date bounds", () => {
    it("rejects creating a task whose start date is after its due date", async () => {
      const { user, project } = await context();
      mockAuthenticatedSession(user);

      const response = await request(`/task/${project.id}`, "POST", {
        title: "Backwards schedule",
        description: "",
        priority: "low",
        status: "to-do",
        startDate: "2026-06-10T00:00:00.000Z",
        dueDate: "2026-06-01T00:00:00.000Z",
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain(
        "Start date cannot be after due date",
      );
      const titles = (await tasksOf(project.id)).map((row) => row.title);
      expect(titles).toEqual(["Bounded task"]);
    });

    it("rejects creating a task with an unparseable date", async () => {
      const { user, project } = await context();
      mockAuthenticatedSession(user);

      const response = await request(`/task/${project.id}`, "POST", {
        title: "Unparseable schedule",
        description: "",
        priority: "low",
        status: "to-do",
        dueDate: "not-a-date",
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain('Invalid dueDate "not-a-date"');
      const titles = (await tasksOf(project.id)).map((row) => row.title);
      expect(titles).toEqual(["Bounded task"]);
    });

    it("rejects updating a task to a start date after its due date", async () => {
      const { user, task } = await context();
      mockAuthenticatedSession(user);

      const response = await request(
        `/task/${task.id}`,
        "PUT",
        updateBody(task, {
          title: "Should not be saved",
          startDate: "2026-06-10T00:00:00.000Z",
          dueDate: "2026-06-01T00:00:00.000Z",
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain(
        "Start date cannot be after due date",
      );
      const stored = await storedTask(task.id);
      expect(stored.title).toBe("Bounded task");
      expect(stored.startDate?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
      expect(stored.dueDate?.toISOString()).toBe("2026-05-10T00:00:00.000Z");
    });

    it("rejects updating a task with an unparseable date", async () => {
      const { user, task } = await context();
      mockAuthenticatedSession(user);

      const response = await request(
        `/task/${task.id}`,
        "PUT",
        updateBody(task, {
          title: "Should not be saved",
          startDate: "not-a-date",
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain('Invalid startDate "not-a-date"');
      const stored = await storedTask(task.id);
      expect(stored.title).toBe("Bounded task");
      expect(stored.startDate?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
      expect(stored.dueDate?.toISOString()).toBe("2026-05-10T00:00:00.000Z");
    });
  });

  describe("PUT /task/status/{id}", () => {
    it("rejects a status that is not a column of the task's project", async () => {
      const { user, task } = await context();
      mockAuthenticatedSession(user);

      const response = await request(`/task/status/${task.id}`, "PUT", {
        status: "no-such-column",
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain(
        'Invalid status "no-such-column"',
      );
      const stored = await storedTask(task.id);
      expect(stored.status).toBe("to-do");
      expect(stored.columnId).toBe(task.columnId);
    });

    it("accepts a column slug of the project", async () => {
      const { user, task, columns } = await context();
      mockAuthenticatedSession(user);

      const response = await request(`/task/status/${task.id}`, "PUT", {
        status: "in-progress",
      });

      expect(response.status).toBe(200);
      const stored = await storedTask(task.id);
      expect(stored.status).toBe("in-progress");
      expect(stored.columnId).toBe(columns.inProgress.id);
    });
  });

  describe("PUT /task/move/{id}", () => {
    it("rejects a destination status that is not a column of the destination project", async () => {
      const { user, workspace, task } = await context();
      const destination = await createProjectFixture({
        workspaceId: workspace.id,
      });
      mockAuthenticatedSession(user);

      const response = await request(`/task/move/${task.id}`, "PUT", {
        destinationProjectId: destination.project.id,
        destinationStatus: "no-such-column",
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain(
        "Selected status is not valid for the destination project",
      );
      expect(await storedTask(task.id)).toEqual(task);
      expect(await tasksOf(destination.project.id)).toHaveLength(0);
    });

    it("rejects moving a task into the project it is already in", async () => {
      const { user, project, task } = await context();
      mockAuthenticatedSession(user);

      const response = await request(`/task/move/${task.id}`, "PUT", {
        destinationProjectId: project.id,
        destinationStatus: "in-progress",
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain(
        "Task is already in that project",
      );
      expect(await storedTask(task.id)).toEqual(task);
    });

    it("moves the task when the destination and status are valid", async () => {
      const { user, workspace, task } = await context();
      const destination = await createProjectFixture({
        workspaceId: workspace.id,
      });
      mockAuthenticatedSession(user);

      const response = await request(`/task/move/${task.id}`, "PUT", {
        destinationProjectId: destination.project.id,
        destinationStatus: "in-progress",
      });

      expect(response.status).toBe(200);
      const stored = await storedTask(task.id);
      expect(stored.projectId).toBe(destination.project.id);
      expect(stored.status).toBe("in-progress");
      expect(stored.columnId).toBe(destination.columns.inProgress.id);
    });
  });
});
