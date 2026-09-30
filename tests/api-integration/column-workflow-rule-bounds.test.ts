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

async function columnsOf(projectId: string) {
  return db
    .select()
    .from(schema.columnTable)
    .where(eq(schema.columnTable.projectId, projectId));
}

async function workflowRules() {
  return db.select().from(schema.workflowRuleTable);
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("workflow rule column bounds", () => {
  it("rejects a column from another project in the same workspace", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const own = await createProjectFixture({ workspaceId: workspace.id });
    const sibling = await createProjectFixture({ workspaceId: workspace.id });

    mockAuthenticatedSession(user);

    const response = await request(`/workflow-rule/${own.project.id}`, "PUT", {
      integrationType: "github",
      eventType: "pull_request_opened",
      columnId: sibling.columns.todo.id,
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "Column does not belong to the provided project",
    );
    expect(await workflowRules()).toHaveLength(0);
  });

  it("rejects a column from a project in another workspace", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const foreignMember = await createWorkspaceMember({ role: "owner" });
    const own = await createProjectFixture({ workspaceId: workspace.id });
    const foreign = await createProjectFixture({
      workspaceId: foreignMember.workspace.id,
    });

    mockAuthenticatedSession(user);

    const response = await request(`/workflow-rule/${own.project.id}`, "PUT", {
      integrationType: "github",
      eventType: "pull_request_opened",
      columnId: foreign.columns.todo.id,
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "Column does not belong to the provided project",
    );
    expect(await workflowRules()).toHaveLength(0);
  });

  it("keeps the existing rule target when the new column is foreign", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const own = await createProjectFixture({ workspaceId: workspace.id });
    const sibling = await createProjectFixture({ workspaceId: workspace.id });

    const [rule] = await db
      .insert(schema.workflowRuleTable)
      .values({
        projectId: own.project.id,
        integrationType: "github",
        eventType: "pull_request_opened",
        columnId: own.columns.inProgress.id,
      })
      .returning();

    mockAuthenticatedSession(user);

    const response = await request(`/workflow-rule/${own.project.id}`, "PUT", {
      integrationType: "github",
      eventType: "pull_request_opened",
      columnId: sibling.columns.todo.id,
    });

    expect(response.status).toBe(400);
    expect(await workflowRules()).toEqual([rule]);
  });
});

describe("column creation bounds", () => {
  it("rejects a name without alphanumeric characters", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const before = await columnsOf(project.id);

    mockAuthenticatedSession(user);

    const response = await request(`/column/${project.id}`, "POST", {
      name: "?!-_ ...",
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "Column name must contain at least one alphanumeric character",
    );
    expect(await columnsOf(project.id)).toHaveLength(before.length);
  });

  it("rejects a name whose slug is reserved for virtual statuses", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const before = await columnsOf(project.id);

    mockAuthenticatedSession(user);

    for (const name of ["Planned", "  ARCHIVED "]) {
      const response = await request(`/column/${project.id}`, "POST", {
        name,
      });

      expect(response.status).toBe(409);
      expect(await response.text()).toContain("is reserved");
    }
    expect(await columnsOf(project.id)).toHaveLength(before.length);
  });

  it("rejects a name whose slug already exists in the project", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const before = await columnsOf(project.id);

    mockAuthenticatedSession(user);

    // Same name, then a different spelling that maps to the same slug.
    for (const name of ["In Progress", "in  progress!"]) {
      const response = await request(`/column/${project.id}`, "POST", {
        name,
      });

      expect(response.status).toBe(409);
      expect(await response.text()).toContain(
        'Column with slug "in-progress" already exists in this project',
      );
    }
    expect(await columnsOf(project.id)).toHaveLength(before.length);
  });

  it("allows the same name in a different project", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const first = await createProjectFixture({ workspaceId: workspace.id });
    const second = await createProjectFixture({ workspaceId: workspace.id });

    mockAuthenticatedSession(user);

    const created = await request(`/column/${first.project.id}`, "POST", {
      name: "Backlog",
    });
    expect(created.status).toBe(200);

    const response = await request(`/column/${second.project.id}`, "POST", {
      name: "Backlog",
    });

    expect(response.status).toBe(200);
  });
});

describe("column deletion bounds", () => {
  it("refuses to delete a column that still has tasks", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Pinned task",
        status: "to-do",
        columnId: columns.todo.id,
        number: 1,
      })
      .returning();

    mockAuthenticatedSession(user);

    const response = await request(`/column/${columns.todo.id}`, "DELETE");

    expect(response.status).toBe(409);
    expect(await response.text()).toContain(
      "Cannot delete column that contains tasks",
    );

    const [column] = await db
      .select()
      .from(schema.columnTable)
      .where(eq(schema.columnTable.id, columns.todo.id));
    expect(column).toEqual(columns.todo);

    const [after] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    expect(after.columnId).toBe(columns.todo.id);
  });

  it("deletes the column once it is empty", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const { columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });

    mockAuthenticatedSession(user);

    const response = await request(`/column/${columns.inReview.id}`, "DELETE");

    expect(response.status).toBe(200);
    expect(
      await db
        .select()
        .from(schema.columnTable)
        .where(eq(schema.columnTable.id, columns.inReview.id)),
    ).toHaveLength(0);
  });

  it("rejects a caller from another workspace", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    const outsider = await createWorkspaceMember({ role: "owner" });
    const { columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });

    mockAuthenticatedSession(outsider.user);

    const response = await request(`/column/${columns.inReview.id}`, "DELETE");

    expect(response.status).toBe(403);

    const [column] = await db
      .select()
      .from(schema.columnTable)
      .where(eq(schema.columnTable.id, columns.inReview.id));
    expect(column).toEqual(columns.inReview);
  });
});
