import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  ESTIMATE_DATE_RANGE_CONFLICT_MESSAGE,
  isEstimateDateRangeViolation,
} from "../../apps/api/src/task/estimate";
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

  describe("estimate and a complete date range are mutually exclusive", () => {
    const START = "2026-03-02T00:00:00.000Z";
    const DUE = "2026-03-06T00:00:00.000Z";
    const CONFLICT = ESTIMATE_DATE_RANGE_CONFLICT_MESSAGE;

    function postTask(projectId: string, extra: Record<string, unknown>) {
      return createApp().app.request(`/api/task/${projectId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Estimated",
          description: "",
          priority: "low",
          status: "to-do",
          ...extra,
        }),
      });
    }

    function bulk(body: Record<string, unknown>) {
      return createApp().app.request("/api/task/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    async function seedTask(
      projectId: string,
      values: Partial<typeof schema.taskTable.$inferInsert>,
      number = 10,
    ) {
      const [row] = await db
        .insert(schema.taskTable)
        .values({
          projectId,
          title: `Seed ${number}`,
          status: "to-do",
          number,
          ...values,
        })
        .returning();
      if (!row) throw new Error("seed failed");
      return row;
    }

    it("rejects a create with an estimate and both dates, creating nothing", async () => {
      const { project } = await setupProject();

      const response = await postTask(project.id, {
        title: "Both",
        estimateMinutes: 480,
        startDate: START,
        dueDate: DUE,
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe(CONFLICT);
      expect(
        await db.query.taskTable.findFirst({
          where: eq(schema.taskTable.title, "Both"),
        }),
      ).toBeUndefined();
    });

    it.each([
      ["start only", { startDate: START }],
      ["due only", { dueDate: DUE }],
      ["no dates", {}],
    ])("creates a task with an estimate and %s", async (_name, dates) => {
      const { project } = await setupProject();

      const response = await postTask(project.id, {
        estimateMinutes: 960,
        estimateUnit: "days",
        ...dates,
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ estimateMinutes: 960 });
    });

    it("creates a fully dated task without an estimate", async () => {
      const { project } = await setupProject();

      const response = await postTask(project.id, {
        startDate: START,
        dueDate: DUE,
      });

      expect(response.status).toBe(200);
    });

    it("rejects adding the second date to an estimated task on update", async () => {
      const { project, task } = await setup();
      expect(
        (
          await putTask(task.id, project.id, {
            estimateMinutes: 480,
            startDate: START,
          })
        ).status,
      ).toBe(200);
      m.publish.mockClear();

      const response = await putTask(task.id, project.id, {
        startDate: START,
        dueDate: DUE,
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe(CONFLICT);
      expect(await persisted(task.id)).toMatchObject({
        estimateMinutes: 480,
        dueDate: null,
      });
      expect(m.publish).not.toHaveBeenCalled();
    });

    it("rejects adding an estimate to a fully dated task, and a combined estimate + dates update", async () => {
      const { project, task } = await setup();
      await putTask(task.id, project.id, { startDate: START, dueDate: DUE });

      const addEstimate = await putTask(task.id, project.id, {
        startDate: START,
        dueDate: DUE,
        estimateMinutes: 60,
      });
      expect(addEstimate.status).toBe(400);
      expect(await addEstimate.text()).toBe(CONFLICT);

      // An omitted estimate keeps the stored one, so dates are checked
      // against it as well.
      await putTask(task.id, project.id, { estimateMinutes: 60 });
      const fullRange = await putTask(task.id, project.id, {
        startDate: START,
        dueDate: DUE,
      });
      expect(fullRange.status).toBe(400);
      expect(await persisted(task.id)).toMatchObject({
        estimateMinutes: 60,
        startDate: null,
        dueDate: null,
      });
    });

    it("allows clearing the estimate in the same update that sets both dates", async () => {
      const { project, task } = await setup();
      await putTask(task.id, project.id, { estimateMinutes: 60 });

      const response = await putTask(task.id, project.id, {
        estimateMinutes: null,
        startDate: START,
        dueDate: DUE,
      });

      expect(response.status).toBe(200);
      expect(await persisted(task.id)).toMatchObject({ estimateMinutes: null });
    });

    it("guards the dedicated due-date route against the stored start date and estimate", async () => {
      const { project } = await setup();
      const estimated = await seedTask(project.id, {
        estimateMinutes: 480,
        startDate: new Date(START),
      });
      const plain = await seedTask(
        project.id,
        { startDate: new Date(START) },
        11,
      );

      const rejected = await createApp().app.request(
        `/api/task/due-date/${estimated.id}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dueDate: DUE }),
        },
      );
      expect(rejected.status).toBe(400);
      expect(await rejected.text()).toBe(CONFLICT);
      expect((await persisted(estimated.id))?.dueDate).toBeNull();

      const accepted = await createApp().app.request(
        `/api/task/due-date/${plain.id}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dueDate: DUE }),
        },
      );
      expect(accepted.status).toBe(200);
    });

    it("rejects a bulk full-range schedule for an estimated task and writes nothing", async () => {
      const { project } = await setup();
      const estimated = await seedTask(project.id, {
        estimateMinutes: 480,
        startDate: new Date(START),
      });
      const plain = await seedTask(
        project.id,
        { startDate: new Date(START), dueDate: new Date(DUE) },
        11,
      );

      const response = await bulk({
        taskIds: [estimated.id, plain.id],
        operation: "updateSchedule",
        scheduleUpdates: [
          { taskId: plain.id, startDate: "2026-04-01", dueDate: "2026-04-03" },
          { taskId: estimated.id, startDate: START, dueDate: DUE },
        ],
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe(CONFLICT);
      expect(await persisted(plain.id)).toMatchObject({
        startDate: new Date(START),
        dueDate: new Date(DUE),
      });
      expect((await persisted(estimated.id))?.dueDate).toBeNull();
    });

    it("accepts bulk start-only and due-only schedule entries for estimated tasks", async () => {
      const { project } = await setup();
      const startOnly = await seedTask(project.id, {
        estimateMinutes: 480,
        startDate: new Date(START),
      });
      const dueOnly = await seedTask(
        project.id,
        { estimateMinutes: 960, dueDate: new Date(DUE) },
        11,
      );

      const response = await bulk({
        taskIds: [startOnly.id, dueOnly.id],
        operation: "updateSchedule",
        scheduleUpdates: [
          { taskId: startOnly.id, startDate: "2026-03-09T00:00:00.000Z" },
          { taskId: dueOnly.id, dueDate: "2026-03-13T00:00:00.000Z" },
        ],
      });

      expect(response.status).toBe(200);
      expect(await persisted(startOnly.id)).toMatchObject({
        startDate: new Date("2026-03-09T00:00:00.000Z"),
        dueDate: null,
      });
      expect(await persisted(dueOnly.id)).toMatchObject({
        startDate: null,
        dueDate: new Date("2026-03-13T00:00:00.000Z"),
      });
    });

    it("rejects the bulk updateDueDate operation when it would complete the range of an estimated task", async () => {
      const { project } = await setup();
      const estimated = await seedTask(project.id, {
        estimateMinutes: 480,
        startDate: new Date(START),
      });

      const response = await bulk({
        taskIds: [estimated.id],
        operation: "updateDueDate",
        value: DUE,
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe(CONFLICT);
      expect((await persisted(estimated.id))?.dueDate).toBeNull();
    });

    it("duplicates an estimated single-date task without a constraint error", async () => {
      const { project } = await setupProject();
      const created = await postTask(project.id, {
        estimateMinutes: 480,
        dueDate: DUE,
      });
      const estimated = (await created.json()) as { id: string };

      const response = await createApp().app.request(
        `/api/task/duplicate/${estimated.id}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      expect(response.status).toBe(200);
    });

    it("lets the database refuse a direct write of the forbidden state", async () => {
      const { project, task } = await setup();

      await expect(
        db.insert(schema.taskTable).values({
          projectId: project.id,
          title: "Direct",
          number: 99,
          estimateMinutes: 60,
          startDate: new Date(START),
          dueDate: new Date(DUE),
        }),
      ).rejects.toSatisfy(isEstimateDateRangeViolation);

      await db
        .update(schema.taskTable)
        .set({ estimateMinutes: 60, startDate: new Date(START) })
        .where(eq(schema.taskTable.id, task.id));
      await expect(
        db
          .update(schema.taskTable)
          .set({ dueDate: new Date(DUE) })
          .where(eq(schema.taskTable.id, task.id)),
      ).rejects.toSatisfy(isEstimateDateRangeViolation);
    });
  });
});
