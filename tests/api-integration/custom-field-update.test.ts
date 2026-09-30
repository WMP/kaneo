import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import db, { schema } from "../../apps/api/src/database";
import { projectHiddenFieldTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(resetTestDatabase);

type FieldInsert = typeof schema.customFieldDefinitionTable.$inferInsert;

async function fixture() {
  const member = await createWorkspaceMember({ role: "admin" });
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Task",
      number: 1,
      status: "to-do",
      columnId: columns.todo.id,
    })
    .returning();
  mockAuthenticatedSession(member.user);
  const { app } = createApp();

  async function projectField(values: Partial<FieldInsert> = {}) {
    const [field] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({
        projectId: project.id,
        name: "Severity",
        type: "dropdown",
        required: false,
        options: ["low", "mid", "high"],
        optionColors: { low: "green", high: "red" },
        position: 1,
        ...values,
      })
      .returning();
    return field;
  }

  async function workspaceField(values: Partial<FieldInsert> = {}) {
    const [field] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({
        workspaceId: member.workspace.id,
        name: "Region",
        type: "dropdown",
        required: false,
        options: ["emea", "apac"],
        position: 1,
        ...values,
      })
      .returning();
    return field;
  }

  async function setValue(fieldId: string, value: string) {
    await db
      .insert(schema.customFieldValueTable)
      .values({ taskId: task.id, fieldId, value });
  }

  async function patch(fieldId: string, body: unknown) {
    const response = await app.request(`/api/custom-field/${fieldId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return {
      response,
      status: response.status,
      text,
      // Validation errors are plain text, coded errors are JSON.
      body: (() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })(),
    };
  }

  async function stored(fieldId: string) {
    const [row] = await db
      .select()
      .from(schema.customFieldDefinitionTable)
      .where(eq(schema.customFieldDefinitionTable.id, fieldId));
    return row;
  }

  return {
    member,
    project,
    task,
    app,
    projectField,
    workspaceField,
    setValue,
    patch,
    stored,
  };
}

describe("custom field edit: success", () => {
  it("edits name, required, default and options of a project field", async () => {
    const { patch, projectField, stored } = await fixture();
    const field = await projectField();

    const { status, body } = await patch(field.id, {
      name: "  Urgency ",
      required: true,
      defaultValue: "mid",
      options: ["low", " mid ", "high", "critical", "low"],
    });

    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      id: field.id,
      name: "Urgency",
      type: "dropdown",
      required: true,
      defaultValue: "mid",
      options: ["low", "mid", "high", "critical"],
      optionColors: { low: "green", high: "red" },
      scope: "project",
    });
    expect(await stored(field.id)).toMatchObject({
      name: "Urgency",
      required: true,
      defaultValue: "mid",
      options: ["low", "mid", "high", "critical"],
      optionColors: { low: "green", high: "red" },
    });
  });

  it("prunes colors of removed options and keeps explicit colors", async () => {
    const { patch, projectField, stored } = await fixture();
    const field = await projectField();

    expect((await patch(field.id, { options: ["low", "mid"] })).status).toBe(
      200,
    );
    expect((await stored(field.id)).optionColors).toEqual({ low: "green" });

    const explicit = await patch(field.id, {
      options: ["low", "mid", "urgent"],
      optionColors: { urgent: "purple" },
    });
    expect(explicit.status).toBe(200);
    expect((await stored(field.id)).optionColors).toEqual({ urgent: "purple" });
  });

  it("clears the default with null and leaves it alone when omitted", async () => {
    const { patch, projectField, stored } = await fixture();
    const field = await projectField({ defaultValue: "low" });

    expect((await patch(field.id, { name: "Renamed" })).status).toBe(200);
    expect((await stored(field.id)).defaultValue).toBe("low");

    expect((await patch(field.id, { defaultValue: null })).status).toBe(200);
    expect((await stored(field.id)).defaultValue).toBeNull();
  });

  it("edits a multiselect field", async () => {
    const { patch, projectField, stored } = await fixture();
    const field = await projectField({
      name: "Tags",
      type: "multiselect",
      options: ["a", "b", "c"],
      optionColors: null,
    });

    const { status, body } = await patch(field.id, {
      options: ["a", "b", "d"],
      defaultValue: '["a","d"]',
      required: true,
    });

    expect(status, JSON.stringify(body)).toBe(200);
    expect(await stored(field.id)).toMatchObject({
      options: ["a", "b", "d"],
      defaultValue: '["a","d"]',
      required: true,
    });
  });

  it("edits a workspace field and the project sees the change", async () => {
    const { patch, workspaceField, project, app, stored } = await fixture();
    const field = await workspaceField();

    const { status, body } = await patch(field.id, {
      name: "Territory",
      required: true,
      defaultValue: "emea",
      options: ["emea", "apac", "amer"],
    });

    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ scope: "workspace", name: "Territory" });
    expect(await stored(field.id)).toMatchObject({
      name: "Territory",
      required: true,
      defaultValue: "emea",
      options: ["emea", "apac", "amer"],
    });

    const list = await app.request(`/api/custom-field/project/${project.id}`);
    const fields = await list.json();
    expect(fields).toEqual([
      expect.objectContaining({
        id: field.id,
        name: "Territory",
        required: true,
        hideable: false,
        options: ["emea", "apac", "amer"],
      }),
    ]);
  });

  it("does not change the type and does not touch task values", async () => {
    const { patch, projectField, setValue, stored } = await fixture();
    const field = await projectField();
    await setValue(field.id, "mid");

    const { status } = await patch(field.id, {
      type: "number",
      defaultValue: "high",
      required: true,
    });

    expect(status).toBe(200);
    expect((await stored(field.id)).type).toBe("dropdown");
    const values = await db.select().from(schema.customFieldValueTable);
    expect(values).toHaveLength(1);
    expect(values[0].value).toBe("mid");
  });

  it("allows removing an option no task uses and keeping one that is used", async () => {
    const { patch, projectField, setValue, stored } = await fixture();
    const field = await projectField();
    await setValue(field.id, "mid");

    expect((await patch(field.id, { options: ["mid", "high"] })).status).toBe(
      200,
    );
    expect((await stored(field.id)).options).toEqual(["mid", "high"]);
  });

  it("lets a field that a project hides stay optional", async () => {
    const { patch, workspaceField, project, stored } = await fixture();
    const field = await workspaceField();
    await db
      .insert(projectHiddenFieldTable)
      .values({ projectId: project.id, fieldId: field.id });

    const { status } = await patch(field.id, { name: "Area" });

    expect(status).toBe(200);
    expect((await stored(field.id)).name).toBe("Area");
  });
});

describe("custom field edit: rejections persist nothing", () => {
  const invalid: [
    string,
    Partial<FieldInsert>,
    Record<string, unknown>,
    RegExp,
  ][] = [
    ["an empty name", {}, { name: "   " }, /Name cannot be empty/],
    [
      "required without a default",
      {},
      { required: true },
      /Required fields must have a default value/,
    ],
    [
      "clearing the default of a required field",
      { required: true, defaultValue: "low" },
      { defaultValue: null },
      /Required fields must have a default value/,
    ],
    [
      "a default that is not an option",
      {},
      { defaultValue: "nope" },
      /one of the dropdown options/,
    ],
    [
      "removing the option the stored default uses",
      { defaultValue: "low" },
      { options: ["mid", "high"] },
      /one of the dropdown options/,
    ],
    [
      "a dropdown without options",
      {},
      { options: [" ", ""] },
      /at least one option/,
    ],
    [
      "colors for an option that is not in the list",
      {},
      { options: ["low", "mid"], optionColors: { high: "red" } },
      /unknown option/,
    ],
    [
      "a multiselect with fewer than two options",
      { type: "multiselect", options: ["a", "b", "c"], optionColors: null },
      { options: ["a", "a"] },
      /at least 2 options/,
    ],
    [
      "options on a text field",
      { type: "text", options: null, optionColors: null },
      { options: ["a"] },
      /dropdown and multiselect/,
    ],
  ];

  it.each(invalid)("%s", async (_label, existing, edit, message) => {
    const { patch, projectField, stored } = await fixture();
    const field = await projectField(existing);
    const before = await stored(field.id);

    // A valid name rides along: the whole edit must be rejected, not half.
    const { status, text } = await patch(field.id, {
      ...edit,
      name: "name" in edit ? edit.name : "Would be renamed",
    });

    expect(status, text).toBe(400);
    expect(text).toMatch(message);
    expect(await stored(field.id)).toEqual(before);
  });

  it("rejects an edit of an unknown field", async () => {
    const { patch } = await fixture();
    const { status } = await patch("missing-field", { name: "x" });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

describe("custom field edit: conflicts with existing data", () => {
  it("rejects removing a dropdown option that tasks use (409)", async () => {
    const { patch, projectField, setValue, stored } = await fixture();
    const field = await projectField();
    await setValue(field.id, "mid");
    const before = await stored(field.id);

    const { status, body } = await patch(field.id, {
      name: "Would be renamed",
      options: ["low", "high"],
    });

    expect(status).toBe(409);
    expect(body.code).toBe("CUSTOM_FIELD_OPTION_IN_USE");
    expect(body.message).toContain("mid");
    expect(body.message).not.toContain("low");
    expect(await stored(field.id)).toEqual(before);
  });

  it("rejects removing a multiselect option that tasks use (409)", async () => {
    const { patch, projectField, setValue, stored } = await fixture();
    const field = await projectField({
      type: "multiselect",
      options: ["a", "b", "c"],
      optionColors: null,
    });
    await setValue(field.id, '["a","c"]');
    const before = await stored(field.id);

    const { status, body } = await patch(field.id, { options: ["a", "b"] });

    expect(status).toBe(409);
    expect(body.code).toBe("CUSTOM_FIELD_OPTION_IN_USE");
    expect(body.message).toContain("c");
    expect(await stored(field.id)).toEqual(before);

    expect((await patch(field.id, { options: ["a", "c"] })).status).toBe(200);
  });

  it("rejects making a workspace field required while a project hides it (409)", async () => {
    const { patch, workspaceField, project, stored } = await fixture();
    const field = await workspaceField();
    await db
      .insert(projectHiddenFieldTable)
      .values({ projectId: project.id, fieldId: field.id });
    const before = await stored(field.id);

    const { status, body } = await patch(field.id, {
      name: "Would be renamed",
      required: true,
      defaultValue: "emea",
    });

    expect(status).toBe(409);
    expect(body.code).toBe("CUSTOM_FIELD_HIDDEN_IN_PROJECTS");
    expect(body.message).toMatch(/hidden/);
    expect(await stored(field.id)).toEqual(before);

    await db.delete(projectHiddenFieldTable);
    expect(
      (await patch(field.id, { required: true, defaultValue: "emea" })).status,
    ).toBe(200);
    expect((await stored(field.id)).required).toBe(true);
  });
});

describe("custom field edit: authorization", () => {
  it("does not let a user of another workspace edit a field", async () => {
    const { app, projectField, workspaceField, stored } = await fixture();
    const fields = [await projectField(), await workspaceField()];
    const before = await Promise.all(fields.map((f) => stored(f.id)));
    const outsider = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(outsider.user);

    for (const field of fields) {
      const response = await app.request(`/api/custom-field/${field.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Hijacked", options: ["x"] }),
      });
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("Severity");
    }

    expect(await Promise.all(fields.map((f) => stored(f.id)))).toEqual(before);
  });

  it("does not let a member without project:update edit a field", async () => {
    const { app, member, projectField, stored } = await fixture();
    const field = await projectField();
    const before = await stored(field.id);
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: member.workspace.id,
      role: "reader",
      permission: JSON.stringify({ project: ["read"] }),
    });
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "reader" })
      .where(eq(schema.workspaceUserTable.userId, member.user.id));
    await db
      .update(schema.projectMemberTable)
      .set({ role: "reader" })
      .where(eq(schema.projectMemberTable.userId, member.user.id));

    const response = await app.request(`/api/custom-field/${field.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Hijacked" }),
    });

    expect(response.status).toBe(403);
    expect(await stored(field.id)).toEqual(before);
  });
});
