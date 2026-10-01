import { randomUUID } from "node:crypto";
import * as email from "@kaneo/email";
import type { User } from "better-auth/types";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "../../apps/api/src/auth";

const { updateSubscriptionSeats } = vi.hoisted(() => ({
  updateSubscriptionSeats: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("../../apps/api/src/billing/creem-client", () => ({
  updateSubscriptionSeats,
  createCheckoutSession: vi.fn(),
  createCustomerPortalLink: vi.fn(),
}));

import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resolveProjectAccess } from "../../apps/api/src/utils/project-access";
import { mockAuthenticatedSession } from "./helpers/auth";
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

// `POST /api/workspace/{id}/members`: adding an existing account to a workspace
// without an invitation. Decided by `member:create` in the WORKSPACE role, the
// role delegation rule (a granted role must be within the caller's own, owner
// never), and the person (exists, not a guest, not banned, not a member yet).
// Better Auth's server-side `addMember` does the insert, so its hooks run.

const { app } = createApp();

const CLOUD_ENV = {
  KANEO_CLOUD: "true",
  // Cloud leaves the user directory (and with it adding accounts) off.
  ENABLE_USER_DIRECTORY: "true",
  CREEM_API_KEY: "creem_test_dummy",
  CREEM_WEBHOOK_SECRET: "whsec_dummy",
};
const savedEnv: Record<string, string | undefined> = {};

function as(user: unknown) {
  mockAuthenticatedSession(user as User);
}

function add(workspaceId: string, body: unknown) {
  return app.request(`/api/workspace/${workspaceId}/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type ErrorBody = { code: string; message: string };

async function expectCode(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(((await response.json()) as ErrorBody).code).toBe(code);
}

async function createAccount(
  name: string,
  overrides: Partial<typeof schema.userTable.$inferInsert> = {},
) {
  const id = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      name,
      email: `${id}@example.com`,
      emailVerified: true,
      ...overrides,
    })
    .returning();
  return user;
}

async function membershipRows(workspaceId: string, userId: string) {
  return db
    .select()
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    );
}

async function buildWorld() {
  const owner = await createWorkspaceMember({
    role: "owner",
    userName: "Olivia Owner",
    workspaceName: "Acme Workspace",
  });
  const workspaceId = owner.workspace.id;
  await db.insert(schema.workspaceRoleTable).values([
    {
      workspaceId,
      role: "adder",
      permission: JSON.stringify({ member: ["create"], task: ["read"] }),
    },
    {
      workspaceId,
      role: "reader",
      permission: JSON.stringify({ task: ["read"] }),
    },
    {
      workspaceId,
      role: "editor",
      permission: JSON.stringify({ task: ["read", "update"] }),
    },
  ]);
  const adder = await addWorkspaceMember(workspaceId, "adder");
  const plainMember = await addWorkspaceMember(workspaceId, "member");
  const newcomer = await createAccount("Nina Newcomer");
  const { project } = await createProjectFixture({
    workspaceId,
    members: "none",
  });
  return { owner, workspaceId, adder, plainMember, newcomer, project };
}

beforeEach(async () => {
  updateSubscriptionSeats.mockClear();
  await resetTestDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(CLOUD_ENV)) {
    if (key in savedEnv) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
});

describe("adding an existing account to a workspace", () => {
  it("adds the account with the role, notifies the person and reports the email", async () => {
    const w = await buildWorld();
    const sent = vi.spyOn(email, "sendMemberAddedEmail");
    as(w.owner.user);

    const response = await add(w.workspaceId, {
      userId: w.newcomer.id,
      role: "member",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: w.newcomer.id,
      name: "Nina Newcomer",
      email: w.newcomer.email,
      role: "member",
      emailAttempted: true,
      emailSent: true,
    });
    expect(typeof body.memberId).toBe("string");
    expect(typeof body.joinedAt).toBe("string");

    const rows = await membershipRows(w.workspaceId, w.newcomer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe("member");
    expect(rows[0]?.id).toBe(body.memberId);

    // In-app notification about the workspace, for the person only.
    const notifications = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, w.newcomer.id));
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: "workspace_member_added",
      resourceType: "workspace",
      resourceId: w.workspaceId,
    });
    expect(notifications[0]?.eventData).toMatchObject({
      workspaceId: w.workspaceId,
      workspaceName: "Acme Workspace",
      inviterName: "Olivia Owner",
      role: "member",
    });
    expect(
      await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.userId, w.owner.user.id)),
    ).toHaveLength(0);

    // The email: to the person, naming the inviter and the workspace, linking
    // to the workspace.
    expect(sent).toHaveBeenCalledTimes(1);
    const [to, subject, data] = sent.mock.calls[0] as [
      string,
      string,
      { workspaceLink: string; role: string; workspaceName: string },
    ];
    expect(to).toBe(w.newcomer.email);
    expect(subject).toContain("Olivia Owner");
    expect(subject).toContain("Acme Workspace");
    expect(data.role).toBe("member");
    expect(data.workspaceLink).toBe(
      `http://localhost:5173/dashboard/workspace/${w.workspaceId}`,
    );
  });

  it("uses the Polish copy for a Polish account and English for the rest", async () => {
    const w = await buildWorld();
    const sent = vi.spyOn(email, "sendMemberAddedEmail");
    const polish = await createAccount("Piotr Polak", { locale: "pl-PL" });
    const german = await createAccount("Gerda Deutsch", { locale: "de-DE" });
    as(w.owner.user);
    for (const person of [polish, german]) {
      expect(
        (await add(w.workspaceId, { userId: person.id, role: "viewer" }))
          .status,
      ).toBe(200);
    }
    const copies = sent.mock.calls.map(([, subject]) => subject as string);
    expect(copies[0]).toContain("dodał(a) Cię do obszaru roboczego");
    expect(copies[1]).toContain("added you to Acme Workspace");
  });

  it("does not fail when the email cannot be sent, and says so", async () => {
    const w = await buildWorld();
    vi.spyOn(email, "sendMemberAddedEmail").mockRejectedValueOnce(
      new Error("relay down"),
    );
    as(w.owner.user);
    const response = await add(w.workspaceId, {
      userId: w.newcomer.id,
      role: "member",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      emailAttempted: true,
      emailSent: false,
    });
    expect(await membershipRows(w.workspaceId, w.newcomer.id)).toHaveLength(1);
  });

  it("reports that no email was attempted when SMTP is not configured", async () => {
    const w = await buildWorld();
    vi.spyOn(email, "sendMemberAddedEmail").mockResolvedValueOnce({
      success: false,
      reason: "SMTP_NOT_CONFIGURED",
    });
    as(w.owner.user);
    const response = await add(w.workspaceId, {
      userId: w.newcomer.id,
      role: "member",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      emailAttempted: false,
      emailSent: false,
    });
    // The in-app notification does not depend on SMTP.
    expect(
      await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.userId, w.newcomer.id)),
    ).toHaveLength(1);
  });

  it("gives no project access by itself", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    expect(
      (await add(w.workspaceId, { userId: w.newcomer.id, role: "member" }))
        .status,
    ).toBe(200);
    expect(await resolveProjectAccess(w.newcomer.id, w.project.id)).toBeNull();
  });
});

