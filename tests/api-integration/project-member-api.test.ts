import { createHash, randomUUID } from "node:crypto";
import type { User } from "better-auth/types";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import * as delegation from "../../apps/api/src/project-member/delegation";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

vi.mock("../../apps/api/src/events", async (original) => ({
  ...(await original<object>()),
  publishEvent: vi.fn(async () => undefined),
}));

const { app } = createApp();

type Member = {
  userId: string;
  name: string;
  email: string;
  role: string;
  source: "project" | "full-access";
  active: boolean;
};

async function buildWorld() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const workspaceId = owner.workspace.id;
  const { project } = await createProjectFixture({
    workspaceId,
    members: "none",
  });
  // The owner's own membership row, as project creation leaves behind.
  await addProjectMember(project.id, owner.user.id, "admin");

  // Custom roles: `inviter` may manage members but only holds task:read
  // itself, so it can hand out nothing beyond task:read.
  await db.insert(schema.workspaceRoleTable).values([
    {
      workspaceId,
      role: "inviter",
      permission: JSON.stringify({
        member: ["create", "update", "delete"],
        task: ["read"],
      }),
    },
    {
      workspaceId,
      role: "reader",
      permission: JSON.stringify({ task: ["read"] }),
    },
  ]);

  const projectAdmin = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(project.id, projectAdmin.id, "admin");
  const projectViewer = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(project.id, projectViewer.id, "viewer");
  const inviter = await addWorkspaceMember(workspaceId, "viewer");
  await addProjectMember(project.id, inviter.id, "inviter");
  const fullAdmin = await addWorkspaceMember(workspaceId, "admin");
  await addProjectMember(project.id, fullAdmin.id, "admin");
  const workspaceOnly = await addWorkspaceMember(workspaceId, "member");
  const candidate = await addWorkspaceMember(workspaceId, "member");
  const outsider = await createWorkspaceMember({ role: "owner" });

  return {
    owner,
    workspaceId,
    project,
    projectAdmin,
    projectViewer,
    inviter,
    fullAdmin,
    workspaceOnly,
    candidate,
    outsider,
  };
}
type World = Awaited<ReturnType<typeof buildWorld>>;

function as(user: unknown) {
  mockAuthenticatedSession(user as User);
}

