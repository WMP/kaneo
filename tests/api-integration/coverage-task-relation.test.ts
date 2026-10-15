import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import createTaskRelation from "../../apps/api/src/task-relation/controllers/create-task-relation";
import { wouldCreateCycle } from "../../apps/api/src/task-relation/controllers/detect-relation-cycle";
import updateTaskRelation from "../../apps/api/src/task-relation/controllers/update-task-relation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(resetTestDatabase);

async function seed(count = 3) {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const tasks = await db
    .insert(schema.taskTable)
    .values(
      Array.from({ length: count }, (_, i) => ({
        projectId: project.id,
        title: `T${i + 1}`,
        number: i + 1,
      })),
    )
    .returning();
  return { owner, project, tasks };
}

function send(method: string, path: string, body?: unknown) {
  return createApp().app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("task relation route scoping", () => {
  it("answers 400 without a sourceTaskId and 404 for an unknown source task, creating nothing", async () => {
    const { owner } = await seed();
    mockAuthenticatedSession(owner.user);

    const missing = await send("POST", "/api/task-relation", {
      targetTaskId: "x",
      relationType: "related",
    });
    expect(missing.status).toBe(400);
    expect(await missing.text()).toBe("sourceTaskId is required");

    const unknown = await send("POST", "/api/task-relation", {
      sourceTaskId: "no-such-task",
      targetTaskId: "x",
      relationType: "related",
    });
    expect(unknown.status).toBe(404);
    expect(await db.select().from(schema.taskRelationTable)).toHaveLength(0);
  });

  it("answers 404, not 403, to a user of another workspace for update and delete of a relation", async () => {
    const { owner, tasks } = await seed(2);
    const [relation] = await db
      .insert(schema.taskRelationTable)
      .values({
        sourceTaskId: tasks[0]?.id as string,
        targetTaskId: tasks[1]?.id as string,
        relationType: "blocks",
      })
      .returning();
    const outsider = await createWorkspaceMember({ role: "owner" });

    mockAuthenticatedSession(outsider.user);
    const patch = await send("PATCH", `/api/task-relation/${relation.id}`, {
      lagDays: 3,
    });
    const del = await send("DELETE", `/api/task-relation/${relation.id}`);
    const missing = await send("DELETE", "/api/task-relation/missing-id");
    expect(patch.status).toBe(404);
    expect(del.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await patch.text()).toBe(await missing.text());
    expect(await db.select().from(schema.taskRelationTable)).toHaveLength(1);

    mockAuthenticatedSession(owner.user);
    const ok = await send("PATCH", `/api/task-relation/${relation.id}`, {
      lagDays: 3,
    });
    expect(ok.status).toBe(200);
    expect(
      (
        await db.query.taskRelationTable.findFirst({
          where: eq(schema.taskRelationTable.id, relation.id),
        })
      )?.lagDays,
    ).toBe(3);
  });
});

describe("task relation controllers", () => {
  it("refuses a relation of a task with itself", async () => {
    const { owner, tasks } = await seed(1);
    await expect(
      createTaskRelation({
        sourceTaskId: tasks[0]?.id as string,
        targetTaskId: tasks[0]?.id as string,
        relationType: "related",
        userId: owner.user.id,
        workspaceId: owner.workspace.id,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await db.select().from(schema.taskRelationTable)).toHaveLength(0);
  });

  it("update answers 404 for an unknown relation id", async () => {
    const { owner } = await seed(1);
    await expect(
      updateTaskRelation(
        "missing",
        { lagDays: 1 },
        owner.user.id,
        owner.workspace.id,
      ),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it("cycle detection follows branching edges: a diamond is no cycle, closing it back is", async () => {
    const { owner, tasks } = await seed(4);
    const [a, b, c, d] = tasks.map((t) => t.id);
    // a -> b, a -> c (two edges from one source), b -> d, c -> d
    await db.insert(schema.taskRelationTable).values([
      {
        sourceTaskId: a as string,
        targetTaskId: b as string,
        relationType: "blocks",
      },
      {
        sourceTaskId: a as string,
        targetTaskId: c as string,
        relationType: "blocks",
      },
      {
        sourceTaskId: b as string,
        targetTaskId: d as string,
        relationType: "blocks",
      },
      {
        sourceTaskId: c as string,
        targetTaskId: d as string,
        relationType: "blocks",
      },
    ]);
    const check = (source: string, target: string, relationType = "blocks") =>
      wouldCreateCycle({
        workspaceId: owner.workspace.id,
        relationType,
        sourceTaskId: source,
        targetTaskId: target,
      });

    // a -> d adds a second path a ~> d; d reaches no one, so no cycle
    expect(await check(a as string, d as string)).toBe(false);
    // d blocks a closes a -> b -> d -> a
    expect(await check(d as string, a as string)).toBe(true);
    // Through the second branch as well
    expect(await check(c as string, a as string)).toBe(true);
    // Relations of another type are not part of the graph
    expect(await check(d as string, a as string, "subtask")).toBe(false);
  });
});