describe("who may add, and which role", () => {
  it("needs member:create in the workspace role", async () => {
    const w = await buildWorld();
    as(w.plainMember);
    const response = await add(w.workspaceId, {
      userId: w.newcomer.id,
      role: "viewer",
    });
    expect(response.status).toBe(403);
    expect(await membershipRows(w.workspaceId, w.newcomer.id)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.userId, w.newcomer.id)),
    ).toHaveLength(0);
  });

  it("does not take a PROJECT role for the workspace permission", async () => {
    const w = await buildWorld();
    await addProjectMember(w.project.id, w.plainMember.id, "admin");
    as(w.plainMember);
    const response = await add(w.workspaceId, {
      userId: w.newcomer.id,
      role: "reader",
    });
    expect(response.status).toBe(403);
    expect(await membershipRows(w.workspaceId, w.newcomer.id)).toHaveLength(0);
  });

  it("refuses somebody who is not in the workspace", async () => {
    const w = await buildWorld();
    const outsider = await createWorkspaceMember({ role: "owner" });
    as(outsider.user);
    expect(
      (await add(w.workspaceId, { userId: w.newcomer.id, role: "viewer" }))
        .status,
    ).toBe(403);
    expect(await membershipRows(w.workspaceId, w.newcomer.id)).toHaveLength(0);
  });

  it("lets a delegated role grant only roles within its own permissions", async () => {
    const w = await buildWorld();
    as(w.adder);

    for (const role of ["editor", "admin", "member", "viewer"]) {
      await expectCode(
        await add(w.workspaceId, { userId: w.newcomer.id, role }),
        403,
        "ROLE_EXCEEDS_YOUR_PERMISSIONS",
      );
      expect(await membershipRows(w.workspaceId, w.newcomer.id)).toHaveLength(
        0,
      );
    }
    expect(
      await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.userId, w.newcomer.id)),
    ).toHaveLength(0);

    const ok = await add(w.workspaceId, {
      userId: w.newcomer.id,
      role: "reader",
    });
    expect(ok.status).toBe(200);
    expect((await membershipRows(w.workspaceId, w.newcomer.id))[0]?.role).toBe(
      "reader",
    );
  });

  it("never grants owner, not even to an owner, and rejects unknown or composite roles", async () => {
    const w = await buildWorld();
    for (const actor of [w.owner.user, w.adder]) {
      as(actor);
      await expectCode(
        await add(w.workspaceId, { userId: w.newcomer.id, role: "owner" }),
        400,
        "OWNER_ROLE_NOT_ALLOWED",
      );
      await expectCode(
        await add(w.workspaceId, {
          userId: w.newcomer.id,
          role: "admin,owner",
        }),
        400,
        "OWNER_ROLE_NOT_ALLOWED",
      );
    }
    as(w.owner.user);
    await expectCode(
      await add(w.workspaceId, { userId: w.newcomer.id, role: "nope" }),
      400,
      "UNKNOWN_ROLE",
    );
    await expectCode(
      await add(w.workspaceId, {
        userId: w.newcomer.id,
        role: "reader,editor",
      }),
      400,
      "UNKNOWN_ROLE",
    );
    expect(await membershipRows(w.workspaceId, w.newcomer.id)).toHaveLength(0);
  });

  it("lets an owner grant any role but owner", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    const response = await add(w.workspaceId, {
      userId: w.newcomer.id,
      role: "admin",
    });
    expect(response.status).toBe(200);
  });

  it("intersects the scope of an API key", async () => {
    const w = await buildWorld();
    const createKey = async (permissions: Record<string, string[]>) =>
      (
        await auth.api.createApiKey({
          body: { userId: w.owner.user.id, name: "scope", permissions },
        })
      ).key;
    const post = (key: string) =>
      app.request(`/api/workspace/${w.workspaceId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify({ userId: w.newcomer.id, role: "reader" }),
      });
    expect((await post(await createKey({ task: ["read"] }))).status).toBe(403);
    expect(
      (await post(await createKey({ invitation: ["create"] }))).status,
    ).toBe(403);
    expect(await membershipRows(w.workspaceId, w.newcomer.id)).toHaveLength(0);
    expect((await post(await createKey({ member: ["create"] }))).status).toBe(
      200,
    );
  });
});

describe("who can be added", () => {
  it("answers 409 for somebody who already is a member", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    await expectCode(
      await add(w.workspaceId, { userId: w.plainMember.id, role: "viewer" }),
      409,
      "ALREADY_WORKSPACE_MEMBER",
    );
    expect(await membershipRows(w.workspaceId, w.plainMember.id)).toHaveLength(
      1,
    );
    expect(
      (await membershipRows(w.workspaceId, w.plainMember.id))[0]?.role,
    ).toBe("member");
  });

  it("answers the same 404 for an unknown, a guest and a banned account", async () => {
    const w = await buildWorld();
    const guest = await createAccount("Guest", { isAnonymous: true });
    const banned = await createAccount("Banned", { banned: true });
    as(w.owner.user);
    const answers = [];
    for (const userId of ["user-nobody", guest.id, banned.id]) {
      const response = await add(w.workspaceId, { userId, role: "viewer" });
      answers.push({ status: response.status, body: await response.json() });
    }
    expect(answers[0]).toEqual({
      status: 404,
      body: {
        code: "USER_CANNOT_BE_ADDED",
        message: "This account cannot be added to a workspace",
      },
    });
    // Nothing tells the three apart.
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  it("refuses guest and banned accounts", async () => {
    const w = await buildWorld();
    const guest = await createAccount("Guest", { isAnonymous: true });
    const banned = await createAccount("Banned", { banned: true });
    const expiredBan = await createAccount("Expired ban", {
      banned: true,
      banExpires: new Date(Date.now() - 60_000),
    });
    as(w.owner.user);
    for (const person of [guest, banned]) {
      await expectCode(
        await add(w.workspaceId, { userId: person.id, role: "viewer" }),
        404,
        "USER_CANNOT_BE_ADDED",
      );
      expect(await membershipRows(w.workspaceId, person.id)).toHaveLength(0);
    }
    expect(
      (await add(w.workspaceId, { userId: expiredBan.id, role: "viewer" }))
        .status,
    ).toBe(200);
  });

  it("drops project memberships and resource links an earlier membership left behind", async () => {
    const w = await buildWorld();
    const { project: other } = await createProjectFixture({
      workspaceId: w.workspaceId,
      name: "Second project",
      members: "none",
    });
    // Leftovers of an earlier membership (a removal whose cleanup failed):
    // project rows in this workspace and a resource linked to the account.
    await addProjectMember(w.project.id, w.newcomer.id, "admin");
    await addProjectMember(other.id, w.newcomer.id, "member");
    const [resource] = await db
      .insert(schema.resourceTable)
      .values({
        workspaceId: w.workspaceId,
        kind: "person",
        name: "Nina",
        userId: w.newcomer.id,
      })
      .returning();
    // The same person's membership in ANOTHER workspace is not touched.
    const elsewhere = await createWorkspaceMember({ role: "owner" });
    const { project: foreign } = await createProjectFixture({
      workspaceId: elsewhere.workspace.id,
      members: "none",
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: elsewhere.workspace.id,
      userId: w.newcomer.id,
      role: "member",
      joinedAt: new Date(),
    });
    await addProjectMember(foreign.id, w.newcomer.id, "member");

    as(w.owner.user);
    expect(
      (await add(w.workspaceId, { userId: w.newcomer.id, role: "member" }))
        .status,
    ).toBe(200);

    const projectRows = await db
      .select({ projectId: schema.projectMemberTable.projectId })
      .from(schema.projectMemberTable)
      .where(eq(schema.projectMemberTable.userId, w.newcomer.id));
    expect(projectRows.map((row) => row.projectId)).toEqual([foreign.id]);
    expect(await resolveProjectAccess(w.newcomer.id, w.project.id)).toBeNull();
    expect(await resolveProjectAccess(w.newcomer.id, other.id)).toBeNull();
    const [after] = await db
      .select({ userId: schema.resourceTable.userId })
      .from(schema.resourceTable)
      .where(eq(schema.resourceTable.id, resource?.id ?? ""));
    expect(after?.userId).toBeNull();
  });

  it("keeps the usual cloud gates: a disposable address is refused", async () => {
    const w = await buildWorld();
    const throwaway = await createAccount("Throwaway", {
      email: "someone@mailinator.com",
    });
    for (const [key, value] of Object.entries(CLOUD_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    as(w.owner.user);
    await expectCode(
      await add(w.workspaceId, { userId: throwaway.id, role: "viewer" }),
      400,
      "DISPOSABLE_EMAIL_NOT_ALLOWED",
    );
    expect(await membershipRows(w.workspaceId, throwaway.id)).toHaveLength(0);
    // An ordinary address passes.
    expect(
      (await add(w.workspaceId, { userId: w.newcomer.id, role: "viewer" }))
        .status,
    ).toBe(200);
  });
});

describe("when the user directory is off", () => {
  const FLAGS = [
    "DISABLE_USER_DIRECTORY",
    "ENABLE_USER_DIRECTORY",
    "KANEO_CLOUD",
  ];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of FLAGS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of FLAGS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const viaProject = (projectId: string, body: unknown) =>
    app.request(`/api/project/${projectId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("refuses to add an account that is not a member, on both routes, even to the owner", async () => {
    const w = await buildWorld();
    process.env.DISABLE_USER_DIRECTORY = "true";
    as(w.owner.user);
    await expectCode(
      await add(w.workspaceId, { userId: w.newcomer.id, role: "viewer" }),
      403,
      "USER_DIRECTORY_DISABLED",
    );
    await expectCode(
      await viaProject(w.project.id, {
        userId: w.newcomer.id,
        role: "viewer",
        workspaceRole: "viewer",
      }),
      403,
      "USER_DIRECTORY_DISABLED",
    );
    expect(await membershipRows(w.workspaceId, w.newcomer.id)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.userId, w.newcomer.id)),
    ).toHaveLength(0);
  });

  it("leaves adding existing workspace members to projects alone", async () => {
    const w = await buildWorld();
    process.env.DISABLE_USER_DIRECTORY = "true";
    as(w.owner.user);
    const response = await viaProject(w.project.id, {
      userId: w.plainMember.id,
      role: "viewer",
    });
    expect(response.status).toBe(200);
  });

  it("is the default on cloud, and ENABLE_USER_DIRECTORY turns adding back on", async () => {
    const w = await buildWorld();
    process.env.KANEO_CLOUD = "true";
    as(w.owner.user);
    await expectCode(
      await add(w.workspaceId, { userId: w.newcomer.id, role: "viewer" }),
      403,
      "USER_DIRECTORY_DISABLED",
    );
    process.env.ENABLE_USER_DIRECTORY = "true";
    expect(
      (await add(w.workspaceId, { userId: w.newcomer.id, role: "viewer" }))
        .status,
    ).toBe(200);
  });
});

