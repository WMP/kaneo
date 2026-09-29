import { randomUUID } from "node:crypto";
import * as email from "@kaneo/email";
import type { User } from "better-auth/types";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { upsertInvitationProject } from "../../apps/api/src/project-invitation/invitation-projects";
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

// Project invitations (stage 2c): the routes under
// `/api/project/{id}/invitations` and `/member-candidates`, decided by the
// caller's PROJECT role. Acceptance through Better Auth is in
// project-invitation-accept.test.ts.

const { app } = createApp();

async function buildWorld() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const workspaceId = owner.workspace.id;
  const { project } = await createProjectFixture({
    workspaceId,
    members: "none",
  });
  const { project: other } = await createProjectFixture({
    workspaceId,
    name: "Other project",
    members: "none",
  });

  await db.insert(schema.workspaceRoleTable).values([
    {
      workspaceId,
      role: "inviter",
      permission: JSON.stringify({
        invitation: ["create"],
        task: ["read"],
      }),
    },
    {
      workspaceId,
      role: "canceler",
      permission: JSON.stringify({
        invitation: ["cancel"],
        task: ["read"],
      }),
    },
    {
      workspaceId,
      role: "reader",
      permission: JSON.stringify({ task: ["read"] }),
    },
  ]);

  // Workspace role `member`, project role `admin` in the first project only.
  const projectAdmin = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(project.id, projectAdmin.id, "admin");
  // Workspace role `viewer`; the custom project role holds invitation:create
  // and task:read only.
  const inviter = await addWorkspaceMember(workspaceId, "viewer");
  await addProjectMember(project.id, inviter.id, "inviter");
  const canceler = await addWorkspaceMember(workspaceId, "viewer");
  await addProjectMember(project.id, canceler.id, "canceler");
  const projectViewer = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(project.id, projectViewer.id, "viewer");
  const fullAdmin = await addWorkspaceMember(workspaceId, "admin");
  const workspaceOnly = await addWorkspaceMember(workspaceId, "member");
  const candidate = await addWorkspaceMember(workspaceId, "member");
  const outsider = await createWorkspaceMember({ role: "owner" });

  return {
    owner,
    workspaceId,
    project,
    other,
    projectAdmin,
    inviter,
    canceler,
    projectViewer,
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

const invitationsPath = (projectId: string) =>
  `/project/${projectId}/invitations`;

function invite(
  w: World,
  body: Partial<{
    email: string;
    workspaceRole: string;
    projectRole: string;
  }>,
  projectId = w.project.id,
) {
  return call(invitationsPath(projectId), "POST", {
    email: `invitee-${randomUUID().slice(0, 8)}@example.com`,
    workspaceRole: "viewer",
    projectRole: "viewer",
    ...body,
  });
}

type ErrorBody = { code: string; message: string };

async function expectCode(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(((await response.json()) as ErrorBody).code).toBe(code);
}

async function invitationRows(workspaceId: string) {
  return db
    .select()
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.workspaceId, workspaceId));
}

async function projectRows(invitationId: string) {
  return db
    .select()
    .from(schema.invitationProjectTable)
    .where(eq(schema.invitationProjectTable.invitationId, invitationId));
}

async function seedInvitation(
  w: World,
  overrides: Partial<{
    email: string;
    role: string;
    status: string;
    expiresAt: Date;
    projects: [string, string][];
    inviterId: string;
  }> = {},
) {
  const [row] = await db
    .insert(schema.invitationTable)
    .values({
      workspaceId: w.workspaceId,
      email: overrides.email ?? `seed-${randomUUID().slice(0, 8)}@example.com`,
      role: overrides.role ?? "viewer",
      status: overrides.status ?? "pending",
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 3_600_000),
      inviterId: overrides.inviterId ?? w.owner.user.id,
    })
    .returning();
  for (const [projectId, role] of overrides.projects ?? [
    [w.project.id, "viewer"],
  ]) {
    await db
      .insert(schema.invitationProjectTable)
      .values({ invitationId: row.id, projectId, role });
  }
  return row;
}

