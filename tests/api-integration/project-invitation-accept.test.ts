import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { WSContext } from "hono/ws";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import * as applyModule from "../../apps/api/src/project-invitation/apply-invitation-projects";
import { addConnection, removeConnection } from "../../apps/api/src/ws";
import { defaultRolePayloads } from "../../packages/permissions/src";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture } from "./helpers/fixtures";

// Acceptance of project invitations through Better Auth's real accept flow
// (`/api/auth/organization/accept-invitation`) with real sessions, plus the
// invitation read routes the accept page uses. Creation, delegation and the
// management routes are in project-invitation.test.ts.

const origin = "http://localhost:5173";
const { app } = createApp();

type Actor = { id: string; email: string; cookie: string };

function request(
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
) {
  return app.request(path, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function signUp(email: string): Promise<Actor> {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: origin },
    body: JSON.stringify({
      name: email.split("@")[0],
      email,
      password: "long-password-for-tests",
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  return { id: body.user.id, email, cookie };
}

const newEmail = (label: string) =>
  `${label}-${randomUUID().slice(0, 8)}@example.com`;

let workspaceId: string;
let owner: Actor;
let P: { id: string; name: string };
let Q: { id: string; name: string };
let R: { id: string; name: string };

async function makeWorkspace(name: string) {
  const [workspace] = await db
    .insert(schema.workspaceTable)
    .values({
      id: `ws-${randomUUID()}`,
      name,
      slug: `${name}-${randomUUID().slice(0, 8)}`,
      createdAt: new Date(),
    })
    .returning();
  const now = new Date();
  await db.insert(schema.workspaceRoleTable).values(
    (["viewer", "member", "admin"] as const).map((role) => ({
      workspaceId: workspace.id,
      role,
      permission: JSON.stringify(defaultRolePayloads[role]),
      createdAt: now,
      updatedAt: now,
    })),
  );
  return workspace;
}

async function join(actor: Actor, wsId: string, role: string) {
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: wsId,
    userId: actor.id,
    role,
    joinedAt: new Date(),
  });
}

async function projectMemberRows(userId: string) {
  return db
    .select({
      projectId: schema.projectMemberTable.projectId,
      role: schema.projectMemberTable.role,
    })
    .from(schema.projectMemberTable)
    .where(eq(schema.projectMemberTable.userId, userId));
}

async function roleMap(userId: string) {
  return Object.fromEntries(
    (await projectMemberRows(userId)).map((row) => [row.projectId, row.role]),
  );
}

async function invitationProjectRows(invitationId: string) {
  return db
    .select()
    .from(schema.invitationProjectTable)
    .where(eq(schema.invitationProjectTable.invitationId, invitationId));
}

async function invitationStatus(invitationId: string) {
  const [row] = await db
    .select({ status: schema.invitationTable.status })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId));
  return row?.status;
}

async function isWorkspaceMember(userId: string, wsId = workspaceId) {
  const rows = await db
    .select({ id: schema.workspaceUserTable.id })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, wsId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    );
  return rows.length > 0;
}

async function inviteToProject(
  projectId: string,
  email: string,
  workspaceRole: string,
  projectRole: string,
) {
  const response = await request(
    owner.cookie,
    "POST",
    `/api/project/${projectId}/invitations`,
    { email, workspaceRole, projectRole },
  );
  expect([200, 201]).toContain(response.status);
  return ((await response.json()) as { id: string }).id;
}

function accept(actor: Actor, invitationId: string) {
  return request(
    actor.cookie,
    "POST",
    "/api/auth/organization/accept-invitation",
    {
      invitationId,
    },
  );
}

function getProject(actor: Actor, projectId: string) {
  return request(actor.cookie, "GET", `/api/project/${projectId}`);
}

beforeEach(async () => {
  await resetTestDatabase();
  // The first registered user becomes instance administrator: burn the slot.
  await signUp(newEmail("throwaway"));

  const workspace = await makeWorkspace("Acceptance");
  workspaceId = workspace.id;
  owner = await signUp(newEmail("owner"));
  await join(owner, workspaceId, "owner");
  const make = async (name: string) =>
    (await createProjectFixture({ workspaceId, name, members: "none" }))
      .project;
  P = await make("Project P");
  Q = await make("Project Q");
  R = await make("Project R");
});

