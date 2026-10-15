import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import createCustomField from "../../apps/api/src/custom-field/controllers/create-custom-field";
import createWorkspaceCustomField from "../../apps/api/src/custom-field/controllers/create-workspace-custom-field";
import deleteCustomField from "../../apps/api/src/custom-field/controllers/delete-custom-field";
import getCustomFieldFilterValues from "../../apps/api/src/custom-field/controllers/get-custom-field-filter-values";
import getCustomFieldValuesByProject from "../../apps/api/src/custom-field/controllers/get-custom-field-values-by-project";
import getCustomFieldValuesByTask from "../../apps/api/src/custom-field/controllers/get-custom-field-values-by-task";
import setCustomFieldValue from "../../apps/api/src/custom-field/controllers/set-custom-field-value";
import setCustomFieldVisibility from "../../apps/api/src/custom-field/controllers/set-custom-field-visibility";
import db, { schema } from "../../apps/api/src/database";
import { projectHiddenFieldTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

async function seed() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId: project.id, title: "T", number: 1 })
    .returning();
  return { owner, project, task };
}

function valueRows(taskId: string) {
  return db
    .select()
    .from(schema.customFieldValueTable)
    .where(eq(schema.customFieldValueTable.taskId, taskId));
}

function send(method: string, path: string, body?: unknown) {
  return createApp().app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("custom field definitions: input validation", () => {
  it.each([
    [
      "number",
      "abc",
      "Default value must be a valid number for number type fields",
    ],
    [
      "number",
      "1e999",
      "Default value must be a valid number for number type fields",
    ],
    [
      "boolean",
      "yes",
      "Default value must be 'true' or 'false' for boolean type fields",
    ],
  ])(
    "a %s field refuses default %s and stores nothing",
    async (type, defaultValue, message) => {
      const { project } = await seed();
      await expect(
        createCustomField(project.id, "F", type, false, defaultValue),
      ).rejects.toMatchObject({ status: 400, message });
      expect(
        await db.select().from(schema.customFieldDefinitionTable),
      ).toHaveLength(0);
    },
  );

  it("accepts a plain number and a scientific default", async () => {
    const { project } = await seed();
    const a = await createCustomField(project.id, "A", "number", false, "-3.5");
    const b = await createCustomField(project.id, "B", "number", false, "2e3");
    expect(a.defaultValue).toBe("-3.5");
    expect(b.defaultValue).toBe("2e3");
  });

  it("create answers 404 for an unknown project or workspace and creates nothing", async () => {
    await expect(
      createCustomField("missing", "F", "text", false),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createWorkspaceCustomField("missing", "F", "text", false),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await db.select().from(schema.customFieldDefinitionTable),
    ).toHaveLength(0);
  });

  it("a workspace field with a default is backfilled onto every task of that workspace only", async () => {
    const { owner, project, task } = await seed();
    const { project: second } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const [secondTask] = await db
      .insert(schema.taskTable)
      .values({ projectId: second.id, title: "S", number: 1 })
      .returning();
    const foreign = await seed();

    const field = await createWorkspaceCustomField(
      owner.workspace.id,
      "Points",
      "number",
      false,
      "5",
    );

    expect((await valueRows(task.id)).map((r) => [r.fieldId, r.value])).toEqual(
      [[field.id, "5"]],
    );
    expect((await valueRows(secondTask.id)).map((r) => r.value)).toEqual(["5"]);
    expect(await valueRows(foreign.task.id)).toHaveLength(0);
    expect(project.id).toBeTruthy();
  });
});

describe("custom field values: reads and writes", () => {
  it("answers 404 for an unknown task and [] when the project has no fields", async () => {
    const { project, task } = await seed();
    await expect(getCustomFieldValuesByTask("missing")).rejects.toMatchObject({
      status: 404,
    });
    expect(await getCustomFieldValuesByTask(task.id)).toEqual([]);
    expect(await getCustomFieldValuesByProject(project.id)).toEqual([]);
    expect(await getCustomFieldFilterValues(project.id)).toEqual([]);
  });

  it("set value answers 404 for an unknown task, unknown field, and a field of another workspace", async () => {
    const { task } = await seed();
    const foreign = await seed();
    const foreignField = await createCustomField(
      foreign.project.id,
      "Theirs",
      "text",
      false,
    );
    const mine = await createCustomField(task.projectId, "Mine", "text", false);

    await expect(
      setCustomFieldValue("missing", mine.id, "x"),
    ).rejects.toMatchObject({ status: 404, message: "Task not found" });
    await expect(
      setCustomFieldValue(task.id, "missing", "x"),
    ).rejects.toMatchObject({ status: 404, message: "Custom field not found" });
    await expect(
      setCustomFieldValue(task.id, foreignField.id, "x"),
    ).rejects.toMatchObject({ status: 404, message: "Custom field not found" });
    expect(await valueRows(task.id)).toHaveLength(0);

    const ok = await setCustomFieldValue(task.id, mine.id, "  hello  ");
    expect(ok?.value).toBe("hello");
  });

  it.each([
    ["number", false, undefined, "12x", "Value must be a valid number"],
    ["boolean", false, undefined, "maybe", "Value must be true or false"],
    [
      "dropdown",
      false,
      ["a", "b"],
      "c",
      "Invalid option for this custom field",
    ],
    [
      "multiselect",
      false,
      ["a", "b"],
      "not json",
      "Value must be a valid JSON array",
    ],
    ["multiselect", false, ["a", "b"], '{"a":1}', "Value must be a JSON array"],
    [
      "multiselect",
      false,
      ["a", "b"],
      '["a","z"]',
      "Invalid option(s) for this custom field",
    ],
    [
      "multiselect",
      false,
      ["a", "b"],
      "[1]",
      "Invalid option(s) for this custom field",
    ],
  ])(
    "a %s value %s is refused and nothing is stored",
    async (type, required, options, value, message) => {
      const { project, task } = await seed();
      const field = await db
        .insert(schema.customFieldDefinitionTable)
        .values({ projectId: project.id, name: "F", type, required, options })
        .returning();
      await expect(
        setCustomFieldValue(task.id, field[0]?.id as string, value),
      ).rejects.toMatchObject({ status: 400, message });
      expect(await valueRows(task.id)).toHaveLength(0);
    },
  );

  it("a required multiselect refuses empty, blank and [] and accepts a non-empty array; text required refuses blank", async () => {
    const { project, task } = await seed();
    const [multi] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({
        projectId: project.id,
        name: "M",
        type: "multiselect",
        required: true,
        options: ["a", "b"],
      })
      .returning();
    const [text] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({
        projectId: project.id,
        name: "T",
        type: "text",
        required: true,
      })
      .returning();

    for (const value of ["", "   ", "[]"]) {
      await expect(
        setCustomFieldValue(task.id, multi?.id as string, value),
      ).rejects.toMatchObject({
        status: 400,
        message: "This custom field is required",
      });
    }
    await expect(
      setCustomFieldValue(task.id, text?.id as string, "  "),
    ).rejects.toMatchObject({ status: 400 });
    expect(await valueRows(task.id)).toHaveLength(0);

    const saved = await setCustomFieldValue(
      task.id,
      multi?.id as string,
      '["a"]',
    );
    expect(saved?.value).toBe('["a"]');
    // Setting again replaces the value rather than adding a row.
    await setCustomFieldValue(task.id, multi?.id as string, '["a","b"]');
    expect((await valueRows(task.id)).map((r) => r.value)).toEqual([
      '["a","b"]',
    ]);
  });

  it("an optional field value can be cleared to an empty string", async () => {
    const { task } = await seed();
    const field = await createCustomField(
      task.projectId,
      "Opt",
      "number",
      false,
    );
    await setCustomFieldValue(task.id, field.id, "4");
    await setCustomFieldValue(task.id, field.id, "");
    expect((await valueRows(task.id)).map((r) => r.value)).toEqual([""]);
  });
});

describe("custom field delete and visibility", () => {
  it("delete answers 404 for an unknown field and removes a known one with its values", async () => {
    const { task } = await seed();
    const field = await createCustomField(
      task.projectId,
      "Gone",
      "text",
      false,
    );
    await setCustomFieldValue(task.id, field.id, "v");

    await expect(deleteCustomField("missing")).rejects.toMatchObject({
      status: 404,
    });
    expect(await deleteCustomField(field.id)).toMatchObject({ id: field.id });
    expect(await valueRows(task.id)).toHaveLength(0);
    expect(
      await db.query.customFieldDefinitionTable.findFirst({
        where: eq(schema.customFieldDefinitionTable.id, field.id),
      }),
    ).toBeUndefined();
  });

  it("visibility answers 404 for an unknown field and 400 for a project-level field", async () => {
    const { project } = await seed();
    const own = await createCustomField(project.id, "Own", "text", false);
    await expect(
      setCustomFieldVisibility(project.id, "missing", true),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      setCustomFieldVisibility(project.id, own.id, true),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await db
        .select()
        .from(projectHiddenFieldTable)
        .where(and(eq(projectHiddenFieldTable.projectId, project.id))),
    ).toHaveLength(0);
  });
});

describe("custom field reorder routes", () => {
  it("reorders a project's fields, and a field of another project is refused with the whole batch rolled back", async () => {
    const { owner, project } = await seed();
    const a = await createCustomField(project.id, "A", "text", false);
    const b = await createCustomField(project.id, "B", "text", false);
    const { project: other } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const foreign = await createCustomField(other.id, "X", "text", false);
    mockAuthenticatedSession(owner.user);

    const ok = await send("PUT", `/api/custom-field/reorder/${project.id}`, {
      fields: [
        { id: a.id, position: 10 },
        { id: b.id, position: 5 },
      ],
    });
    expect(ok.status).toBe(200);
    expect(
      ((await ok.json()) as Array<{ name: string }>).map((f) => f.name),
    ).toEqual(["B", "A"]);

    const bad = await send("PUT", `/api/custom-field/reorder/${project.id}`, {
      fields: [
        { id: a.id, position: 1 },
        { id: foreign.id, position: 2 },
      ],
    });
    expect(bad.status).toBe(400);
    const rows = await db.query.customFieldDefinitionTable.findMany({
      where: eq(schema.customFieldDefinitionTable.projectId, project.id),
    });
    expect(Object.fromEntries(rows.map((r) => [r.name, r.position]))).toEqual({
      A: 10,
      B: 5,
    });
    expect(
      (
        await db.query.customFieldDefinitionTable.findFirst({
          where: eq(schema.customFieldDefinitionTable.id, foreign.id),
        })
      )?.position,
    ).toBe(foreign.position);
  });

  it("reorders workspace fields for an admin, refuses foreign ids, and refuses a plain member", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await addWorkspaceMember(owner.workspace.id, "member");
    const foreignOwner = await createWorkspaceMember({ role: "owner" });
    const one = await createWorkspaceCustomField(
      owner.workspace.id,
      "One",
      "text",
      false,
    );
    const two = await createWorkspaceCustomField(
      owner.workspace.id,
      "Two",
      "text",
      false,
    );
    const theirs = await createWorkspaceCustomField(
      foreignOwner.workspace.id,
      "Theirs",
      "text",
      false,
    );
    const path = `/api/custom-field/workspace/${owner.workspace.id}/reorder`;

    mockAuthenticatedSession(member);
    expect(
      (await send("PUT", path, { fields: [{ id: one.id, position: 9 }] }))
        .status,
    ).toBe(403);

    mockAuthenticatedSession(owner.user);
    const ok = await send("PUT", path, {
      fields: [
        { id: one.id, position: 20 },
        { id: two.id, position: 3 },
      ],
    });
    expect(ok.status).toBe(200);
    expect(
      ((await ok.json()) as Array<{ name: string }>).map((f) => f.name),
    ).toEqual(["Two", "One"]);

    const bad = await send("PUT", path, {
      fields: [
        { id: one.id, position: 1 },
        { id: theirs.id, position: 1 },
      ],
    });
    expect(bad.status).toBe(400);
    const stored = await db.query.customFieldDefinitionTable.findFirst({
      where: eq(schema.customFieldDefinitionTable.id, one.id),
    });
    expect(stored?.position).toBe(20);
    const theirsStored = await db.query.customFieldDefinitionTable.findFirst({
      where: eq(schema.customFieldDefinitionTable.id, theirs.id),
    });
    expect(theirsStored?.position).toBe(theirs.position);
  });
});

