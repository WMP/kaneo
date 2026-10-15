import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import getCalendar from "../../apps/api/src/calendar/controllers/get-calendar";
import updateWorkingDays from "../../apps/api/src/calendar/controllers/update-working-days";
import updateColumn from "../../apps/api/src/column/controllers/update-column";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import deleteWorkflowRule from "../../apps/api/src/workflow-rule/controllers/delete-workflow-rule";
import upsertWorkflowRule from "../../apps/api/src/workflow-rule/controllers/upsert-workflow-rule";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(resetTestDatabase);

function send(method: string, path: string, body?: unknown) {
  return createApp().app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seed() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  mockAuthenticatedSession(owner.user);
  return { owner, project };
}

const columnsOf = (projectId: string) =>
  db.query.columnTable.findMany({
    where: eq(schema.columnTable.projectId, projectId),
    orderBy: (c, { asc }) => [asc(c.position)],
  });

describe("column routes", () => {
  it("creates columns with a generated slug and rejects empty, reserved and duplicate names", async () => {
    const { project } = await seed();
    const before = (await columnsOf(project.id)).length;
    const create = (name: string) =>
      send("POST", `/api/column/${project.id}`, { name });

    expect((await create("!!!")).status).toBe(400);
    expect((await create("Planned")).status).toBe(409);
    expect((await create("Archived")).status).toBe(409);
    expect((await columnsOf(project.id)).length).toBe(before);

    const ok = await create("QA Review");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      name: "QA Review",
      slug: "qa-review",
      projectId: project.id,
    });
    expect((await create("qa review")).status).toBe(409);
    expect((await columnsOf(project.id)).length).toBe(before + 1);
  });

  it("reorders columns, and a column of another project rolls the whole batch back", async () => {
    const { owner, project } = await seed();
    const { project: other } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const mine = await columnsOf(project.id);
    const [first, second] = mine;
    const foreign = (await columnsOf(other.id))[0];

    const ok = await send("PUT", `/api/column/reorder/${project.id}`, {
      columns: [
        { id: first?.id, position: 50 },
        { id: second?.id, position: 40 },
      ],
    });
    expect(ok.status).toBe(200);
    const order = ((await ok.json()) as Array<{ id: string }>).map((c) => c.id);
    expect(order.indexOf(second?.id as string)).toBeLessThan(
      order.indexOf(first?.id as string),
    );

    const bad = await send("PUT", `/api/column/reorder/${project.id}`, {
      columns: [
        { id: first?.id, position: 1 },
        { id: foreign?.id, position: 2 },
      ],
    });
    expect(bad.status).toBe(400);
    const stored = await columnsOf(project.id);
    expect(stored.find((c) => c.id === first?.id)?.position).toBe(50);
    expect((await columnsOf(other.id))[0]?.position).toBe(foreign?.position);
  });

  it("refuses to delete a column that still holds tasks and deletes an empty one", async () => {
    const { project } = await seed();
    const [busy, empty] = await columnsOf(project.id);
    await db.insert(schema.taskTable).values({
      projectId: project.id,
      title: "Inside",
      number: 1,
      status: busy?.slug as string,
      columnId: busy?.id,
    });

    const countBefore = (await columnsOf(project.id)).length;
    const refused = await send("DELETE", `/api/column/${busy?.id}`);
    expect(refused.status).toBe(409);
    expect((await columnsOf(project.id)).length).toBe(countBefore);
    expect((await columnsOf(project.id)).some((c) => c.id === busy?.id)).toBe(
      true,
    );

    const removed = await send("DELETE", `/api/column/${empty?.id}`);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ id: empty?.id });
    expect((await columnsOf(project.id)).some((c) => c.id === empty?.id)).toBe(
      false,
    );
  });

  it("refuses a viewer and answers 404 for an unknown column in the controller", async () => {
    const { owner, project } = await seed();
    const viewer = await addWorkspaceMember(owner.workspace.id, "viewer");
    const column = (await columnsOf(project.id))[0];
    mockAuthenticatedSession(viewer);
    expect((await send("DELETE", `/api/column/${column?.id}`)).status).toBe(
      403,
    );
    expect(
      (await send("PUT", `/api/column/reorder/${project.id}`, { columns: [] }))
        .status,
    ).toBe(403);
    expect((await columnsOf(project.id)).some((c) => c.id === column?.id)).toBe(
      true,
    );

    await expect(updateColumn("missing", { name: "x" })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("workflow rules", () => {
  it("creates then updates one rule per integration event and refuses a column of another project", async () => {
    const { owner, project } = await seed();
    const { project: other } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const [a, b] = await columnsOf(project.id);
    const foreign = (await columnsOf(other.id))[0];
    const args = {
      projectId: project.id,
      integrationType: "github",
      eventType: "pr_merged",
    };

    const created = await upsertWorkflowRule({
      ...args,
      columnId: a?.id as string,
    });
    const updated = await upsertWorkflowRule({
      ...args,
      columnId: b?.id as string,
    });
    expect(updated.id).toBe(created.id);
    expect(updated.columnId).toBe(b?.id);
    expect(await db.select().from(schema.workflowRuleTable)).toHaveLength(1);

    await expect(
      upsertWorkflowRule({ ...args, columnId: foreign?.id as string }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (await db.select().from(schema.workflowRuleTable))[0]?.columnId,
    ).toBe(b?.id);
  });

  it("deletes a rule through the route and answers 404 for an unknown rule in the controller", async () => {
    const { project } = await seed();
    const column = (await columnsOf(project.id))[0];
    const [rule] = await db
      .insert(schema.workflowRuleTable)
      .values({
        projectId: project.id,
        integrationType: "gitea",
        eventType: "pr_opened",
        columnId: column?.id as string,
      })
      .returning();

    const response = await send("DELETE", `/api/workflow-rule/${rule.id}`);
    expect(response.status).toBe(200);
    expect(await db.select().from(schema.workflowRuleTable)).toHaveLength(0);
    await expect(deleteWorkflowRule(rule.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("calendar controllers", () => {
  it("answer 404 for an unknown workspace and change nothing", async () => {
    await expect(getCalendar("missing")).rejects.toMatchObject({ status: 404 });
    await expect(
      updateWorkingDays("missing", 62, "someone"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("a second holiday on the same day is a 409 and the first one is kept", async () => {
    const { owner } = await seed();
    const path = `/api/calendar/${owner.workspace.id}/holidays`;
    const first = await send("POST", path, { date: "2026-12-24", name: "Eve" });
    expect(first.status).toBe(200);
    const second = await send("POST", path, {
      date: "2026-12-24T15:00:00Z",
      name: "Duplicate",
    });
    expect(second.status).toBe(409);
    const rows = await db.select().from(schema.workspaceHolidayTable);
    expect(rows.map((r) => r.name)).toEqual(["Eve"]);
  });
});