describe("guest callers", () => {
  async function guestAdmin(workspaceId: string) {
    const guest = await addWorkspaceMember(workspaceId, "admin");
    await db
      .update(schema.userTable)
      .set({ isAnonymous: true })
      .where(eq(schema.userTable.id, guest.id));
    return { ...guest, isAnonymous: true };
  }

  it("may not add anybody on any instance, although their role would allow it", async () => {
    const w = await buildWorld();
    const guest = await guestAdmin(w.workspaceId);
    as(guest);
    await expectCode(
      await add(w.workspaceId, { userId: w.newcomer.id, role: "viewer" }),
      403,
      "GUEST_NOT_ALLOWED",
    );
    expect(await membershipRows(w.workspaceId, w.newcomer.id)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.userId, w.newcomer.id)),
    ).toHaveLength(0);
  });

  it("is refused before anything is written on cloud too", async () => {
    const w = await buildWorld();
    const guest = await guestAdmin(w.workspaceId);
    for (const [key, value] of Object.entries(CLOUD_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    as(guest);
    await expectCode(
      await add(w.workspaceId, { userId: w.newcomer.id, role: "viewer" }),
      403,
      "GUEST_NOT_ALLOWED",
    );
    expect(await membershipRows(w.workspaceId, w.newcomer.id)).toHaveLength(0);
  });
});