describe("accepting a project invitation", () => {
  it("creates the memberships with the invited roles, only in the invited projects", async () => {
    const email = newEmail("invitee");
    const invitationId = await inviteToProject(P.id, email, "member", "member");
    await inviteToProject(Q.id, email, "member", "viewer");
    expect(await invitationProjectRows(invitationId)).toHaveLength(2);

    const invitee = await signUp(email);
    // Before accepting there is nothing to see.
    expect((await getProject(invitee, P.id)).status).toBe(403);

    const response = await accept(invitee, invitationId);
    expect(response.status).toBe(200);

    expect(await invitationStatus(invitationId)).toBe("accepted");
    const [member] = await db
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, invitee.id));
    expect(member?.role).toBe("member");
    expect(await roleMap(invitee.id)).toEqual({
      [P.id]: "member",
      [Q.id]: "viewer",
    });
    // The rows of the used invitation are consumed.
    expect(await invitationProjectRows(invitationId)).toHaveLength(0);

    expect((await getProject(invitee, P.id)).status).toBe(200);
    expect((await getProject(invitee, Q.id)).status).toBe(200);
    expect((await getProject(invitee, R.id)).status).toBe(403);
  });

  it("fails for a different email and leaves the invitation untouched", async () => {
    const invitationId = await inviteToProject(
      P.id,
      newEmail("invitee"),
      "member",
      "member",
    );
    const stranger = await signUp(newEmail("stranger"));

    const response = await accept(stranger, invitationId);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code?: string }).code).toBe(
      "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
    );
    expect(await invitationStatus(invitationId)).toBe("pending");
    expect(await invitationProjectRows(invitationId)).toHaveLength(1);
    expect(await projectMemberRows(stranger.id)).toEqual([]);
    expect(await isWorkspaceMember(stranger.id)).toBe(false);
  });

  it("does not grant a project that moved to another workspace meanwhile", async () => {
    const email = newEmail("invitee");
    const invitationId = await inviteToProject(P.id, email, "member", "member");
    await inviteToProject(Q.id, email, "member", "member");
    const invitee = await signUp(email);

    const elsewhere = await makeWorkspace("Elsewhere");
    await db
      .update(schema.projectTable)
      .set({ workspaceId: elsewhere.id })
      .where(eq(schema.projectTable.id, Q.id));

    expect((await accept(invitee, invitationId)).status).toBe(200);
    expect(await roleMap(invitee.id)).toEqual({ [P.id]: "member" });
    expect(await invitationProjectRows(invitationId)).toHaveLength(0);
    expect(await isWorkspaceMember(invitee.id, elsewhere.id)).toBe(false);
  });

  it("does not revive stale memberships of somebody who joins the workspace again", async () => {
    const email = newEmail("returning");
    const invitationId = await inviteToProject(P.id, email, "member", "viewer");
    const returning = await signUp(email);
    // Left over from an earlier membership whose cleanup failed.
    await db.insert(schema.projectMemberTable).values([
      { projectId: P.id, userId: returning.id, role: "admin" },
      { projectId: R.id, userId: returning.id, role: "admin" },
    ]);
    // Stale rows grant nothing while the person is outside the workspace.
    expect((await getProject(returning, R.id)).status).toBe(403);

    expect((await accept(returning, invitationId)).status).toBe(200);
    // The invited role replaces the stale one and the other project stays
    // out of reach.
    expect(await roleMap(returning.id)).toEqual({ [P.id]: "viewer" });
    expect((await getProject(returning, P.id)).status).toBe(200);
    expect((await getProject(returning, R.id)).status).toBe(403);
  });

  it.each([
    ["a project invitation", true],
    ["a plain workspace invitation", false],
  ])(
    "refuses %s for somebody who already is a workspace member",
    async (_label, withProject) => {
      const email = newEmail("member");
      const existing = await signUp(email);
      await join(existing, workspaceId, "member");
      await db
        .insert(schema.projectMemberTable)
        .values({ projectId: R.id, userId: existing.id, role: "member" });
      // The routes refuse to invite a member, so seed what an invitation sent
      // before they joined would hold.
      const [invitation] = await db
        .insert(schema.invitationTable)
        .values({
          workspaceId,
          email,
          role: "admin",
          status: "pending",
          expiresAt: new Date(Date.now() + 3_600_000),
          inviterId: owner.id,
        })
        .returning();
      if (withProject) {
        await db.insert(schema.invitationProjectTable).values({
          invitationId: invitation.id,
          projectId: P.id,
          role: "viewer",
        });
      }

      const response = await accept(existing, invitation.id);
      expect(response.status).toBe(409);
      expect(((await response.json()) as { code?: string }).code).toBe(
        "ALREADY_WORKSPACE_MEMBER",
      );
      // Nothing changed: still pending, rows intact, one membership row with
      // the role they had, no project row added and the existing one kept.
      expect(await invitationStatus(invitation.id)).toBe("pending");
      expect(await invitationProjectRows(invitation.id)).toHaveLength(
        withProject ? 1 : 0,
      );
      const memberRows = await db
        .select({ role: schema.workspaceUserTable.role })
        .from(schema.workspaceUserTable)
        .where(eq(schema.workspaceUserTable.userId, existing.id));
      expect(memberRows).toEqual([{ role: "member" }]);
      expect(await roleMap(existing.id)).toEqual({ [R.id]: "member" });
    },
  );

  it("stores no project row for somebody who reaches every project anyway", async () => {
    const email = newEmail("admin");
    const invitationId = await inviteToProject(P.id, email, "admin", "viewer");
    const invitee = await signUp(email);

    expect((await accept(invitee, invitationId)).status).toBe(200);
    expect(await projectMemberRows(invitee.id)).toEqual([]);
    expect(await invitationProjectRows(invitationId)).toHaveLength(0);
    // Full access through the workspace role.
    expect((await getProject(invitee, R.id)).status).toBe(200);
  });

  it("skips a project role that no longer exists in the workspace", async () => {
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId,
      role: "temporary",
      permission: JSON.stringify({ task: ["read"] }),
    });
    const email = newEmail("invitee");
    const invitationId = await inviteToProject(
      P.id,
      email,
      "viewer",
      "temporary",
    );
    await inviteToProject(Q.id, email, "viewer", "viewer");
    await db
      .delete(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.role, "temporary"));
    const invitee = await signUp(email);

    expect((await accept(invitee, invitationId)).status).toBe(200);
    expect(await roleMap(invitee.id)).toEqual({ [Q.id]: "viewer" });
    expect(await invitationProjectRows(invitationId)).toHaveLength(0);
  });

  it("reverts the acceptance when the project memberships cannot be created", async () => {
    const email = newEmail("invitee");
    const invitationId = await inviteToProject(P.id, email, "member", "member");
    const invitee = await signUp(email);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(applyModule, "applyInvitationProjects").mockRejectedValueOnce(
      new Error("database went away"),
    );

    const activeWorkspaceOf = async (userId: string) =>
      (
        await db
          .select({ id: schema.sessionTable.activeOrganizationId })
          .from(schema.sessionTable)
          .where(eq(schema.sessionTable.userId, userId))
      ).map((row) => row.id);
    expect(await activeWorkspaceOf(invitee.id)).toEqual([null]);

    const failed = await accept(invitee, invitationId);
    expect(failed.status).toBe(500);
    expect(((await failed.json()) as { code?: string }).code).toBe(
      "PROJECT_INVITATION_NOT_APPLIED",
    );
    // No half state: not a member, invitation pending again, rows intact.
    expect(await isWorkspaceMember(invitee.id)).toBe(false);
    expect(await invitationStatus(invitationId)).toBe("pending");
    expect(await invitationProjectRows(invitationId)).toHaveLength(1);
    expect(await projectMemberRows(invitee.id)).toEqual([]);
    // Better Auth made the workspace the active one; the revert takes that
    // back so the client does not land in a workspace it is not a member of.
    expect(await activeWorkspaceOf(invitee.id)).toEqual([null]);

    // The same link works once the failure is gone.
    expect((await accept(invitee, invitationId)).status).toBe(200);
    expect(await activeWorkspaceOf(invitee.id)).toEqual([workspaceId]);
    expect(await roleMap(invitee.id)).toEqual({ [P.id]: "member" });
    expect(await isWorkspaceMember(invitee.id)).toBe(true);
  });

  it("closes the person's sockets only when the acceptance is reverted", async () => {
    const email = newEmail("invitee");
    const invitationId = await inviteToProject(P.id, email, "member", "member");
    const invitee = await signUp(email);
    const socket = { send: vi.fn(), close: vi.fn() };
    const connection = addConnection(
      P.id,
      socket as unknown as WSContext,
      invitee.id,
      "window",
      workspaceId,
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // Granting memberships revokes nothing: nothing closes.
      vi.spyOn(applyModule, "applyInvitationProjects").mockRejectedValueOnce(
        new Error("database went away"),
      );
      expect((await accept(invitee, invitationId)).status).toBe(500);
      // The revert removed the membership Better Auth had just created.
      expect(socket.close).toHaveBeenCalledTimes(1);

      const second = { send: vi.fn(), close: vi.fn() };
      const other = addConnection(
        P.id,
        second as unknown as WSContext,
        invitee.id,
        "window-2",
        workspaceId,
      );
      try {
        expect((await accept(invitee, invitationId)).status).toBe(200);
        expect(second.close).not.toHaveBeenCalled();
      } finally {
        removeConnection(P.id, other);
      }
    } finally {
      removeConnection(P.id, connection);
    }
  });

  it("keeps workspace invitations of Better Auth working: no project until added", async () => {
    const email = newEmail("plain");
    const before = Date.now();
    const response = await request(
      owner.cookie,
      "POST",
      "/api/auth/organization/invite-member",
      { organizationId: workspaceId, email, role: "member" },
    );
    expect(response.status).toBe(200);
    const plain = (await response.json()) as { id: string; expiresAt: string };
    expect(await invitationProjectRows(plain.id)).toHaveLength(0);

    // The project routes create invitations with the same lifetime.
    const projectInvitationId = await inviteToProject(
      P.id,
      newEmail("other"),
      "member",
      "member",
    );
    const [created] = await db
      .select({ expiresAt: schema.invitationTable.expiresAt })
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, projectInvitationId));
    const betterAuthExpiry = new Date(plain.expiresAt).getTime();
    expect(
      Math.abs(created.expiresAt.getTime() - betterAuthExpiry),
    ).toBeLessThan(30_000);
    expect(betterAuthExpiry - before).toBeGreaterThan(48 * 3_600_000 - 60_000);

    const invitee = await signUp(email);
    expect((await accept(invitee, plain.id)).status).toBe(200);
    expect(await isWorkspaceMember(invitee.id)).toBe(true);
    expect(await projectMemberRows(invitee.id)).toEqual([]);
    expect((await getProject(invitee, P.id)).status).toBe(403);
  });
});