async function statusOf(invitationId: string) {
  const [row] = await db
    .select({ status: schema.invitationTable.status })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId));
  return row?.status;
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /project/{id}/invitations", () => {
  it("lets a restricted project admin invite to their project", async () => {
    const w = await buildWorld();
    as(w.projectAdmin);
    const before = Date.now();
    const response = await invite(w, {
      email: "New.Person@Example.com",
      workspaceRole: "member",
      projectRole: "admin",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      email: "new.person@example.com",
      workspaceRole: "member",
      projectRole: "admin",
      projectId: w.project.id,
    });
    expect(typeof body.emailAttempted).toBe("boolean");

    const [row] = await invitationRows(w.workspaceId);
    expect(row).toMatchObject({
      id: body.id,
      email: "new.person@example.com",
      role: "member",
      status: "pending",
      inviterId: w.projectAdmin.id,
    });
    // Better Auth's default lifetime: 48 hours.
    const lifetime = row.expiresAt.getTime() - before;
    expect(lifetime).toBeGreaterThan(48 * 3_600_000 - 60_000);
    expect(lifetime).toBeLessThan(48 * 3_600_000 + 60_000);
    expect(await projectRows(row.id)).toMatchObject([
      { projectId: w.project.id, role: "admin" },
    ]);
  });

  it("refuses a project role above the caller's own permissions", async () => {
    const w = await buildWorld();
    as(w.inviter);
    // inviter holds invitation:create and task:read: member adds task:create.
    for (const projectRole of ["member", "admin", "viewer"]) {
      await expectCode(
        await invite(w, { projectRole }),
        403,
        "ROLE_EXCEEDS_YOUR_PERMISSIONS",
      );
    }
    expect(await invitationRows(w.workspaceId)).toHaveLength(0);

    expect((await invite(w, { projectRole: "reader" })).status).toBe(201);
    expect((await invite(w, { projectRole: "inviter" })).status).toBe(201);
  });

  it("refuses a workspace role above the caller's own workspace role", async () => {
    const w = await buildWorld();
    // The project role is fine; the workspace role is the escalation.
    as(w.inviter);
    await expectCode(
      await invite(w, { workspaceRole: "member", projectRole: "reader" }),
      403,
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    as(w.projectAdmin);
    await expectCode(
      await invite(w, { workspaceRole: "admin", projectRole: "viewer" }),
      403,
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    expect(await invitationRows(w.workspaceId)).toHaveLength(0);

    as(w.inviter);
    expect(
      (await invite(w, { workspaceRole: "viewer", projectRole: "reader" }))
        .status,
    ).toBe(201);
  });

  it("never grants owner, not even to an owner, and rejects unknown roles", async () => {
    const w = await buildWorld();
    for (const user of [w.owner.user, w.fullAdmin]) {
      as(user);
      await expectCode(
        await invite(w, { workspaceRole: "owner" }),
        400,
        "OWNER_ROLE_NOT_ALLOWED",
      );
      await expectCode(
        await invite(w, { workspaceRole: "viewer,owner" }),
        400,
        "OWNER_ROLE_NOT_ALLOWED",
      );
      await expectCode(
        await invite(w, { projectRole: "owner" }),
        400,
        "OWNER_ROLE_NOT_ALLOWED",
      );
      await expectCode(
        await invite(w, { workspaceRole: "no-such-role" }),
        400,
        "UNKNOWN_ROLE",
      );
      await expectCode(
        await invite(w, { workspaceRole: "viewer,member" }),
        400,
        "UNKNOWN_ROLE",
      );
      await expectCode(
        await invite(w, { projectRole: "no-such-role" }),
        400,
        "UNKNOWN_ROLE",
      );
    }
    expect(await invitationRows(w.workspaceId)).toHaveLength(0);
  });

  it("rejects a malformed body", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    expect((await invite(w, { email: "not-an-email" })).status).toBe(400);
    const response = await call(invitationsPath(w.project.id), "POST", {
      email: "a@example.com",
    });
    expect(response.status).toBe(400);
    expect(await invitationRows(w.workspaceId)).toHaveLength(0);
  });

  it("needs invitation:create in the caller's project role and access to the project", async () => {
    const w = await buildWorld();
    // Holds invitation:create in the project only, not in the other one.
    as(w.projectAdmin);
    const denied = await invite(w, {}, w.other.id);
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe("You don't have access to this project");

    // No invitation:create in the project role (viewer), only cancel, or no
    // project role at all.
    for (const user of [w.projectViewer, w.canceler]) {
      as(user);
      await expectCode(await invite(w, {}), 403, "INSUFFICIENT_PERMISSIONS");
    }
    as(w.workspaceOnly);
    expect((await invite(w, {})).status).toBe(403);

    as(w.outsider.user);
    expect((await invite(w, {})).status).toBe(403);
    expect(await invitationRows(w.workspaceId)).toHaveLength(0);
  });

  it("allows full-access administrators and owners", async () => {
    const w = await buildWorld();
    as(w.fullAdmin);
    expect(
      (await invite(w, { workspaceRole: "admin", projectRole: "admin" }))
        .status,
    ).toBe(201);
    as(w.owner.user);
    expect(
      (
        await invite(
          w,
          { workspaceRole: "admin", projectRole: "admin" },
          w.other.id,
        )
      ).status,
    ).toBe(201);
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
      app.request(`/api${invitationsPath(w.project.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify({
          email: `key-${randomUUID().slice(0, 8)}@example.com`,
          workspaceRole: "viewer",
          projectRole: "viewer",
        }),
      });

    await expectCode(
      await post(await createKey({ task: ["read"] })),
      403,
      "INSUFFICIENT_API_KEY_SCOPE",
    );
    await expectCode(
      await post(await createKey({ invitation: ["cancel"] })),
      403,
      "INSUFFICIENT_API_KEY_SCOPE",
    );
    expect(await invitationRows(w.workspaceId)).toHaveLength(0);
    expect(
      (await post(await createKey({ invitation: ["create"] }))).status,
    ).toBe(201);
  });

  it("answers 409 for somebody who already is a workspace member", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    const before = await invitationRows(w.workspaceId);
    await expectCode(
      await invite(w, { email: w.candidate.email }),
      409,
      "ALREADY_WORKSPACE_MEMBER",
    );
    await expectCode(
      await invite(w, { email: w.candidate.email.toUpperCase() }),
      409,
      "ALREADY_WORKSPACE_MEMBER",
    );
    expect(await invitationRows(w.workspaceId)).toHaveLength(before.length);
  });

  it("adds the project to a live pending invitation with the same workspace role", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    const first = (await (
      await invite(w, { email: "again@example.com", projectRole: "viewer" })
    ).json()) as { id: string };
    const sendSpy = vi.spyOn(email, "sendWorkspaceInvitationEmail");

    const response = await invite(
      w,
      { email: "Again@Example.com", projectRole: "member" },
      w.other.id,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: first.id,
      projectId: w.other.id,
      projectRole: "member",
      emailAttempted: false,
      emailSent: false,
    });
    // No second invitation and no second email.
    expect(await invitationRows(w.workspaceId)).toHaveLength(1);
    expect(sendSpy).not.toHaveBeenCalled();
    const rows = await projectRows(first.id);
    expect(rows.map((row) => [row.projectId, row.role]).sort()).toEqual(
      [
        [w.project.id, "viewer"],
        [w.other.id, "member"],
      ].sort(),
    );

    // Repeating the request re-roles this project's row instead of adding one.
    expect(
      (await invite(w, { email: "again@example.com", projectRole: "admin" }))
        .status,
    ).toBe(200);
    expect(await projectRows(first.id)).toHaveLength(2);
    expect(
      (await projectRows(first.id)).find(
        (row) => row.projectId === w.project.id,
      )?.role,
    ).toBe("admin");
  });

  it("checks the project role when adding to a pending invitation", async () => {
    const w = await buildWorld();
    const within = await seedInvitation(w, {
      email: "within@example.com",
      role: "viewer",
      projects: [[w.project.id, "reader"]],
    });
    const above = await seedInvitation(w, {
      email: "above@example.com",
      role: "viewer",
      projects: [[w.project.id, "member"]],
    });
    as(w.inviter);
    // The stored role is manageable, the requested one is above the caller's
    // permissions.
    await expectCode(
      await invite(w, {
        email: "within@example.com",
        workspaceRole: "viewer",
        projectRole: "admin",
      }),
      403,
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    expect(await projectRows(within.id)).toMatchObject([{ role: "reader" }]);
    // The requested role is fine, but the caller cannot re-role a grant they
    // could not have made themselves.
    await expectCode(
      await invite(w, {
        email: "above@example.com",
        workspaceRole: "viewer",
        projectRole: "reader",
      }),
      403,
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    expect(await projectRows(above.id)).toMatchObject([{ role: "member" }]);
  });

  it("answers 409 when a live pending invitation has another workspace role", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    expect(
      (await invite(w, { email: "role@example.com", workspaceRole: "member" }))
        .status,
    ).toBe(201);
    await expectCode(
      await invite(w, { email: "role@example.com", workspaceRole: "viewer" }),
      409,
      "INVITATION_ROLE_CONFLICT",
    );
    expect(await invitationRows(w.workspaceId)).toHaveLength(1);
  });

  it("creates a new invitation when the earlier one has expired", async () => {
    const w = await buildWorld();
    const expired = await seedInvitation(w, {
      email: "late@example.com",
      role: "member",
      expiresAt: new Date(Date.now() - 1000),
    });
    as(w.owner.user);
    const response = await invite(w, {
      email: "late@example.com",
      workspaceRole: "viewer",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    expect(body.id).not.toBe(expired.id);
    expect(await invitationRows(w.workspaceId)).toHaveLength(2);
    expect(await statusOf(expired.id)).toBe("pending");
  });

  it("applies the pending invitation limit of Better Auth", async () => {
    const w = await buildWorld();
    await db.insert(schema.invitationTable).values(
      Array.from({ length: 100 }, (_, index) => ({
        workspaceId: w.workspaceId,
        email: `bulk-${index}@example.com`,
        role: "viewer",
        status: "pending",
        expiresAt: new Date(Date.now() + 3_600_000),
        inviterId: w.owner.user.id,
      })),
    );
    // Expired and canceled ones do not count.
    await seedInvitation(w, {
      status: "canceled",
      projects: [],
    });
    as(w.owner.user);
    await expectCode(
      await invite(w, { email: "over@example.com" }),
      403,
      "INVITATION_LIMIT_REACHED",
    );
    expect(await invitationRows(w.workspaceId)).toHaveLength(101);
  });

  describe("on cloud", () => {
    it("refuses disposable email addresses and guest accounts", async () => {
      const w = await buildWorld();
      vi.stubEnv("KANEO_CLOUD", "true");
      as(w.owner.user);
      await expectCode(
        await invite(w, { email: "someone@mailinator.com" }),
        400,
        "DISPOSABLE_EMAIL_NOT_ALLOWED",
      );

      await db
        .update(schema.userTable)
        .set({ isAnonymous: true })
        .where(eq(schema.userTable.id, w.owner.user.id));
      await expectCode(
        await invite(w, { email: "real@example.com" }),
        403,
        "GUEST_CANNOT_INVITE",
      );
      expect(await invitationRows(w.workspaceId)).toHaveLength(0);
    });

    it("does not apply the gates on a self-hosted instance", async () => {
      const w = await buildWorld();
      as(w.owner.user);
      expect(
        (await invite(w, { email: "someone@mailinator.com" })).status,
      ).toBe(201);
    });
  });

  describe("email", () => {
    it("sends the shared invitation email with the accept link", async () => {
      const w = await buildWorld();
      const sendSpy = vi.spyOn(email, "sendWorkspaceInvitationEmail");
      as(w.projectAdmin);
      const response = await invite(w, { email: "mail@example.com" });
      expect(response.status).toBe(201);
      const body = (await response.json()) as { id: string } & Record<
        string,
        unknown
      >;
      expect(body).toMatchObject({ emailAttempted: true, emailSent: true });
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const [to, , data] = sendSpy.mock.calls[0] as [
        string,
        string,
        { invitationLink: string; inviterName: string; workspaceName: string },
      ];
      expect(to).toBe("mail@example.com");
      expect(data.invitationLink).toBe(
        `http://localhost:5173/invitation/accept/${body.id}`,
      );
      expect(data.inviterName).toBe(w.projectAdmin.name);
      expect(data.workspaceName).toBe(w.owner.workspace.name);
    });

    it("reports that nothing was attempted when SMTP is not configured", async () => {
      const w = await buildWorld();
      vi.spyOn(email, "sendWorkspaceInvitationEmail").mockResolvedValue({
        success: false,
        reason: "SMTP_NOT_CONFIGURED",
      });
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      as(w.owner.user);
      const response = await invite(w, {});
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        emailAttempted: false,
        emailSent: false,
      });
      expect(await invitationRows(w.workspaceId)).toHaveLength(1);
    });

    it("keeps the invitation when the relay fails", async () => {
      const w = await buildWorld();
      vi.spyOn(email, "sendWorkspaceInvitationEmail").mockRejectedValue(
        new Error("relay down"),
      );
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      as(w.owner.user);
      const response = await invite(w, {});
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        emailAttempted: true,
        emailSent: false,
      });
      expect(await invitationRows(w.workspaceId)).toHaveLength(1);
    });
  });

  it("only lets an invitation row name a project of the invitation's workspace", async () => {
    const w = await buildWorld();
    const invitation = await seedInvitation(w, { projects: [] });
    const foreign = await createProjectFixture({
      workspaceId: w.outsider.workspace.id,
      members: "none",
    });
    await expect(
      upsertInvitationProject(db, {
        invitationId: invitation.id,
        workspaceId: w.workspaceId,
        projectId: foreign.project.id,
        role: "viewer",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await projectRows(invitation.id)).toHaveLength(0);

    await upsertInvitationProject(db, {
      invitationId: invitation.id,
      workspaceId: w.workspaceId,
      projectId: w.project.id,
      role: "viewer",
    });
    expect(await projectRows(invitation.id)).toHaveLength(1);
  });
});

