import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function insertProjectField(
  projectId: string,
  name: string,
  position: number,
) {
  const [field] = await db
    .insert(schema.customFieldDefinitionTable)
    .values({ projectId, name, type: "text", required: false, position })
    .returning();
  return field;
}

async function insertWorkspaceField(
  workspaceId: string,
  name: string,
  position: number,
) {
  const [field] = await db
    .insert(schema.customFieldDefinitionTable)
    .values({ workspaceId, name, type: "text", required: false, position })
    .returning();
  return field;
}

// Every field row with its position, in a stable order, so a test can compare
// the whole table before and after a rejected request.
async function snapshotFields() {
  return db
    .select({
      id: schema.customFieldDefinitionTable.id,
      name: schema.customFieldDefinitionTable.name,
      position: schema.customFieldDefinitionTable.position,
    })
    .from(schema.customFieldDefinitionTable)
    .orderBy(asc(schema.customFieldDefinitionTable.name));
}

function putReorder(
  path: string,
  fields: Array<{ id: string; position: number }>,
) {
  const { app } = createApp();
  return app.request(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
}

function createWorkspaceFieldRequest(workspaceId: string, name: string) {
  const { app } = createApp();
  return app.request(`/api/custom-field/workspace/${workspaceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, type: "text", required: false }),
  });
}

async function listWorkspaceFields(workspaceId: string) {
  return db
    .select()
    .from(schema.customFieldDefinitionTable)
    .where(eq(schema.customFieldDefinitionTable.workspaceId, workspaceId));
}

describe("API integration: custom field bounds", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  describe("project reorder", () => {
    it("reorders a project's own fields", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const first = await insertProjectField(project.id, "Alpha", 0);
      const second = await insertProjectField(project.id, "Beta", 1);

      mockAuthenticatedSession(member.user);

      const response = await putReorder(
        `/api/custom-field/reorder/${project.id}`,
        [
          { id: second.id, position: 0 },
          { id: first.id, position: 1 },
        ],
      );

      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as Array<{ id: string }>;
      expect(body.map((field) => field.id)).toEqual([second.id, first.id]);
    });

    it("rejects a field of another project in the same workspace and changes nothing", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const { project: sibling } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const first = await insertProjectField(project.id, "Alpha", 0);
      const second = await insertProjectField(project.id, "Beta", 1);
      const foreign = await insertProjectField(sibling.id, "Sibling", 7);

      mockAuthenticatedSession(member.user);
      const before = await snapshotFields();

      // The two legitimate ids come first, so a per-row loop outside a
      // transaction would already have swapped them when it hits the foreign id.
      const response = await putReorder(
        `/api/custom-field/reorder/${project.id}`,
        [
          { id: second.id, position: 0 },
          { id: first.id, position: 1 },
          { id: foreign.id, position: 2 },
        ],
      );

      const body = await response.text();
      expect(response.status, body).toBe(400);
      expect(body).toContain(
        `Custom field ${foreign.id} does not belong to this project`,
      );
      expect(await snapshotFields()).toEqual(before);
    });

    it("rejects a field of a project in another workspace and changes nothing", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const outsider = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const { project: foreignProject } = await createProjectFixture({
        workspaceId: outsider.workspace.id,
      });
      const first = await insertProjectField(project.id, "Alpha", 0);
      const second = await insertProjectField(project.id, "Beta", 1);
      const foreign = await insertProjectField(foreignProject.id, "Other", 7);

      mockAuthenticatedSession(member.user);
      const before = await snapshotFields();

      const response = await putReorder(
        `/api/custom-field/reorder/${project.id}`,
        [
          { id: second.id, position: 0 },
          { id: first.id, position: 1 },
          { id: foreign.id, position: 2 },
        ],
      );

      const body = await response.text();
      expect(response.status, body).toBe(400);
      expect(body).toContain(
        `Custom field ${foreign.id} does not belong to this project`,
      );
      expect(await snapshotFields()).toEqual(before);
    });
  });

  describe("workspace reorder", () => {
    it("reorders a workspace's own fields", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const first = await insertWorkspaceField(member.workspace.id, "Alpha", 0);
      const second = await insertWorkspaceField(member.workspace.id, "Beta", 1);

      mockAuthenticatedSession(member.user);

      const response = await putReorder(
        `/api/custom-field/workspace/${member.workspace.id}/reorder`,
        [
          { id: second.id, position: 0 },
          { id: first.id, position: 1 },
        ],
      );

      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as Array<{ id: string }>;
      expect(body.map((field) => field.id)).toEqual([second.id, first.id]);
    });

    it("rejects a field of another workspace and changes nothing", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const outsider = await createWorkspaceMember({ role: "admin" });
      const first = await insertWorkspaceField(member.workspace.id, "Alpha", 0);
      const second = await insertWorkspaceField(member.workspace.id, "Beta", 1);
      const foreign = await insertWorkspaceField(
        outsider.workspace.id,
        "Other",
        7,
      );

      mockAuthenticatedSession(member.user);
      const before = await snapshotFields();

      const response = await putReorder(
        `/api/custom-field/workspace/${member.workspace.id}/reorder`,
        [
          { id: second.id, position: 0 },
          { id: first.id, position: 1 },
          { id: foreign.id, position: 2 },
        ],
      );

      const body = await response.text();
      expect(response.status, body).toBe(400);
      expect(body).toContain(
        `Custom field ${foreign.id} does not belong to this workspace`,
      );
      expect(await snapshotFields()).toEqual(before);
    });
  });

  describe("workspace field creation", () => {
    it("lets an admin create a workspace field", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });

      mockAuthenticatedSession(admin.user);

      const response = await createWorkspaceFieldRequest(
        admin.workspace.id,
        "Allowed field",
      );

      expect(response.status, await response.clone().text()).toBe(200);
      const fields = await listWorkspaceFields(admin.workspace.id);
      expect(fields.map((field) => field.name)).toEqual(["Allowed field"]);
    });

    it.each(["member", "viewer"])(
      "rejects a %s without project:update and creates nothing",
      async (role) => {
        const admin = await createWorkspaceMember({ role: "admin" });
        const user = await addWorkspaceMember(admin.workspace.id, role);

        mockAuthenticatedSession(user);

        const response = await createWorkspaceFieldRequest(
          admin.workspace.id,
          "Denied field",
        );

        const body = await response.text();
        expect(response.status, body).toBe(403);
        expect(body).not.toContain("Denied field");
        expect(await listWorkspaceFields(admin.workspace.id)).toEqual([]);
      },
    );

    it("rejects a caller from another workspace and creates nothing", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      const outsider = await createWorkspaceMember({ role: "admin" });

      mockAuthenticatedSession(outsider.user);

      const response = await createWorkspaceFieldRequest(
        admin.workspace.id,
        "Outsider field",
      );

      const body = await response.text();
      expect(response.status, body).toBe(403);
      expect(await listWorkspaceFields(admin.workspace.id)).toEqual([]);
      expect(await listWorkspaceFields(outsider.workspace.id)).toEqual([]);
    });
  });
});