describe("invitation read routes", () => {
  it("lists the projects of a pending invitation for its recipient", async () => {
    const email = newEmail("invitee");
    const invitationId = await inviteToProject(P.id, email, "member", "member");
    await inviteToProject(Q.id, email, "member", "viewer");
    const plain = await request(
      owner.cookie,
      "POST",
      "/api/auth/organization/invite-member",
      { organizationId: workspaceId, email: newEmail("plain"), role: "viewer" },
    );
    expect(plain.status).toBe(200);
    const invitee = await signUp(email);
    // The list answers only for verified emails.
    await db
      .update(schema.userTable)
      .set({ emailVerified: true })
      .where(eq(schema.userTable.id, invitee.id));

    const response = await request(
      invitee.cookie,
      "GET",
      "/api/invitation/pending",
    );
    expect(response.status).toBe(200);
    const list = (await response.json()) as {
      id: string;
      projects?: { id: string; name: string; role: string }[];
    }[];
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(invitationId);
    expect(list[0]?.projects).toEqual([
      { id: P.id, name: "Project P", role: "member" },
      { id: Q.id, name: "Project Q", role: "viewer" },
    ]);

    const details = await request(
      invitee.cookie,
      "GET",
      `/api/invitation/${invitationId}`,
    );
    expect(details.status).toBe(200);
    expect(
      ((await details.json()) as { invitation: { projects: unknown } })
        .invitation.projects,
    ).toEqual(list[0]?.projects);
  });

  it("shows the public accept page only the names of a usable invitation's projects", async () => {
    const email = newEmail("invitee");
    const invitationId = await inviteToProject(P.id, email, "member", "member");
    await inviteToProject(Q.id, email, "member", "viewer");
    const moved = await makeWorkspace("Elsewhere");
    await db
      .update(schema.projectTable)
      .set({ workspaceId: moved.id })
      .where(eq(schema.projectTable.id, Q.id));

    const publicRoute = async () =>
      (await (
        await request(null, "GET", `/api/invitation/public/${invitationId}`)
      ).json()) as {
        valid: boolean;
        invitation?: Record<string, unknown>;
      };

    const open = await publicRoute();
    expect(open.valid).toBe(true);
    // A project that left the workspace is not offered; nothing else about
    // the projects is exposed.
    expect(open.invitation?.projects).toEqual([
      { id: P.id, name: "Project P", role: "member" },
    ]);
    expect(Object.keys(open.invitation ?? {}).sort()).toEqual(
      [
        "email",
        "expired",
        "expiresAt",
        "id",
        "inviterName",
        "projects",
        "status",
        "workspaceName",
      ].sort(),
    );

    // Expired: reported as unusable, without the project list.
    await db
      .update(schema.invitationTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitationTable.id, invitationId));
    const expired = await publicRoute();
    expect(expired.valid).toBe(false);
    expect(expired.invitation?.projects).toBeUndefined();

    // Canceled: the invitation is withheld altogether.
    await db
      .update(schema.invitationTable)
      .set({ status: "canceled" })
      .where(eq(schema.invitationTable.id, invitationId));
    expect((await publicRoute()).invitation).toBeUndefined();
  });

  it("reports no projects for a plain workspace invitation", async () => {
    const response = await request(
      owner.cookie,
      "POST",
      "/api/auth/organization/invite-member",
      { organizationId: workspaceId, email: newEmail("plain"), role: "viewer" },
    );
    const { id } = (await response.json()) as { id: string };
    const details = (await (
      await request(null, "GET", `/api/invitation/public/${id}`)
    ).json()) as { valid: boolean; invitation?: { projects?: unknown[] } };
    expect(details.valid).toBe(true);
    expect(details.invitation?.projects).toEqual([]);
  });
});