describe("GET /project/{id}/invitations", () => {
  it("lists pending invitations that include the project", async () => {
    const w = await buildWorld();
    const live = await seedInvitation(w, {
      email: "live@example.com",
      role: "member",
      projects: [
        [w.project.id, "admin"],
        [w.other.id, "viewer"],
      ],
      inviterId: w.projectAdmin.id,
    });
    const expired = await seedInvitation(w, {
      email: "expired@example.com",
      expiresAt: new Date(Date.now() - 1000),
    });
    await seedInvitation(w, {
      email: "accepted@example.com",
      status: "accepted",
    });
    await seedInvitation(w, {
      email: "canceled@example.com",
      status: "canceled",
    });
    await seedInvitation(w, {
      email: "elsewhere@example.com",
      projects: [[w.other.id, "viewer"]],
    });
    await seedInvitation(w, {
      email: "workspace-only@example.com",
      projects: [],
    });

    as(w.projectAdmin);
    const response = await call(invitationsPath(w.project.id), "GET");
    expect(response.status).toBe(200);
    const list = (await response.json()) as Record<string, unknown>[];
    expect(list.map((entry) => entry.email).sort()).toEqual([
      "expired@example.com",
      "live@example.com",
    ]);
    const byEmail = new Map(list.map((entry) => [entry.email, entry]));
    expect(byEmail.get("live@example.com")).toMatchObject({
      id: live.id,
      workspaceRole: "member",
      projectRole: "admin",
      inviterName: w.projectAdmin.name,
      status: "live",
    });
    expect(byEmail.get("live@example.com")).toHaveProperty("expiresAt");
    expect(byEmail.get("expired@example.com")).toMatchObject({
      id: expired.id,
      status: "expired",
    });
  });

  it("needs invitation:create or invitation:cancel", async () => {
    const w = await buildWorld();
    for (const user of [w.inviter, w.canceler, w.fullAdmin, w.owner.user]) {
      as(user);
      expect((await call(invitationsPath(w.project.id), "GET")).status).toBe(
        200,
      );
    }
    for (const user of [w.projectViewer, w.workspaceOnly, w.outsider.user]) {
      as(user);
      expect((await call(invitationsPath(w.project.id), "GET")).status).toBe(
        403,
      );
    }
  });
});

