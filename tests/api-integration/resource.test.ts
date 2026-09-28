import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

describe("resource API", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function createFixture() {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    return { member, project, columns, app };
  }

  async function createTask(
    app: ReturnType<typeof createApp>["app"],
    projectId: string,
    status: string,
  ) {
    const response = await app.request(`/api/task/${projectId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "A task",
        description: "",
        status,
        priority: "medium",
      }),
    });
    expect(response.status).toBe(200);
    return response.json();
  }

  it("creates, lists, filters, updates and deletes a workspace resource", async () => {
    const { app, member } = await createFixture();

    const createResponse = await app.request(
      `/api/resource/workspace/${member.workspace.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "person", name: "Contractor Carl" }),
      },
    );
    expect(createResponse.status).toBe(200);
    const created = await createResponse.json();
    expect(created).toMatchObject({
      workspaceId: member.workspace.id,
      kind: "person",
      name: "Contractor Carl",
      email: null,
      userId: null,
    });

    await app.request(`/api/resource/workspace/${member.workspace.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "equipment", name: "Excavator" }),
    });

    const listResponse = await app.request(
      `/api/resource/workspace/${member.workspace.id}`,
    );
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json();
    expect(list).toHaveLength(2);

    const filteredResponse = await app.request(
      `/api/resource/workspace/${member.workspace.id}?kind=person`,
    );
    const filtered = await filteredResponse.json();
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(created.id);

    const updateResponse = await app.request(`/api/resource/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Carl the Contractor",
        email: "carl@example.com",
      }),
    });
    expect(updateResponse.status).toBe(200);
    const updated = await updateResponse.json();
    expect(updated.name).toBe("Carl the Contractor");
    expect(updated.email).toBe("carl@example.com");

    const deleteResponse = await app.request(`/api/resource/${created.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);

    const afterDelete = await app.request(
      `/api/resource/workspace/${member.workspace.id}`,
    );
    expect(await afterDelete.json()).toHaveLength(1);
  });

  it("rejects creating a resource in a workspace the caller cannot access", async () => {
    const { app } = await createFixture();
    const outsiderWorkspaceId = `workspace-${randomUUID()}`;

    const response = await app.request(
      `/api/resource/workspace/${outsiderWorkspaceId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "person", name: "Nobody" }),
      },
    );

    expect(response.status).toBe(403);
  });

  it("assigns a resource-only target to a task and leaves task.userId null", async () => {
    const { app, member, project, columns } = await createFixture();
    const task = await createTask(app, project.id, columns.todo.slug);

    const resourceResponse = await app.request(
      `/api/resource/workspace/${member.workspace.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "material", name: "Concrete" }),
      },
    );
    const resource = await resourceResponse.json();

    const assignResponse = await app.request(`/api/task/${task.id}/assignees`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: [], resourceIds: [resource.id] }),
    });
    expect(assignResponse.status).toBe(200);
    const updatedTask = await assignResponse.json();

    expect(updatedTask.userId).toBeNull();
    expect(updatedTask.assignees).toHaveLength(1);
    expect(updatedTask.assignees[0]).toMatchObject({
      userId: null,
      resourceId: resource.id,
      kind: "material",
      name: "Concrete",
    });
  });

  it("assigns a mix of a user and a resource; the user stays primary", async () => {
    const { app, member, project, columns } = await createFixture();
    const task = await createTask(app, project.id, columns.todo.slug);

    const resourceResponse = await app.request(
      `/api/resource/workspace/${member.workspace.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "person", name: "Freelancer Fran" }),
      },
    );
    const resource = await resourceResponse.json();

    const assignResponse = await app.request(`/api/task/${task.id}/assignees`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userIds: [member.user.id],
        resourceIds: [resource.id],
      }),
    });
    expect(assignResponse.status).toBe(200);
    const updatedTask = await assignResponse.json();

    expect(updatedTask.userId).toBe(member.user.id);
    expect(updatedTask.assignees).toHaveLength(2);
    const kinds = updatedTask.assignees.map(
      (assignee: { kind: string }) => assignee.kind,
    );
    expect(kinds.sort()).toEqual(["person", "user"]);
  });

  it("rejects assigning a resource that belongs to another workspace", async () => {
    const { app, project, columns } = await createFixture();
    const task = await createTask(app, project.id, columns.todo.slug);

    const otherMember = await createWorkspaceMember({ role: "admin" });
    const [foreignResource] = await db
      .insert(schema.resourceTable)
      .values({
        workspaceId: otherMember.workspace.id,
        kind: "person",
        name: "Outsider",
      })
      .returning();

    const assignResponse = await app.request(`/api/task/${task.id}/assignees`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userIds: [],
        resourceIds: [foreignResource.id],
      }),
    });

    expect(assignResponse.status).toBe(403);
  });

  it("the ganttpro_assignment_target CHECK accepts a user row, and rejects both-null and both-set rows", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        columnId: columns.todo.id,
        status: columns.todo.slug,
        title: "Task",
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning();

    const [resource] = await db
      .insert(schema.resourceTable)
      .values({
        workspaceId: member.workspace.id,
        kind: "person",
        name: "Res",
      })
      .returning();

    // A user-only row (today's existing shape) is accepted.
    await expect(
      db.insert(schema.taskAssignmentTable).values({
        taskId: task.id,
        userId: member.user.id,
      }),
    ).resolves.toBeDefined();

    // A resource-only row is accepted.
    await expect(
      db.insert(schema.taskAssignmentTable).values({
        taskId: task.id,
        resourceId: resource.id,
      }),
    ).resolves.toBeDefined();

    // Neither set is rejected.
    await expect(
      db.insert(schema.taskAssignmentTable).values({
        taskId: task.id,
      }),
    ).rejects.toThrow();

    // Both set is rejected.
    await expect(
      db.insert(schema.taskAssignmentTable).values({
        taskId: task.id,
        userId: member.user.id,
        resourceId: resource.id,
      }),
    ).rejects.toThrow();
  });

  it("counts a person-resource in the workload split but excludes equipment/material", async () => {
    const { app, member, project, columns } = await createFixture();

    const [personResource] = await db
      .insert(schema.resourceTable)
      .values({
        workspaceId: member.workspace.id,
        kind: "person",
        name: "Freelancer Fran",
      })
      .returning();
    const [equipmentResource] = await db
      .insert(schema.resourceTable)
      .values({
        workspaceId: member.workspace.id,
        kind: "equipment",
        name: "Crane",
      })
      .returning();

    const [personTask] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        columnId: columns.todo.id,
        status: columns.todo.slug,
        title: "Person task",
        priority: "medium",
        number: 1,
        position: 1,
        dueDate: new Date("2024-01-02T00:00:00.000Z"),
      })
      .returning();
    await db.insert(schema.taskAssignmentTable).values({
      taskId: personTask.id,
      resourceId: personResource.id,
      units: 100,
    });

    const [equipmentTask] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        columnId: columns.todo.id,
        status: columns.todo.slug,
        title: "Equipment task",
        priority: "medium",
        number: 2,
        position: 2,
        dueDate: new Date("2024-01-02T00:00:00.000Z"),
      })
      .returning();
    await db.insert(schema.taskAssignmentTable).values({
      taskId: equipmentTask.id,
      resourceId: equipmentResource.id,
      units: 100,
    });

    const response = await app.request(
      `/api/workload/${member.workspace.id}?from=2024-01-01&to=2024-01-21`,
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    const personRow = body.assignees.find(
      (assignee: { userId: string | null }) =>
        assignee.userId === personResource.id,
    );
    expect(personRow).toBeDefined();
    expect(personRow.name).toBe("Freelancer Fran");
    expect(personRow.counts.some((count: number) => count > 0)).toBe(true);

    const equipmentRow = body.assignees.find(
      (assignee: { userId: string | null }) =>
        assignee.userId === equipmentResource.id,
    );
    expect(equipmentRow).toBeUndefined();
  });
});
