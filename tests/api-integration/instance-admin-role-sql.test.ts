import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import db, { schema } from "../../apps/api/src/database";
import getInstanceStatus from "../../apps/api/src/instance/controllers/get-instance-status";
import { filterProjectAssignableUsers } from "../../apps/api/src/utils/assert-assignable-user";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function createUser(role: string | null) {
  const id = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      email: `${id}@example.com`,
      emailVerified: true,
      name: "Role holder",
      role,
    })
    .returning();
  return user;
}

describe("API integration: instance admin role in SQL", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("reports an admin when the only one has a role list", async () => {
    await createUser("user");
    await createUser("user,admin");

    const status = await getInstanceStatus();

    expect(status).toEqual({ hasUsers: true, hasAdmin: true });
  });

  it("does not count administrator-like or padded roles", async () => {
    await createUser("administrator");
    await createUser(" admin , user");
    await createUser("admin\t");
    await createUser(null);

    const status = await getInstanceStatus();

    expect(status.hasAdmin).toBe(false);
  });

  it("lets a multi-role admin be assigned tasks outside their workspaces", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const admin = await createUser("user,admin");
    const outsider = await createUser("user");

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });

    // The fork decides assignment per project, not per workspace.
    const assignable = await filterProjectAssignableUsers(
      [owner.user.id, admin.id, outsider.id],
      project.id,
    );

    expect([...assignable].sort()).toEqual([admin.id, owner.user.id].sort());
  });
});
