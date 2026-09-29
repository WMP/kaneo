import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { defaultRolePayloads } from "../../packages/permissions/src";
import { resetTestDatabase } from "./helpers/database";

const origin = "http://localhost:5173";
const { app } = createApp();

type Actor = {
  id: string;
  cookie: string;
  token: string;
  memberId: string;
};

async function post(path: string, body: unknown, cookie: string) {
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
      email: `${name}@example.com`,
      password: "long-password-for-tests",
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  // Bearer plugin: the signed session token, usable without the cookie.
  const token = response.headers.get("set-auth-token") ?? "";
  expect(token).not.toBe("");
  return { id: body.user.id, cookie, token };
}

const memberStatements = defaultRolePayloads.member;

let workspaceId: string;
let actors: Record<string, Actor>;

async function addMember(name: string, role: string) {
  const user = await signUp(name);
  const [member] = await db
    .insert(schema.workspaceUserTable)
    .values({ workspaceId, userId: user.id, role, joinedAt: new Date() })
    .returning();
  return { ...user, memberId: member.id };
}

async function storedRole(actor: Actor) {
  const [row] = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(eq(schema.workspaceUserTable.id, actor.memberId));
  return row?.role;
}

async function invitations(email: string) {
  return db
    .select()
    .from(schema.invitationTable)
    .where(
      and(
        eq(schema.invitationTable.workspaceId, workspaceId),
        eq(schema.invitationTable.email, email),
      ),
    );
}