describe("custom field routes over HTTP", () => {
  it("creates a project field, a workspace field, lists the workspace fields and deletes both, for an admin only", async () => {
    const { owner, project } = await seed();
    const member = await addWorkspaceMember(owner.workspace.id, "member");
    const projectBody = {
      projectId: project.id,
      name: "Estimate",
      type: "number",
      required: false,
    };

    mockAuthenticatedSession(member);
    expect((await send("POST", "/api/custom-field", projectBody)).status).toBe(
      403,
    );
    expect(
      (
        await send(
          "POST",
          `/api/custom-field/workspace/${owner.workspace.id}`,
          { name: "W", type: "text" },
        )
      ).status,
    ).toBe(403);
    expect(
      await db.select().from(schema.customFieldDefinitionTable),
    ).toHaveLength(0);

    mockAuthenticatedSession(owner.user);
    const created = await send("POST", "/api/custom-field", projectBody);
    expect(created.status).toBe(200);
    const projectField = (await created.json()) as {
      id: string;
      name: string;
      projectId: string;
    };
    expect(projectField).toMatchObject({
      name: "Estimate",
      projectId: project.id,
    });

    const workspaceCreated = await send(
      "POST",
      `/api/custom-field/workspace/${owner.workspace.id}`,
      {
        name: "Team",
        type: "dropdown",
        options: ["A", "B"],
        optionColors: { A: "red" },
      },
    );
    expect(workspaceCreated.status, await workspaceCreated.clone().text()).toBe(
      200,
    );
    const workspaceField = (await workspaceCreated.json()) as { id: string };

    const listed = await send(
      "GET",
      `/api/custom-field/workspace/${owner.workspace.id}`,
    );
    expect(listed.status).toBe(200);
    expect(
      ((await listed.json()) as Array<{ id: string }>).map((f) => f.id),
    ).toEqual([workspaceField.id]);

    expect(
      (await send("DELETE", `/api/custom-field/${projectField.id}`)).status,
    ).toBe(200);
    expect(
      (await send("DELETE", `/api/custom-field/${workspaceField.id}`)).status,
    ).toBe(200);
    expect(
      await db.select().from(schema.customFieldDefinitionTable),
    ).toHaveLength(0);

    const outsider = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(outsider.user);
    expect(
      (await send("GET", `/api/custom-field/workspace/${owner.workspace.id}`))
        .status,
    ).toBe(403);
  });

  it("sets a task value through the route, validating it, and reads it back for the task and the project", async () => {
    const { owner, project, task } = await seed();
    const field = await createCustomField(
      project.id,
      "Points",
      "number",
      false,
    );
    mockAuthenticatedSession(owner.user);

    const bad = await send("PUT", "/api/custom-field/value", {
      taskId: task.id,
      fieldId: field.id,
      value: "many",
    });
    expect(bad.status).toBe(400);
    expect(await valueRows(task.id)).toHaveLength(0);

    const ok = await send("PUT", "/api/custom-field/value", {
      taskId: task.id,
      fieldId: field.id,
      value: "8",
    });
    expect(ok.status).toBe(200);
    const byTask = (await (
      await send("GET", `/api/custom-field/task/${task.id}`)
    ).json()) as Array<{ value: string; fieldName: string }>;
    expect(byTask).toMatchObject([{ value: "8", fieldName: "Points" }]);
    const byProject = (await (
      await send("GET", `/api/custom-field/project/${project.id}/values`)
    ).json()) as Array<{ value: string }>;
    expect(byProject.map((v) => v.value)).toEqual(["8"]);
  });
});