function call(path: string, method: string, body?: unknown) {
  return app.request(`/api${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

const members = (w: World) => `/project/${w.project.id}/members`;
const member = (w: World, userId: string) => `${members(w)}/${userId}`;

async function rowOf(w: World, userId: string) {
  const [row] = await db
    .select()
    .from(schema.projectMemberTable)
    .where(
      and(
        eq(schema.projectMemberTable.projectId, w.project.id),
        eq(schema.projectMemberTable.userId, userId),
      ),
    );
  return row;
}

async function expectError(response: Response, status: number, text: string) {
  expect(response.status).toBe(status);
  expect(await response.text()).toBe(text);
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("GET /project/{id}/members", () => {
  it("lists project members and full-access members, not workspace-only members", async () => {
    const w = await buildWorld();
    // A stale row of somebody who is no longer in the workspace.
    const stale = await addWorkspaceMember(w.workspaceId, "member");
    await addProjectMember(w.project.id, stale.id, "member");
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, stale.id));

    as(w.projectViewer);
    const response = await call(members(w), "GET");
    expect(response.status).toBe(200);
    const list = (await response.json()) as Member[];
    const byId = new Map(list.map((entry) => [entry.userId, entry]));

    expect(byId.get(w.owner.user.id)).toMatchObject({
      role: "owner",
      source: "full-access",
    });
    expect(byId.get(w.fullAdmin.id)).toMatchObject({
      role: "admin",
      source: "full-access",
    });
    expect(byId.get(w.projectAdmin.id)).toMatchObject({
      role: "admin",
      source: "project",
    });
    expect(byId.get(w.projectViewer.id)).toMatchObject({
      role: "viewer",
      source: "project",
    });
    expect(byId.has(w.workspaceOnly.id)).toBe(false);
    expect(byId.has(stale.id)).toBe(false);
    expect(byId.get(w.projectAdmin.id)).toHaveProperty("email");
    expect(list.every((entry) => entry.active)).toBe(true);
    // Each person appears once, even the owner who also has a project row.
    expect(new Set(list.map((entry) => entry.userId)).size).toBe(list.length);
  });

  it("refuses callers without project access", async () => {
    const w = await buildWorld();
    as(w.workspaceOnly);
    await expectError(
      await call(members(w), "GET"),
      403,
      "You don't have access to this project",
    );
    as(w.outsider.user);
    await expectError(
      await call(members(w), "GET"),
      403,
      "You don't have access to this workspace",
    );
  });
});

describe("POST /project/{id}/members", () => {
  it("adds a workspace member with a project role", async () => {
    const w = await buildWorld();
    as(w.projectAdmin);
    const response = await call(members(w), "POST", {
      userId: w.candidate.id,
      role: "member",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      userId: w.candidate.id,
      role: "member",
      source: "project",
    });
    expect((await rowOf(w, w.candidate.id))?.role).toBe("member");

    // The new member can now open the project.
    as(w.candidate);
    expect((await call(`/project/${w.project.id}`, "GET")).status).toBe(200);
  });

  it("rejects duplicates, unknown users, unknown roles and owner", async () => {
    const w = await buildWorld();
    as(w.projectAdmin);
    await expectError(
      await call(members(w), "POST", {
        userId: w.projectViewer.id,
        role: "member",
      }),
      409,
      "User is already a member of this project",
    );
    await expectError(
      await call(members(w), "POST", {
        userId: w.outsider.user.id,
        role: "member",
      }),
      404,
      "User is not a member of this workspace",
    );
    await expectError(
      await call(members(w), "POST", {
        userId: w.candidate.id,
        role: "does-not-exist",
      }),
      400,
      "Unknown role",
    );
    await expectError(
      await call(members(w), "POST", {
        userId: w.candidate.id,
        role: "owner",
      }),
      400,
      "The owner role cannot be a project role",
    );
    expect(await rowOf(w, w.candidate.id)).toBeUndefined();
  });

  it("does not add somebody who already has full access", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    const [row] = await db
      .delete(schema.projectMemberTable)
      .where(eq(schema.projectMemberTable.userId, w.fullAdmin.id))
      .returning();
    expect(row).toBeDefined();
    await expectError(
      await call(members(w), "POST", {
        userId: w.fullAdmin.id,
        role: "viewer",
      }),
      409,
      "User already has full access to this project",
    );
  });

  it("needs member:create in the caller's project role", async () => {
    const w = await buildWorld();
    as(w.projectViewer);
    await expectError(
      await call(members(w), "POST", {
        userId: w.candidate.id,
        role: "viewer",
      }),
      403,
      "Insufficient permissions",
    );
    as(w.workspaceOnly);
    await expectError(
      await call(members(w), "POST", {
        userId: w.candidate.id,
        role: "viewer",
      }),
      403,
      "You don't have access to this project",
    );
  });

  it("only hands out roles within the caller's own permissions", async () => {
    const w = await buildWorld();
    as(w.inviter);
    // inviter only holds task:read (plus member management): viewer, member
    // and admin all carry more.
    for (const role of ["viewer", "member", "admin"]) {
      await expectError(
        await call(members(w), "POST", { userId: w.candidate.id, role }),
        403,
        "You cannot assign a role with permissions you do not have",
      );
    }
    expect(await rowOf(w, w.candidate.id)).toBeUndefined();

    const ok = await call(members(w), "POST", {
      userId: w.candidate.id,
      role: "reader",
    });
    expect(ok.status).toBe(200);
  });

  it("lets a project admin assign admin but never owner", async () => {
    const w = await buildWorld();
    as(w.projectAdmin);
    expect(
      (
        await call(members(w), "POST", {
          userId: w.candidate.id,
          role: "admin",
        })
      ).status,
    ).toBe(200);
    as(w.owner.user);
    await expectError(
      await call(members(w), "POST", {
        userId: w.workspaceOnly.id,
        role: "owner",
      }),
      400,
      "The owner role cannot be a project role",
    );
  });
});

describe("PATCH /project/{id}/members/{userId}", () => {
  it("changes a member's role", async () => {
    const w = await buildWorld();
    as(w.projectAdmin);
    const response = await call(member(w, w.projectViewer.id), "PATCH", {
      role: "member",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      userId: w.projectViewer.id,
      role: "member",
      source: "project",
    });
    expect((await rowOf(w, w.projectViewer.id))?.role).toBe("member");
  });

  it("refuses to change your own role unless unrestricted", async () => {
    const w = await buildWorld();
    as(w.projectAdmin);
    await expectError(
      await call(member(w, w.projectAdmin.id), "PATCH", { role: "viewer" }),
      403,
      "You cannot change your own project role",
    );
    expect((await rowOf(w, w.projectAdmin.id))?.role).toBe("admin");

    as(w.owner.user);
    expect(
      (await call(member(w, w.owner.user.id), "PATCH", { role: "viewer" }))
        .status,
    ).toBe(400);
  });

  it("checks both the member's current role and the new role against the caller", async () => {
    const w = await buildWorld();
    as(w.inviter);
    // The current role (viewer) is beyond the inviter's permissions.
    await expectError(
      await call(member(w, w.projectViewer.id), "PATCH", { role: "reader" }),
      403,
      "You cannot manage a member with permissions you do not have",
    );
    // A member within the inviter's reach cannot be promoted past it.
    await addProjectMember(w.project.id, w.candidate.id, "reader");
    await expectError(
      await call(member(w, w.candidate.id), "PATCH", { role: "admin" }),
      403,
      "You cannot assign a role with permissions you do not have",
    );
    expect((await rowOf(w, w.candidate.id))?.role).toBe("reader");
  });

  it("rejects owner, unknown roles, non-members and full-access members", async () => {
    const w = await buildWorld();
    as(w.projectAdmin);
    await expectError(
      await call(member(w, w.projectViewer.id), "PATCH", { role: "owner" }),
      400,
      "The owner role cannot be a project role",
    );
    await expectError(
      await call(member(w, w.projectViewer.id), "PATCH", { role: "nope" }),
      400,
      "Unknown role",
    );
    await expectError(
      await call(member(w, w.candidate.id), "PATCH", { role: "viewer" }),
      404,
      "User is not a member of this project",
    );
    await expectError(
      await call(member(w, w.fullAdmin.id), "PATCH", { role: "viewer" }),
      400,
      "Members with full access cannot be changed or removed at project level",
    );
  });

  it("needs member:update", async () => {
    const w = await buildWorld();
    as(w.projectViewer);
    await expectError(
      await call(member(w, w.projectAdmin.id), "PATCH", { role: "viewer" }),
      403,
      "Insufficient permissions",
    );
  });
});

describe("DELETE /project/{id}/members/{userId}", () => {
  it("removes a member and closes their access", async () => {
    const w = await buildWorld();
    as(w.projectAdmin);
    const response = await call(member(w, w.projectViewer.id), "DELETE");
    expect(response.status).toBe(200);
    expect(await rowOf(w, w.projectViewer.id)).toBeUndefined();

    as(w.projectViewer);
    await expectError(
      await call(`/project/${w.project.id}`, "GET"),
      403,
      "You don't have access to this project",
    );
  });

  it("lets anybody leave the project, without member:delete", async () => {
    const w = await buildWorld();
    as(w.projectViewer);
    const response = await call(member(w, w.projectViewer.id), "DELETE");
    expect(response.status).toBe(200);
    expect(await rowOf(w, w.projectViewer.id)).toBeUndefined();
  });

  it("needs member:delete to remove somebody else", async () => {
    const w = await buildWorld();
    as(w.projectViewer);
    await expectError(
      await call(member(w, w.projectAdmin.id), "DELETE"),
      403,
      "Insufficient permissions",
    );
    expect(await rowOf(w, w.projectAdmin.id)).toBeDefined();
  });

  it("refuses to remove a member with permissions beyond the caller's", async () => {
    const w = await buildWorld();
    as(w.inviter);
    await expectError(
      await call(member(w, w.projectAdmin.id), "DELETE"),
      403,
      "You cannot manage a member with permissions you do not have",
    );
    await addProjectMember(w.project.id, w.candidate.id, "reader");
    expect((await call(member(w, w.candidate.id), "DELETE")).status).toBe(200);
  });

  it("does not remove full-access members, not even themselves", async () => {
    const w = await buildWorld();
    const message =
      "Members with full access cannot be changed or removed at project level";
    as(w.projectAdmin);
    await expectError(
      await call(member(w, w.owner.user.id), "DELETE"),
      400,
      message,
    );
    as(w.fullAdmin);
    await expectError(
      await call(member(w, w.fullAdmin.id), "DELETE"),
      400,
      message,
    );
    expect(await rowOf(w, w.owner.user.id)).toBeDefined();
  });

  it("answers 404 for somebody who is not a member", async () => {
    const w = await buildWorld();
    as(w.projectAdmin);
    await expectError(
      await call(member(w, w.candidate.id), "DELETE"),
      404,
      "User is not a member of this project",
    );
  });
});

describe("GET /project/{id}/assignable-roles", () => {
  async function rolesFor(w: World, user: unknown) {
    as(user);
    const response = await call(
      `/project/${w.project.id}/assignable-roles`,
      "GET",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      roles: { role: string; isDefault: boolean }[];
    };
    return body.roles.map((entry) => entry.role);
  }

  it("evaluates the caller's effective project role", async () => {
    const w = await buildWorld();
    // Owners and full-access administrators: everything but owner.
    expect(await rolesFor(w, w.owner.user)).toEqual([
      "viewer",
      "member",
      "admin",
      "inviter",
      "reader",
    ]);
    // A project admin holds the built-in admin permissions, not the custom
    // roles' `member` resource actions.
    const admin = await rolesFor(w, w.projectAdmin);
    expect(admin).toEqual(
      expect.arrayContaining(["viewer", "member", "admin"]),
    );
    expect(admin).not.toContain("owner");
    // A delegated inviter with only task:read can pass on task:read only.
    expect(await rolesFor(w, w.inviter)).toEqual(["inviter", "reader"]);
    // A project viewer holds no member permissions but can still see what it
    // could theoretically hold: viewer itself and narrower roles.
    expect(await rolesFor(w, w.projectViewer)).toEqual(
      expect.arrayContaining(["viewer", "reader"]),
    );
  });
});

describe("memberships whose role grants nothing", () => {
  async function withInertMember() {
    const w = await buildWorld();
    const inert = await addWorkspaceMember(w.workspaceId, "member");
    await addProjectMember(w.project.id, inert.id, "deleted-role");
    return { w, inert };
  }

  it("are listed as inactive", async () => {
    const { w, inert } = await withInertMember();
    as(w.projectAdmin);
    const list = (await (await call(members(w), "GET")).json()) as Member[];
    expect(list.find((entry) => entry.userId === inert.id)).toMatchObject({
      role: "deleted-role",
      source: "project",
      active: false,
    });
    expect(
      list.find((entry) => entry.userId === w.projectAdmin.id)?.active,
    ).toBe(true);
    // The inert member has no access.
    as(inert);
    await expectError(
      await call(`/project/${w.project.id}`, "GET"),
      403,
      "You don't have access to this project",
    );
  });

  it("can be removed by anybody with member:delete, whatever the role held", async () => {
    const { w, inert } = await withInertMember();
    // inviter cannot reach `deleted-role` (it resolves to nothing) but holds
    // member:delete, which is all cleaning up needs.
    as(w.inviter);
    expect((await call(member(w, inert.id), "DELETE")).status).toBe(200);
    expect(await rowOf(w, inert.id)).toBeUndefined();
  });

  it("need member:delete to be removed and can be re-assigned", async () => {
    const { w, inert } = await withInertMember();
    as(w.projectViewer);
    await expectError(
      await call(member(w, inert.id), "DELETE"),
      403,
      "Insufficient permissions",
    );
    as(w.projectAdmin);
    const reassigned = await call(member(w, inert.id), "PATCH", {
      role: "member",
    });
    expect(reassigned.status).toBe(200);
    expect(await reassigned.json()).toMatchObject({
      role: "member",
      active: true,
    });
  });
});

describe("changes racing with the delegation checks", () => {
  it("answers 409 when the member's role changed after it was checked", async () => {
    const w = await buildWorld();
    as(w.inviter);
    await addProjectMember(w.project.id, w.candidate.id, "reader");
    // Between the reach check and the write, somebody promotes the member.
    const spy = vi
      .spyOn(delegation, "assertCanManageRole")
      .mockImplementationOnce(async () => {
        await db
          .update(schema.projectMemberTable)
          .set({ role: "admin" })
          .where(eq(schema.projectMemberTable.userId, w.candidate.id));
      });
    await expectError(
      await call(member(w, w.candidate.id), "DELETE"),
      409,
      "The project membership changed, please retry",
    );
    expect((await rowOf(w, w.candidate.id))?.role).toBe("admin");
    spy.mockRestore();

    const patchSpy = vi
      .spyOn(delegation, "assertCanManageRole")
      .mockImplementationOnce(async () => {
        await db
          .update(schema.projectMemberTable)
          .set({ role: "viewer" })
          .where(eq(schema.projectMemberTable.userId, w.candidate.id));
      });
    as(w.projectAdmin);
    await expectError(
      await call(member(w, w.candidate.id), "PATCH", { role: "member" }),
      409,
      "The project membership changed, please retry",
    );
    expect((await rowOf(w, w.candidate.id))?.role).toBe("viewer");
    patchSpy.mockRestore();
  });
});

describe("API keys", () => {
  async function bearerFor(userId: string, permissions: object) {
    mockAnonymousSession();
    const key = `test_${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      referenceId: userId,
      userId,
      key: createHash("sha256").update(key).digest("base64url"),
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      permissions: JSON.stringify(permissions),
    });
    return key;
  }

  const withKey = (path: string, method: string, key: string) =>
    app.request(`/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}` },
    });

  it("leaving a project still needs member:delete in the key's scope", async () => {
    const w = await buildWorld();
    const narrow = await bearerFor(w.projectViewer.id, { task: ["read"] });
    await expectError(
      await withKey(member(w, w.projectViewer.id), "DELETE", narrow),
      403,
      "Insufficient API key scope",
    );
    expect(await rowOf(w, w.projectViewer.id)).toBeDefined();

    const wide = await bearerFor(w.projectViewer.id, { member: ["delete"] });
    expect(
      (await withKey(member(w, w.projectViewer.id), "DELETE", wide)).status,
    ).toBe(200);
  });
});