describe("limits on adding people", () => {
  it("allows 30 adds per 10 minutes per user on every instance, then answers 429", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    for (let i = 0; i < 30; i += 1) {
      const person = await createAccount(`Person ${i}`);
      const response = await add(w.workspaceId, {
        userId: person.id,
        role: "viewer",
      });
      expect(response.status, `add ${i + 1}`).toBe(200);
    }
    const response = await add(w.workspaceId, {
      userId: w.newcomer.id,
      role: "viewer",
    });
    await expectCode(response, 429, "RATE_LIMITED");
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await membershipRows(w.workspaceId, w.newcomer.id)).toHaveLength(0);

    // Another user has their own budget.
    as(w.adder);
    expect(
      (await add(w.workspaceId, { userId: w.newcomer.id, role: "reader" }))
        .status,
    ).toBe(200);
  });

  it("shares the budget with the project route's add to the workspace", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    for (let i = 0; i < 29; i += 1) {
      const person = await createAccount(`Person ${i}`);
      expect(
        (await add(w.workspaceId, { userId: person.id, role: "viewer" }))
          .status,
      ).toBe(200);
    }
    const viaProject = (userId: string) =>
      app.request(`/api/project/${w.project.id}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId,
          role: "viewer",
          workspaceRole: "viewer",
        }),
      });
    // The 30th add of the budget goes through the project route ...
    expect((await viaProject(w.newcomer.id)).status).toBe(200);
    // ... so the 31st, through either route, is refused.
    const other = await createAccount("Other");
    await expectCode(await viaProject(other.id), 429, "RATE_LIMITED");
    await expectCode(
      await add(w.workspaceId, { userId: other.id, role: "viewer" }),
      429,
      "RATE_LIMITED",
    );
    expect(await membershipRows(w.workspaceId, other.id)).toHaveLength(0);
  });

  it("applies the cloud invitation limit (5 per minute) to the project route's workspace add too", async () => {
    const w = await buildWorld();
    for (const [key, value] of Object.entries(CLOUD_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    as(w.owner.user);
    const viaProject = (userId: string) =>
      app.request(`/api/project/${w.project.id}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId,
          role: "viewer",
          workspaceRole: "viewer",
        }),
      });
    for (let i = 0; i < 5; i += 1) {
      const person = await createAccount(`Person ${i}`);
      expect((await viaProject(person.id)).status, `add ${i + 1}`).toBe(200);
    }
    const sixth = await createAccount("Sixth");
    await expectCode(await viaProject(sixth.id), 429, "RATE_LIMITED");
    // The workspace route draws on the same invitation budget.
    await expectCode(
      await add(w.workspaceId, { userId: sixth.id, role: "viewer" }),
      429,
      "RATE_LIMITED",
    );
    expect(await membershipRows(w.workspaceId, sixth.id)).toHaveLength(0);
  });
});

