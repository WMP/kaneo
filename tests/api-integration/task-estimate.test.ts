import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const m = vi.hoisted(() => ({ publish: vi.fn(async () => undefined) }));
vi.mock("../../apps/api/src/events", async (original) => ({
  ...(await original<object>()),
  publishEvent: m.publish,
}));

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
});

async function setupProject() {
  const member = await createWorkspaceMember();
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  mockAuthenticatedSession(member.user);
  return { ...member, project, columns };
}

async function setup() {
  const { project, columns, ...member } = await setupProject();
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      columnId: columns.todo.id,
      title: "Original",
      status: "to-do",
      priority: "low",
      number: 1,
      position: 1,
    })
    .returning();
  return { ...member, project, columns, task };
}

function putTask(
  taskId: string,
  projectId: string,
  extra: Record<string, unknown>,
) {
  return createApp().app.request(`/api/task/${taskId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Original",
      status: "to-do",
      priority: "low",
      projectId,
      position: 1,
      ...extra,
    }),
  });
}

async function persisted(taskId: string) {
  return db.query.taskTable.findFirst({
    where: eq(schema.taskTable.id, taskId),
  });
}

describe("task effort estimate", () => {
  it("defaults to no estimate in hours when a task is created without one", async () => {
    const { project } = await setupProject();

    const response = await createApp().app.request(`/api/task/${project.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "No estimate",
        description: "",
        priority: "low",
        status: "to-do",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      estimateMinutes: null,
      estimateUnit: "hours",
    });
  });

  it("creates a task with an estimate in days", async () => {
    const { project } = await setupProject();

    const response = await createApp().app.request(`/api/task/${project.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Two days",
        description: "",
        priority: "low",
        status: "to-do",
        estimateMinutes: 960,
        estimateUnit: "days",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      estimateMinutes: 960,
      estimateUnit: "days",
    });
  });

  it("persists, reads back and clears an estimate through the full-update route", async () => {
    const { project, task } = await setup();

    const setResponse = await putTask(task.id, project.id, {
      estimateMinutes: 90,
      estimateUnit: "hours",
    });
    expect(setResponse.status).toBe(200);
    expect(await setResponse.json()).toMatchObject({
      estimateMinutes: 90,
      estimateUnit: "hours",
    });
    expect(await persisted(task.id)).toMatchObject({
      estimateMinutes: 90,
      estimateUnit: "hours",
    });

    const readResponse = await createApp().app.request(`/api/task/${task.id}`, {
      method: "GET",
    });
    expect(await readResponse.json()).toMatchObject({
      estimateMinutes: 90,
      estimateUnit: "hours",
    });

    const clearResponse = await putTask(task.id, project.id, {
      estimateMinutes: null,
    });
    expect(clearResponse.status).toBe(200);
    expect(await persisted(task.id)).toMatchObject({
      estimateMinutes: null,
      estimateUnit: "hours",
    });
  });

  it("keeps the estimate on a full update that omits it", async () => {
    const { project, task } = await setup();
    await putTask(task.id, project.id, {
      estimateMinutes: 480,
      estimateUnit: "days",
    });

    const response = await putTask(task.id, project.id, { title: "Retitled" });

    expect(response.status).toBe(200);
    expect(await persisted(task.id)).toMatchObject({
      estimateMinutes: 480,
      estimateUnit: "days",
    });
  });

  it("reports the estimate change in the task.updated event", async () => {
    const { project, task } = await setup();

    await putTask(task.id, project.id, {
      estimateMinutes: 120,
      estimateUnit: "hours",
    });

    const updated = m.publish.mock.calls.find(
      (call) => (call as unknown[])[0] === "task.updated",
    ) as unknown as [string, { changes: Record<string, unknown> }] | undefined;
    expect(updated?.[1].changes.estimateMinutes).toEqual({
      from: null,
      to: 120,
    });
  });

  it.each([
    ["negative minutes", { estimateMinutes: -1 }],
    ["fractional minutes", { estimateMinutes: 1.5 }],
    ["minutes above the maximum", { estimateMinutes: 1_000_001 }],
    ["an unknown unit", { estimateMinutes: 60, estimateUnit: "weeks" }],
  ])("rejects %s on update without touching the task", async (_name, body) => {
    const { project, task } = await setup();
    await putTask(task.id, project.id, {
      estimateMinutes: 60,
      estimateUnit: "hours",
    });
    m.publish.mockClear();

    const response = await putTask(task.id, project.id, body);

    expect(response.status).toBe(400);
    expect(await persisted(task.id)).toMatchObject({
      estimateMinutes: 60,
      estimateUnit: "hours",
    });
    expect(m.publish).not.toHaveBeenCalled();
  });

  it("rejects an invalid estimate on create without creating the task", async () => {
    const { project } = await setupProject();

    const response = await createApp().app.request(`/api/task/${project.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Bad estimate",
        description: "",
        priority: "low",
        status: "to-do",
        estimateMinutes: -30,
      }),
    });

    expect(response.status).toBe(400);
    expect(
      await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.title, "Bad estimate"),
      }),
    ).toBeUndefined();
  });

  it("refuses a negative estimate at the database level", async () => {
    const { task } = await setup();

    await expect(
      db
        .update(schema.taskTable)
        .set({ estimateMinutes: -5 })
        .where(eq(schema.taskTable.id, task.id)),
    ).rejects.toThrow();
  });

  it("exposes the estimate of a relation's far end for the Gantt", async () => {
    const { project, task } = await setup();
    const [other] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Undated successor",
        number: 2,
        estimateMinutes: 600,
        estimateUnit: "hours",
      })
      .returning();
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: task.id,
      targetTaskId: other.id,
      relationType: "blocks",
    });

    const response = await createApp().app.request(
      `/api/task-relation/project/${project.id}`,
      { method: "GET" },
    );

    expect(response.status).toBe(200);
    const relations = (await response.json()) as Array<{
      targetTask: { estimateMinutes: number | null; estimateUnit: string };
    }>;
    expect(relations[0]?.targetTask).toMatchObject({
      estimateMinutes: 600,
      estimateUnit: "hours",
    });
  });
});
