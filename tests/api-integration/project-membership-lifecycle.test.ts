import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { addConnection, removeConnection } from "../../apps/api/src/ws";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture } from "./helpers/fixtures";

// Project memberships must follow the lifecycle of what they hang on: the
// workspace membership (remove, leave, account deletion) and the role catalog
// (a workspace role that is still a project role cannot be deleted or renamed).
// These go through the real Better Auth routes, sessions and hooks.

const origin = "http://localhost:5173";
const { app } = createApp();

type Actor = { id: string; cookie: string; memberId: string };

async function authPost(path: string, body: unknown, cookie: string) {
  return app.request(`/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: origin,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
}

async function signUp(name: string) {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: origin },
    body: JSON.stringify({
      name,
      email: `${name}-${randomUUID().slice(0, 8)}@example.com`,
      password: "long-password-for-tests",
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  return { id: body.user.id, cookie };
}

async function makeWorkspace(slug: string) {
  const [workspace] = await db
    .insert(schema.workspaceTable)
    .values({ name: slug, slug, createdAt: new Date() })
    .returning();
  const now = new Date();
  await db.insert(schema.workspaceRoleTable).values(
    ["viewer", "member", "admin"].map((role) => ({
      workspaceId: workspace.id,
      role,
      permission: JSON.stringify({ task: ["read"] }),
      createdAt: now,
      updatedAt: now,
    })),
  );
  return workspace;
}

async function join(workspaceId: string, name: string, role: string) {
  const user = await signUp(name);
  const [member] = await db
    .insert(schema.workspaceUserTable)
    .values({ workspaceId, userId: user.id, role, joinedAt: new Date() })
    .returning();
  return { ...user, memberId: member.id } as Actor;
}

async function joinExisting(workspaceId: string, user: Actor, role: string) {
  await db
    .insert(schema.workspaceUserTable)
    .values({ workspaceId, userId: user.id, role, joinedAt: new Date() });
}

async function projectRows(userId: string) {
  return db
    .select({
      projectId: schema.projectMemberTable.projectId,
      role: schema.projectMemberTable.role,
    })
    .from(schema.projectMemberTable)
    .where(eq(schema.projectMemberTable.userId, userId));
}

function get(path: string, cookie: string) {
  return app.request(`/api${path}`, { headers: { Cookie: cookie } });
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const first = await makeWorkspace("first");
  const second = await makeWorkspace("second");
  const owner = await join(first.id, "owner", "owner");
  await joinExisting(second.id, owner, "owner");
  const guest = await join(first.id, "guest", "member");
  await joinExisting(second.id, guest, "member");

  const p1 = await createProjectFixture({
    workspaceId: first.id,
    members: "none",
  });
  const p2 = await createProjectFixture({
    workspaceId: first.id,
    members: "none",
  });
  const p3 = await createProjectFixture({
    workspaceId: second.id,
    members: "none",
  });
  for (const project of [p1.project, p2.project, p3.project]) {
    await db
      .insert(schema.projectMemberTable)
      .values({ projectId: project.id, userId: guest.id, role: "member" });
  }
  return { first, second, owner, guest, p1, p2, p3 };
}

let s: Setup;

beforeEach(async () => {
  await resetTestDatabase();
  // The first registered user becomes instance administrator; burn that slot.
  await signUp("throwaway");
  s = await setup();
});

describe("leaving the workspace ends project access", () => {
  it("removing a member deletes their project memberships in that workspace only", async () => {
    expect(await projectRows(s.guest.id)).toHaveLength(3);
    const removed = await authPost(
      "/organization/remove-member",
      { organizationId: s.first.id, memberIdOrEmail: s.guest.memberId },
      s.owner.cookie,
    );
    expect(removed.status).toBe(200);

    const rows = await projectRows(s.guest.id);
    expect(rows).toEqual([{ projectId: s.p3.project.id, role: "member" }]);

    // Joining again later does not bring the old access back.
    await joinExisting(s.first.id, s.guest, "member");
    const response = await get(`/project/${s.p1.project.id}`, s.guest.cookie);
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("You don't have access to this project");
  });

  it("leaving deletes the leaver's project memberships in that workspace only", async () => {
    const left = await authPost(
      "/organization/leave",
      { organizationId: s.first.id },
      s.guest.cookie,
    );
    expect(left.status).toBe(200);

    expect(await projectRows(s.guest.id)).toEqual([
      { projectId: s.p3.project.id, role: "member" },
    ]);
    const members = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, s.first.id),
          eq(schema.workspaceUserTable.userId, s.guest.id),
        ),
      );
    expect(members).toHaveLength(0);
  });

  it("keeps memberships when leaving is refused", async () => {
    // The only owner cannot leave; nothing may be deleted for a refused leave.
    await db.insert(schema.projectMemberTable).values({
      projectId: s.p1.project.id,
      userId: s.owner.id,
      role: "admin",
    });
    const left = await authPost(
      "/organization/leave",
      { organizationId: s.first.id },
      s.owner.cookie,
    );
    expect(left.status).toBe(400);
    expect(await projectRows(s.owner.id)).toHaveLength(1);
  });

  it("deleting the account removes the memberships with the user", async () => {
    await db
      .delete(schema.userTable)
      .where(eq(schema.userTable.id, s.guest.id));
    expect(await projectRows(s.guest.id)).toHaveLength(0);
  });

  it("deleting a project removes its memberships", async () => {
    await db
      .delete(schema.projectTable)
      .where(eq(schema.projectTable.id, s.p1.project.id));
    expect(await projectRows(s.guest.id)).toHaveLength(2);
  });
});

describe("a workspace role used as a project role cannot be deleted or renamed", () => {
  async function createRole(name: string) {
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: s.first.id,
      role: name,
      permission: JSON.stringify({ task: ["read"] }),
    });
  }

  async function useRole(name: string) {
    await db
      .update(schema.projectMemberTable)
      .set({ role: name })
      .where(
        and(
          eq(schema.projectMemberTable.projectId, s.p1.project.id),
          eq(schema.projectMemberTable.userId, s.guest.id),
        ),
      );
  }

  async function expectBlocked(response: Response) {
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code?: string }).code).toBe(
      "ROLE_IS_ASSIGNED_TO_PROJECT_MEMBERS",
    );
  }

  async function roleExists(name: string) {
    const rows = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, s.first.id),
          eq(schema.workspaceRoleTable.role, name),
        ),
      );
    return rows.length > 0;
  }

  it("blocks delete by name and by id, then allows it once unused", async () => {
    await createRole("triager");
    await useRole("triager");

    await expectBlocked(
      await authPost(
        "/organization/delete-role",
        { organizationId: s.first.id, roleName: "triager" },
        s.owner.cookie,
      ),
    );
    const [row] = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.role, "triager"));
    await expectBlocked(
      await authPost(
        "/organization/delete-role",
        { organizationId: s.first.id, roleId: row.id },
        s.owner.cookie,
      ),
    );
    expect(await roleExists("triager")).toBe(true);

    await useRole("member");
    const deleted = await authPost(
      "/organization/delete-role",
      { organizationId: s.first.id, roleName: "triager" },
      s.owner.cookie,
    );
    expect(deleted.status).toBe(200);
    expect(await roleExists("triager")).toBe(false);
  });

  it("resolves the workspace from the session when the body has none", async () => {
    await createRole("triager");
    await useRole("triager");
    await db
      .update(schema.sessionTable)
      .set({ activeOrganizationId: s.first.id })
      .where(eq(schema.sessionTable.userId, s.owner.id));

    await expectBlocked(
      await authPost(
        "/organization/delete-role",
        { roleName: "triager" },
        s.owner.cookie,
      ),
    );
    expect(await roleExists("triager")).toBe(true);
  });

  it("blocks a role used only by a pending project invitation", async () => {
    await createRole("triager");
    const [invitation] = await db
      .insert(schema.invitationTable)
      .values({
        workspaceId: s.first.id,
        email: "pending@example.com",
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 86_400_000),
        inviterId: s.owner.id,
      })
      .returning();
    await db.insert(schema.invitationProjectTable).values({
      invitationId: invitation.id,
      projectId: s.p1.project.id,
      role: "triager",
    });
    await expectBlocked(
      await authPost(
        "/organization/delete-role",
        { organizationId: s.first.id, roleName: "triager" },
        s.owner.cookie,
      ),
    );
  });

  it("scopes a pending invitation to the workspace of the invited project", async () => {
    await createRole("triager");
    const [invitation] = await db
      .insert(schema.invitationTable)
      .values({
        workspaceId: s.first.id,
        email: "other@example.com",
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 86_400_000),
        inviterId: s.owner.id,
      })
      .returning();
    // The invitation belongs to `first`, but the project it names is in
    // `second`: the role would be granted there, not here.
    await db.insert(schema.invitationProjectTable).values({
      invitationId: invitation.id,
      projectId: s.p3.project.id,
      role: "triager",
    });
    const deleted = await authPost(
      "/organization/delete-role",
      { organizationId: s.first.id, roleName: "triager" },
      s.owner.cookie,
    );
    expect(deleted.status).toBe(200);
  });

  it("does not answer for callers Better Auth would refuse", async () => {
    await createRole("triager");
    await useRole("triager");
    const stranger = await signUp("stranger");
    // guest is a plain member of the workspace: no ac:delete / ac:update.
    for (const actor of [stranger, s.guest]) {
      for (const [path, body] of [
        [
          "/organization/delete-role",
          { organizationId: s.first.id, roleName: "triager" },
        ],
        [
          "/organization/update-role",
          {
            organizationId: s.first.id,
            roleName: "triager",
            data: { roleName: "sorter" },
          },
        ],
      ] as const) {
        const response = await authPost(path, body, actor.cookie);
        expect(response.status).toBe(403);
        const code = ((await response.json()) as { code?: string }).code;
        expect(code).not.toBe("ROLE_IS_ASSIGNED_TO_PROJECT_MEMBERS");
      }
    }
    // Nobody logged in: Better Auth's own 401.
    const anonymous = await app.request("/api/auth/organization/delete-role", {
      method: "POST",
      headers: { "content-type": "application/json", Origin: origin },
      body: JSON.stringify({
        organizationId: s.first.id,
        roleName: "triager",
      }),
    });
    expect(anonymous.status).toBe(401);
    expect(await roleExists("triager")).toBe(true);
  });

  it("leaves owner to Better Auth but guards the other default roles", async () => {
    const owner = await authPost(
      "/organization/delete-role",
      { organizationId: s.first.id, roleName: "owner" },
      s.owner.cookie,
    );
    expect(owner.status).toBe(400);
    expect(((await owner.json()) as { code?: string }).code).toBe(
      "CANNOT_DELETE_A_PRE_DEFINED_ROLE",
    );

    // viewer, member and admin are dynamic catalog rows that Better Auth would
    // let the owner delete or rename: while project members hold them, refuse.
    await useRole("viewer");
    await expectBlocked(
      await authPost(
        "/organization/delete-role",
        { organizationId: s.first.id, roleName: "viewer" },
        s.owner.cookie,
      ),
    );
    await expectBlocked(
      await authPost(
        "/organization/update-role",
        {
          organizationId: s.first.id,
          roleName: "viewer",
          data: { roleName: "watcher" },
        },
        s.owner.cookie,
      ),
    );
    expect(await roleExists("viewer")).toBe(true);
  });

  it("gives instance administrators no special treatment", async () => {
    await createRole("triager");
    await useRole("triager");
    const instanceAdmin = await signUp("instanceadmin");
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, instanceAdmin.id));
    // Not a member of the workspace: Better Auth refuses, so the guard stays
    // silent instead of answering in its place.
    const response = await authPost(
      "/organization/delete-role",
      { organizationId: s.first.id, roleName: "triager" },
      instanceAdmin.cookie,
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code?: string }).code).not.toBe(
      "ROLE_IS_ASSIGNED_TO_PROJECT_MEMBERS",
    );
    expect(await roleExists("triager")).toBe(true);
  });

  it("blocks a rename while used, but not permission edits", async () => {
    await createRole("triager");
    await useRole("triager");

    await expectBlocked(
      await authPost(
        "/organization/update-role",
        {
          organizationId: s.first.id,
          roleName: "triager",
          data: { roleName: "sorter" },
        },
        s.owner.cookie,
      ),
    );
    expect(await roleExists("triager")).toBe(true);
    expect(await roleExists("sorter")).toBe(false);

    const edited = await authPost(
      "/organization/update-role",
      {
        organizationId: s.first.id,
        roleName: "triager",
        data: { permission: { task: ["read", "update"] } },
      },
      s.owner.cookie,
    );
    expect(edited.status).toBe(200);

    await useRole("member");
    const renamed = await authPost(
      "/organization/update-role",
      {
        organizationId: s.first.id,
        roleName: "triager",
        data: { roleName: "sorter" },
      },
      s.owner.cookie,
    );
    expect(renamed.status).toBe(200);
    expect(await roleExists("sorter")).toBe(true);
  });

  it("does not let another workspace's project members block a role", async () => {
    await createRole("triager");
    await db
      .update(schema.projectMemberTable)
      .set({ role: "triager" })
      .where(eq(schema.projectMemberTable.projectId, s.p3.project.id));
    const deleted = await authPost(
      "/organization/delete-role",
      { organizationId: s.first.id, roleName: "triager" },
      s.owner.cookie,
    );
    expect(deleted.status).toBe(200);
  });
});

describe("sockets close at once when access ends", () => {
  // No fake timers and no waiting: the close must be part of the request that
  // ended the access, not a later delivery after the revalidation window.
  const opened: Array<{ projectId: string; conn: unknown }> = [];

  function socket(projectId: string, userId: string, workspaceId: string) {
    const ws = { send: vi.fn(), close: vi.fn() };
    const conn = addConnection(
      projectId,
      ws as never,
      userId,
      `${userId}-window`,
      workspaceId,
    );
    opened.push({ projectId, conn });
    return ws;
  }

  function sockets() {
    return {
      first: socket(s.p1.project.id, s.guest.id, s.first.id),
      second: socket(s.p2.project.id, s.guest.id, s.first.id),
      otherWorkspace: socket(s.p3.project.id, s.guest.id, s.second.id),
      owner: socket(s.p1.project.id, s.owner.id, s.first.id),
    };
  }

  afterEach(() => {
    for (const { projectId, conn } of opened.splice(0)) {
      removeConnection(projectId, conn as never);
    }
  });

  function api(method: string, path: string, cookie: string, body?: unknown) {
    return app.request(`/api${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        Origin: origin,
        Cookie: cookie,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  it("removing a workspace member closes their sockets in that workspace only", async () => {
    const open = sockets();
    const removed = await authPost(
      "/organization/remove-member",
      { organizationId: s.first.id, memberIdOrEmail: s.guest.memberId },
      s.owner.cookie,
    );
    expect(removed.status).toBe(200);
    expect(open.first.close).toHaveBeenCalledWith(
      1008,
      "Project access revoked",
    );
    expect(open.second.close).toHaveBeenCalledWith(
      1008,
      "Project access revoked",
    );
    expect(open.otherWorkspace.close).not.toHaveBeenCalled();
    expect(open.owner.close).not.toHaveBeenCalled();
  });

  it("leaving a workspace closes the leaver's sockets in that workspace only", async () => {
    const open = sockets();
    const left = await authPost(
      "/organization/leave",
      { organizationId: s.first.id },
      s.guest.cookie,
    );
    expect(left.status).toBe(200);
    expect(open.first.close).toHaveBeenCalledWith(
      1008,
      "Project access revoked",
    );
    expect(open.second.close).toHaveBeenCalledWith(
      1008,
      "Project access revoked",
    );
    expect(open.otherWorkspace.close).not.toHaveBeenCalled();
    expect(open.owner.close).not.toHaveBeenCalled();
  });

  it("a refused leave closes nothing", async () => {
    const open = sockets();
    const left = await authPost(
      "/organization/leave",
      { organizationId: s.first.id },
      s.owner.cookie,
    );
    expect(left.status).toBe(400);
    expect(open.owner.close).not.toHaveBeenCalled();
    expect(open.first.close).not.toHaveBeenCalled();
  });

  it("removing a project member closes their sockets on that project only", async () => {
    const open = sockets();
    const removed = await api(
      "DELETE",
      `/project/${s.p1.project.id}/members/${s.guest.id}`,
      s.owner.cookie,
    );
    expect(removed.status).toBe(200);
    expect(open.first.close).toHaveBeenCalledWith(
      1008,
      "Project access revoked",
    );
    expect(open.second.close).not.toHaveBeenCalled();
    expect(open.otherWorkspace.close).not.toHaveBeenCalled();
    expect(open.owner.close).not.toHaveBeenCalled();
  });

  it("a member leaving a project closes their own sockets there", async () => {
    const open = sockets();
    const left = await api(
      "DELETE",
      `/project/${s.p2.project.id}/members/${s.guest.id}`,
      s.guest.cookie,
    );
    expect(left.status).toBe(200);
    expect(open.second.close).toHaveBeenCalledWith(
      1008,
      "Project access revoked",
    );
    expect(open.first.close).not.toHaveBeenCalled();
  });

  it("changing a project member's role closes their sockets on that project", async () => {
    const open = sockets();
    const changed = await api(
      "PATCH",
      `/project/${s.p1.project.id}/members/${s.guest.id}`,
      s.owner.cookie,
      { role: "viewer" },
    );
    expect(changed.status).toBe(200);
    expect(open.first.close).toHaveBeenCalledWith(
      1008,
      "Project access revoked",
    );
    expect(open.second.close).not.toHaveBeenCalled();
  });

  it("a refused removal closes nothing", async () => {
    const open = sockets();
    // A member without member:delete cannot remove somebody else.
    const denied = await api(
      "DELETE",
      `/project/${s.p1.project.id}/members/${s.owner.id}`,
      s.guest.cookie,
    );
    expect(denied.status).toBeGreaterThanOrEqual(400);
    expect(open.owner.close).not.toHaveBeenCalled();
    expect(open.first.close).not.toHaveBeenCalled();
  });
});