describe("DELETE /project/{id}/invitations/{invitationId}", () => {
  const cancel = (w: World, invitationId: string, projectId = w.project.id) =>
    call(`${invitationsPath(projectId)}/${invitationId}`, "DELETE");

  it("removes the project and cancels the invitation when none is left", async () => {
    const w = await buildWorld();
    const invitation = await seedInvitation(w, {
      email: "partial@example.com",
      projects: [
        [w.project.id, "viewer"],
        [w.other.id, "viewer"],
      ],
    });
    as(w.owner.user);

    const partial = await cancel(w, invitation.id);
    expect(partial.status).toBe(200);
    expect(await partial.json()).toMatchObject({
      id: invitation.id,
      canceled: false,
    });
    expect(await projectRows(invitation.id)).toMatchObject([
      { projectId: w.other.id },
    ]);
    expect(await statusOf(invitation.id)).toBe("pending");
    // It is gone from this project's list but not from the other's.
    expect(
      await (await call(invitationsPath(w.project.id), "GET")).json(),
    ).toEqual([]);
    expect(
      (await (
        await call(invitationsPath(w.other.id), "GET")
      ).json()) as unknown[],
    ).toHaveLength(1);

    // Not found any more for this project.
    await expectCode(
      await cancel(w, invitation.id),
      404,
      "INVITATION_NOT_FOUND",
    );

    const full = await cancel(w, invitation.id, w.other.id);
    expect(full.status).toBe(200);
    expect(await full.json()).toMatchObject({ canceled: true });
    expect(await projectRows(invitation.id)).toHaveLength(0);
    expect(await statusOf(invitation.id)).toBe("canceled");
  });

  it("does not confirm invitations of other projects, states or workspaces", async () => {
    const w = await buildWorld();
    const elsewhere = await seedInvitation(w, {
      projects: [[w.other.id, "viewer"]],
    });
    const accepted = await seedInvitation(w, { status: "accepted" });
    as(w.owner.user);
    for (const id of [elsewhere.id, accepted.id, "does-not-exist"]) {
      await expectCode(await cancel(w, id), 404, "INVITATION_NOT_FOUND");
    }
    expect(await statusOf(elsewhere.id)).toBe("pending");
    expect(await projectRows(elsewhere.id)).toHaveLength(1);
  });

  it("needs invitation:cancel and roles within the caller's permissions", async () => {
    const w = await buildWorld();
    const invitation = await seedInvitation(w, {
      role: "viewer",
      projects: [[w.project.id, "reader"]],
    });
    // invitation:create alone is not enough.
    as(w.inviter);
    await expectCode(
      await cancel(w, invitation.id),
      403,
      "INSUFFICIENT_PERMISSIONS",
    );
    as(w.projectViewer);
    await expectCode(
      await cancel(w, invitation.id),
      403,
      "INSUFFICIENT_PERMISSIONS",
    );
    expect(await projectRows(invitation.id)).toHaveLength(1);

    // canceler holds task:read and invitation:cancel: reader is within.
    as(w.canceler);
    expect((await cancel(w, invitation.id)).status).toBe(200);
  });

  it("refuses to cancel an invitation above the caller's roles", async () => {
    const w = await buildWorld();
    const highProject = await seedInvitation(w, {
      role: "viewer",
      projects: [[w.project.id, "member"]],
    });
    const highWorkspace = await seedInvitation(w, {
      role: "admin",
      projects: [[w.project.id, "reader"]],
    });
    as(w.canceler);
    await expectCode(
      await cancel(w, highProject.id),
      403,
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    await expectCode(
      await cancel(w, highWorkspace.id),
      403,
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    expect(await projectRows(highProject.id)).toHaveLength(1);
    expect(await projectRows(highWorkspace.id)).toHaveLength(1);
    expect(await statusOf(highWorkspace.id)).toBe("pending");

    // Owners are unrestricted.
    as(w.owner.user);
    expect((await cancel(w, highWorkspace.id)).status).toBe(200);
  });
});

describe("POST /project/{id}/invitations/{invitationId}/resend", () => {
  const resend = (w: World, invitationId: string) =>
    call(`${invitationsPath(w.project.id)}/${invitationId}/resend`, "POST");

  it("extends the expiry and sends the email again", async () => {
    const w = await buildWorld();
    const invitation = await seedInvitation(w, {
      email: "resend@example.com",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const sendSpy = vi.spyOn(email, "sendWorkspaceInvitationEmail");
    as(w.owner.user);
    const before = Date.now();
    const response = await resend(w, invitation.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: invitation.id,
      email: "resend@example.com",
      emailAttempted: true,
      emailSent: true,
    });
    const [row] = await invitationRows(w.workspaceId);
    expect(row.expiresAt.getTime() - before).toBeGreaterThan(
      48 * 3_600_000 - 60_000,
    );
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0]).toBe("resend@example.com");
  });

  it("refuses expired, non-pending and foreign invitations", async () => {
    const w = await buildWorld();
    const expired = await seedInvitation(w, {
      expiresAt: new Date(Date.now() - 1000),
    });
    const canceled = await seedInvitation(w, { status: "canceled" });
    const elsewhere = await seedInvitation(w, {
      projects: [[w.other.id, "viewer"]],
    });
    as(w.owner.user);
    const sendSpy = vi.spyOn(email, "sendWorkspaceInvitationEmail");
    await expectCode(await resend(w, expired.id), 409, "INVITATION_EXPIRED");
    await expectCode(await resend(w, canceled.id), 404, "INVITATION_NOT_FOUND");
    await expectCode(
      await resend(w, elsewhere.id),
      404,
      "INVITATION_NOT_FOUND",
    );
    expect(sendSpy).not.toHaveBeenCalled();
    const [row] = await db
      .select({ expiresAt: schema.invitationTable.expiresAt })
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, expired.id));
    expect(row.expiresAt.getTime()).toBeLessThan(Date.now());
  });

  it("needs invitation:create and roles within the caller's permissions", async () => {
    const w = await buildWorld();
    const within = await seedInvitation(w, {
      role: "viewer",
      projects: [[w.project.id, "reader"]],
    });
    const aboveProject = await seedInvitation(w, {
      role: "viewer",
      projects: [[w.project.id, "member"]],
    });
    const aboveWorkspace = await seedInvitation(w, {
      role: "member",
      projects: [[w.project.id, "reader"]],
    });
    as(w.canceler);
    await expectCode(
      await resend(w, within.id),
      403,
      "INSUFFICIENT_PERMISSIONS",
    );
    as(w.inviter);
    expect((await resend(w, within.id)).status).toBe(200);
    await expectCode(
      await resend(w, aboveProject.id),
      403,
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    await expectCode(
      await resend(w, aboveWorkspace.id),
      403,
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
  });
});

describe("GET /project/{id}/member-candidates", () => {
  const candidates = (w: World) =>
    call(`/project/${w.project.id}/member-candidates`, "GET");

  it("lists workspace members who are neither project members nor full-access", async () => {
    const w = await buildWorld();
    as(w.projectAdmin);
    const response = await candidates(w);
    expect(response.status).toBe(200);
    const list = (await response.json()) as {
      id: string;
      name: string;
      email: string;
      image: string | null;
    }[];
    const ids = list.map((entry) => entry.id);
    expect(ids).toContain(w.candidate.id);
    expect(ids).toContain(w.workspaceOnly.id);
    // Project members, the full-access administrator and the owner are not.
    for (const member of [
      w.projectAdmin,
      w.inviter,
      w.canceler,
      w.projectViewer,
      w.fullAdmin,
      w.owner.user,
      w.outsider.user,
    ]) {
      expect(ids).not.toContain(member.id);
    }
    expect(list.find((entry) => entry.id === w.candidate.id)).toEqual({
      id: w.candidate.id,
      name: w.candidate.name,
      email: w.candidate.email,
      image: null,
    });

    // Candidates are for a project the picker adds people to: the same list
    // for the owner, and somebody added to the project drops out.
    await addProjectMember(w.project.id, w.candidate.id, "viewer");
    as(w.owner.user);
    const after = (await (await candidates(w)).json()) as { id: string }[];
    expect(after.map((entry) => entry.id)).not.toContain(w.candidate.id);
    expect(after.map((entry) => entry.id)).toContain(w.workspaceOnly.id);
  });

  it("answers 403 without member:create in the project", async () => {
    const w = await buildWorld();
    for (const user of [
      w.projectViewer,
      w.inviter,
      w.canceler,
      w.workspaceOnly,
      w.outsider.user,
    ]) {
      as(user);
      expect((await candidates(w)).status).toBe(403);
    }
  });
});