// What a rejected re-send must leave untouched.
async function invitationState(email: string) {
  return (await invitations(email))
    .map(({ id, role, status, expiresAt }) => ({
      id,
      role,
      status,
      expiresAt: expiresAt.getTime(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Bearer-only request: no cookie, so only Better Auth's bearer plugin can
// resolve the session.
function postWithBearer(path: string, body: unknown, token: string) {
  return app.request(`/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: origin,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

function invite(actor: Actor, email: string, role: string, resend?: boolean) {
  return post(
    "/organization/invite-member",
    { organizationId: workspaceId, email, role, ...(resend ? { resend } : {}) },
    actor.cookie,
  );
}

function setRole(actor: Actor, target: Actor, role: string) {
  return post(
    "/organization/update-member-role",
    { organizationId: workspaceId, memberId: target.memberId, role },
    actor.cookie,
  );
}

async function expectForbidden(response: Response, code: string) {
  expect(response.status).toBe(403);
  expect(((await response.json()) as { code?: string }).code).toBe(code);
}

beforeEach(async () => {
  await resetTestDatabase();

  // The first registered user becomes instance administrator; burn that slot
  // so none of the actors below are accidentally instance admins.
  await signUp("throwaway");

  const [workspace] = await db
    .insert(schema.workspaceTable)
    .values({
      id: "delegation-workspace",
      name: "Delegation",
      slug: "delegation",
      createdAt: new Date(),
    })
    .returning();
  workspaceId = workspace.id;

  const now = new Date();
  const role = (name: string, permission: Record<string, string[]>) => ({
    workspaceId,
    role: name,
    permission: JSON.stringify(permission),
    createdAt: now,
    updatedAt: now,
  });
  await db
    .insert(schema.workspaceRoleTable)
    .values([
      role("viewer", defaultRolePayloads.viewer),
      role("member", defaultRolePayloads.member),
      role("admin", defaultRolePayloads.admin),
      role("inviter", { ...memberStatements, invitation: ["create"] }),
      role("manager", { ...memberStatements, member: ["update"] }),
      role("elevated", { ...memberStatements, workspace: ["delete", "read"] }),
      role("zeta", { task: ["read"] }),
    ]);

  actors = {
    owner: await addMember("owner", "owner"),
    admin: await addMember("admin", "admin"),
    inviter: await addMember("inviter", "inviter"),
    manager: await addMember("manager", "manager"),
    viewer: await addMember("viewer", "viewer"),
    admin2: await addMember("admintwo", "admin"),
  };
});

describe("invitations cannot exceed the inviter's permissions", () => {
  it("lets a delegated inviter invite only roles within their own permissions", async () => {
    const { inviter } = actors;

    await expectForbidden(
      await invite(inviter, "a1@example.com", "admin"),
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    expect(await invitations("a1@example.com")).toHaveLength(0);

    expect((await invite(inviter, "v1@example.com", "viewer")).status).toBe(
      200,
    );
    expect(await invitations("v1@example.com")).toHaveLength(1);

    await expectForbidden(
      await invite(inviter, "e1@example.com", "elevated"),
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    expect(await invitations("e1@example.com")).toHaveLength(0);
  });

  it("applies the subset rule to admins, owners and instance admins", async () => {
    const { admin, owner } = actors;

    expect((await invite(admin, "b1@example.com", "admin")).status).toBe(200);

    await expectForbidden(
      await invite(admin, "b2@example.com", "elevated"),
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    expect(await invitations("b2@example.com")).toHaveLength(0);

    expect((await invite(owner, "b3@example.com", "admin")).status).toBe(200);

    // An instance admin bypasses the subset rule even when their workspace
    // role (custom `inviter`) is narrower than the invited role.
    const instanceAdmin = await addMember("instanceadmin", "inviter");
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, instanceAdmin.id));
    expect(
      (await invite(instanceAdmin, "b4@example.com", "admin")).status,
    ).toBe(200);
  });

  it("checks the existing invitation's role when re-sending", async () => {
    const { owner, inviter } = actors;

    expect((await invite(owner, "r1@example.com", "admin")).status).toBe(200);
    const before = await invitationState("r1@example.com");
    await expectForbidden(
      await invite(inviter, "r1@example.com", "viewer", true),
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    expect(await invitationState("r1@example.com")).toEqual(before);

    expect((await invite(owner, "r2@example.com", "viewer")).status).toBe(200);
    expect(
      (await invite(inviter, "r2@example.com", "viewer", true)).status,
    ).toBe(200);
    // Re-sending never creates a second invitation.
    expect(await invitations("r2@example.com")).toHaveLength(1);
  });
});

describe("member role changes", () => {
  it("forbids changing your own role unless you are an owner", async () => {
    const { manager, admin } = actors;

    await expectForbidden(
      await setRole(manager, manager, "admin"),
      "YOU_CANNOT_CHANGE_YOUR_OWN_ROLE",
    );
    expect(await storedRole(manager)).toBe("manager");

    await expectForbidden(
      await setRole(admin, admin, "viewer"),
      "YOU_CANNOT_CHANGE_YOUR_OWN_ROLE",
    );
    expect(await storedRole(admin)).toBe("admin");
  });

  it("only lets a delegated manager move members within their own permissions", async () => {
    const { manager, viewer, admin2 } = actors;

    expect((await setRole(manager, viewer, "member")).status).toBe(200);
    expect(await storedRole(viewer)).toBe("member");

    await expectForbidden(
      await setRole(manager, viewer, "admin"),
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    expect(await storedRole(viewer)).toBe("member");

    await expectForbidden(
      await setRole(manager, admin2, "viewer"),
      "YOU_CANNOT_MANAGE_THIS_MEMBER",
    );
    expect(await storedRole(admin2)).toBe("admin");
  });

  it("lets an owner change an admin's role", async () => {
    const { owner, admin2 } = actors;

    expect((await setRole(owner, admin2, "viewer")).status).toBe(200);
    expect(await storedRole(admin2)).toBe("viewer");
  });
});

describe("role delegation holds for every way of authenticating", () => {
  function bearerSetRole(actor: Actor, memberId: string, role: string) {
    return postWithBearer(
      "/organization/update-member-role",
      { organizationId: workspaceId, memberId, role },
      actor.token,
    );
  }

  it("blocks a bearer-authenticated manager from escalating a role", async () => {
    const { manager, viewer, admin2 } = actors;

    await expectForbidden(
      await bearerSetRole(manager, viewer.memberId, "admin"),
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    expect(await storedRole(viewer)).toBe("viewer");

    await expectForbidden(
      await bearerSetRole(manager, manager.memberId, "admin"),
      "YOU_CANNOT_CHANGE_YOUR_OWN_ROLE",
    );
    expect(await storedRole(manager)).toBe("manager");

    await expectForbidden(
      await bearerSetRole(manager, admin2.memberId, "viewer"),
      "YOU_CANNOT_MANAGE_THIS_MEMBER",
    );
    expect(await storedRole(admin2)).toBe("admin");

    // The same token still works within the manager's own permissions.
    expect(
      (await bearerSetRole(manager, viewer.memberId, "member")).status,
    ).toBe(200);
    expect(await storedRole(viewer)).toBe("member");
  });

  it("blocks an API-key-authenticated manager from escalating a role", async () => {
    const { manager, viewer } = actors;

    const created = await post(
      "/api-key/create",
      { name: "delegation" },
      manager.cookie,
    );
    expect(created.status).toBe(200);
    const { key } = (await created.json()) as { key: string };
    expect(key).toBeTruthy();

    // `x-api-key` only: no cookie and no Authorization header.
    const withKey = (role: string) =>
      app.request("/api/auth/organization/update-member-role", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: origin,
          "x-api-key": key,
        },
        body: JSON.stringify({
          organizationId: workspaceId,
          memberId: viewer.memberId,
          role,
        }),
      });

    await expectForbidden(
      await withKey("admin"),
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    expect(await storedRole(viewer)).toBe("viewer");

    expect((await withKey("member")).status).toBe(200);
    expect(await storedRole(viewer)).toBe("member");
  });

  it("blocks an API-key-authenticated inviter from re-sending an admin invitation", async () => {
    const { owner, inviter } = actors;

    const created = await post(
      "/api-key/create",
      { name: "delegation-resend" },
      inviter.cookie,
    );
    expect(created.status).toBe(200);
    const { key } = (await created.json()) as { key: string };

    // `x-api-key` only: no cookie and no Authorization header.
    const resendWithKey = (email: string) =>
      app.request("/api/auth/organization/invite-member", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: origin,
          "x-api-key": key,
        },
        body: JSON.stringify({
          organizationId: workspaceId,
          email,
          role: "viewer",
          resend: true,
        }),
      });

    expect((await invite(owner, "keyed@example.com", "admin")).status).toBe(
      200,
    );
    const before = await invitationState("keyed@example.com");
    await expectForbidden(
      await resendWithKey("keyed@example.com"),
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    expect(await invitationState("keyed@example.com")).toEqual(before);

    // An allowed re-send with the same key still succeeds even though the
    // key is checked twice (our session lookup and the endpoint's own hook).
    expect((await invite(owner, "keyed-ok@example.com", "viewer")).status).toBe(
      200,
    );
    const [sent] = await invitationState("keyed-ok@example.com");
    const response = await resendWithKey("keyed-ok@example.com");
    expect(response.status).toBe(200);
    const after = await invitationState("keyed-ok@example.com");
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(sent.id);
    expect(after[0].role).toBe("viewer");
    expect(after[0].status).toBe("pending");
  });

  it("blocks a bearer-authenticated inviter from re-sending an admin invitation", async () => {
    const { owner, inviter } = actors;

    expect((await invite(owner, "bearer@example.com", "admin")).status).toBe(
      200,
    );
    const before = await invitationState("bearer@example.com");

    await expectForbidden(
      await postWithBearer(
        "/organization/invite-member",
        {
          organizationId: workspaceId,
          email: "bearer@example.com",
          role: "viewer",
          resend: true,
        },
        inviter.token,
      ),
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    const after = await invitationState("bearer@example.com");
    expect(after).toHaveLength(1);
    expect(after).toEqual(before);
  });

  it("does not let an empty organizationId skip the check when an organization is active", async () => {
    const { manager, viewer, inviter, owner } = actors;

    for (const actor of [manager, inviter]) {
      await db
        .update(schema.sessionTable)
        .set({ activeOrganizationId: workspaceId })
        .where(eq(schema.sessionTable.userId, actor.id));
    }

    await expectForbidden(
      await postWithBearer(
        "/organization/update-member-role",
        { organizationId: "", memberId: viewer.memberId, role: "admin" },
        manager.token,
      ),
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    expect(await storedRole(viewer)).toBe("viewer");

    expect((await invite(owner, "empty@example.com", "admin")).status).toBe(
      200,
    );
    const before = await invitationState("empty@example.com");
    await expectForbidden(
      await post(
        "/organization/invite-member",
        {
          organizationId: "",
          email: "empty@example.com",
          role: "viewer",
          resend: true,
        },
        inviter.cookie,
      ),
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    expect(await invitationState("empty@example.com")).toEqual(before);
  });

  it("does not treat an expired pending invitation as the one being re-sent", async () => {
    const { owner, inviter } = actors;

    await db.insert(schema.invitationTable).values({
      workspaceId,
      email: "expired@example.com",
      role: "admin",
      status: "pending",
      expiresAt: new Date(Date.now() - 60_000),
      inviterId: owner.id,
    });

    // Better Auth ignores the expired row and creates a fresh invitation,
    // which `beforeCreateInvitation` checks against the requested role.
    const response = await invite(
      inviter,
      "expired@example.com",
      "viewer",
      true,
    );
    expect(response.status).not.toBe(403);
    expect(response.status).toBe(200);

    const roles = (await invitations("expired@example.com"))
      .map((row) => row.role)
      .sort();
    expect(roles).toEqual(["admin", "viewer"]);
  });

  it("answers an unknown role with Better Auth's validation error", async () => {
    const { manager, viewer } = actors;

    const response = await setRole(manager, viewer, "no-such-role");
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code?: string }).code).toBe(
      "ROLE_NOT_FOUND",
    );
    expect(await storedRole(viewer)).toBe("viewer");
  });
});

describe("GET /api/workspace/{id}/assignable-roles", () => {
  async function assignable(actor: Actor, id = workspaceId) {
    const response = await app.request(
      `/api/workspace/${id}/assignable-roles`,
      {
        headers: { Cookie: actor.cookie },
      },
    );
    return {
      status: response.status,
      roles: response.ok
        ? (
            (await response.json()) as {
              roles: { role: string; isDefault: boolean }[];
            }
          ).roles
        : [],
    };
  }

  it("limits a delegated inviter to roles within their permissions", async () => {
    const { status, roles } = await assignable(actors.inviter);
    expect(status).toBe(200);
    const names = roles.map((entry) => entry.role);
    expect(names).toContain("viewer");
    expect(names).toContain("member");
    expect(names).toContain("zeta");
    expect(names).not.toContain("admin");
    expect(names).not.toContain("elevated");
    expect(names).not.toContain("owner");
  });

  it("gives an owner every role except owner, defaults first", async () => {
    const { status, roles } = await assignable(actors.owner);
    expect(status).toBe(200);
    expect(roles).toEqual([
      { role: "viewer", isDefault: true },
      { role: "member", isDefault: true },
      { role: "admin", isDefault: true },
      { role: "elevated", isDefault: false },
      { role: "inviter", isDefault: false },
      { role: "manager", isDefault: false },
      { role: "zeta", isDefault: false },
    ]);
  });

  it("denies a user from another workspace", async () => {
    const outsider = await signUp("outsider");
    const { status } = await assignable({ ...outsider, memberId: "" });
    expect(status).toBe(403);
  });
});