describe("the add limits are consumed together", () => {
  it("does not spend the 30 per 10 minutes budget on adds the cloud invitation limit refused", async () => {
    const w = await buildWorld();
    for (const [key, value] of Object.entries(CLOUD_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    const { directAddRateLimiter } = await import(
      "../../apps/api/src/workspace/rate-limit"
    );
    as(w.owner.user);
    // Five adds use the invitation limit of the minute (and 5 of the 30).
    for (let i = 0; i < 5; i += 1) {
      const person = await createAccount(`Person ${i}`);
      expect(
        (await add(w.workspaceId, { userId: person.id, role: "viewer" }))
          .status,
      ).toBe(200);
    }
    // Many refused attempts: each is stopped by the invitation limit.
    for (let i = 0; i < 40; i += 1) {
      const response = await add(w.workspaceId, {
        userId: w.newcomer.id,
        role: "viewer",
      });
      expect(response.status).toBe(429);
    }
    // They did not count against the budget of 30: 5 + 40 would have
    // exhausted it.
    expect(directAddRateLimiter.peek(w.owner.user.id).allowed).toBe(true);
    process.env.KANEO_CLOUD = "false";
    expect(
      (await add(w.workspaceId, { userId: w.newcomer.id, role: "viewer" }))
        .status,
    ).toBe(200);
  });
});

describe("refused requests never spend the add budget", () => {
  it("does not count unknown targets, however many, against the 30 per 10 minutes", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    for (let i = 0; i < 35; i += 1) {
      await expectCode(
        await add(w.workspaceId, {
          userId: `user-nobody-${i}`,
          role: "viewer",
        }),
        404,
        "USER_CANNOT_BE_ADDED",
      );
    }
    // The budget is intact: a valid add still goes through.
    expect(
      (await add(w.workspaceId, { userId: w.newcomer.id, role: "viewer" }))
        .status,
    ).toBe(200);
  });

  it("does not count a role beyond the caller's or a member already in", async () => {
    const w = await buildWorld();
    as(w.adder);
    for (let i = 0; i < 35; i += 1) {
      await expectCode(
        await add(w.workspaceId, { userId: w.newcomer.id, role: "admin" }),
        403,
        "ROLE_EXCEEDS_YOUR_PERMISSIONS",
      );
    }
    for (let i = 0; i < 35; i += 1) {
      await expectCode(
        await add(w.workspaceId, { userId: w.plainMember.id, role: "reader" }),
        409,
        "ALREADY_WORKSPACE_MEMBER",
      );
    }
    expect(
      (await add(w.workspaceId, { userId: w.newcomer.id, role: "reader" }))
        .status,
    ).toBe(200);
  });

  it("does not let refusals by a disabled directory cause a 429 on cloud", async () => {
    const w = await buildWorld();
    // Cloud, the directory left off: no ENABLE_USER_DIRECTORY.
    for (const [key, value] of Object.entries(CLOUD_ENV)) {
      if (key === "ENABLE_USER_DIRECTORY") continue;
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    const enableFlag = "ENABLE_USER_DIRECTORY";
    savedEnv[enableFlag] = process.env[enableFlag];
    delete process.env[enableFlag];
    as(w.owner.user);
    for (let i = 0; i < 6; i += 1) {
      await expectCode(
        await add(w.workspaceId, { userId: w.newcomer.id, role: "viewer" }),
        403,
        "USER_DIRECTORY_DISABLED",
      );
    }
    // The invitation limit (5 per minute) is untouched: invitations go out.
    const invitation = await app.request(
      `/api/project/${w.project.id}/invitations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: `invitee-${randomUUID().slice(0, 8)}@example.com`,
          workspaceRole: "viewer",
          projectRole: "viewer",
        }),
      },
    );
    expect(invitation.status).toBe(201);
  });
});

describe("the workspace member limit", () => {
  async function fillWorkspace(workspaceId: string) {
    const existing = (
      await db
        .select()
        .from(schema.workspaceUserTable)
        .where(eq(schema.workspaceUserTable.workspaceId, workspaceId))
    ).length;
    const users = Array.from({ length: 100 - existing }, () => ({
      id: `user-${randomUUID()}`,
      name: "Filler",
      emailVerified: true,
    }));
    await db
      .insert(schema.userTable)
      .values(users.map((u) => ({ ...u, email: `${u.id}@example.com` })));
    await db.insert(schema.workspaceUserTable).values(
      users.map((u) => ({
        workspaceId,
        userId: u.id,
        role: "viewer",
        joinedAt: new Date(),
      })),
    );
  }

  it("answers a documented coded 403 and adds nobody", async () => {
    const w = await buildWorld();
    await fillWorkspace(w.workspaceId);
    as(w.owner.user);
    await expectCode(
      await add(w.workspaceId, { userId: w.newcomer.id, role: "viewer" }),
      403,
      "WORKSPACE_MEMBER_LIMIT_REACHED",
    );
    expect(await membershipRows(w.workspaceId, w.newcomer.id)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.userId, w.newcomer.id)),
    ).toHaveLength(0);
  });

  it("answers the same through the project route and leaves no project row", async () => {
    const w = await buildWorld();
    await fillWorkspace(w.workspaceId);
    as(w.owner.user);
    const response = await app.request(`/api/project/${w.project.id}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: w.newcomer.id,
        role: "viewer",
        workspaceRole: "viewer",
      }),
    });
    await expectCode(response, 403, "WORKSPACE_MEMBER_LIMIT_REACHED");
    expect(await membershipRows(w.workspaceId, w.newcomer.id)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.projectMemberTable)
        .where(eq(schema.projectMemberTable.userId, w.newcomer.id)),
    ).toHaveLength(0);
  });
});

describe("Better Auth hooks", () => {
  it("syncs the billed seats like any other new member", async () => {
    const w = await buildWorld();
    for (const [key, value] of Object.entries(CLOUD_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    await db.insert(schema.workspaceBillingTable).values({
      workspaceId: w.workspaceId,
      plan: "team",
      status: "active",
      seats: 3,
      creemSubscriptionId: `sub-${w.workspaceId}`,
      creemProductId: "prod_team_monthly",
    });
    as(w.owner.user);
    expect(
      (await add(w.workspaceId, { userId: w.newcomer.id, role: "viewer" }))
        .status,
    ).toBe(200);

    // The hook syncs in the background.
    await vi.waitFor(() =>
      expect(updateSubscriptionSeats).toHaveBeenCalledWith({
        subscriptionId: `sub-${w.workspaceId}`,
        productId: "prod_team_monthly",
        units: 4,
      }),
    );
  });
});
