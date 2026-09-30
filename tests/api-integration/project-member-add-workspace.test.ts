import { randomUUID } from "node:crypto";
import * as email from "@kaneo/email";
import type { User } from "better-auth/types";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import * as projectAccess from "../../apps/api/src/utils/project-access";
import * as ws from "../../apps/api/src/ws";
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

// `POST /api/project/{id}/members` for somebody who is NOT a workspace member
// yet: with `workspaceRole` in the body the person joins the workspace and the
// project in one step. Needs `member:create` in the caller's PROJECT role (as
// always) AND in their WORKSPACE role; both granted roles must be within the
// caller's permissions. Existing behaviour for workspace members is covered in
// project-member-api.test.ts.

const { app } = createApp();

function as(user: unknown) {
  mockAuthenticatedSession(user as User);
}

function addToProject(projectId: string, body: unknown) {
  return app.request(`/api/project/${projectId}/members`, {
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

async function createAccount(name: string) {
  const id = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({ id, name, email: `${id}@example.com`, emailVerified: true })
    .returning();
  return user;
}

async function workspaceRows(workspaceId: string, userId: string) {
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

async function projectRows(projectId: string, userId: string) {
  return db
    .select()
    .from(schema.projectMemberTable)
    .where(
      and(
        eq(schema.projectMemberTable.projectId, projectId),
        eq(schema.projectMemberTable.userId, userId),
      ),
    );
}

async function notificationCount(userId: string) {
  return (
    await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, userId))
  ).length;
}

async function buildWorld() {
  const owner = await createWorkspaceMember({
    role: "owner",
    userName: "Olivia Owner",
    workspaceName: "Acme Workspace",
  });
  const workspaceId = owner.workspace.id;
  const { project } = await createProjectFixture({
    workspaceId,
    members: "none",
  });
  await db.insert(schema.workspaceRoleTable).values([
    {
      // Holds member:create and task:read, so it can hand out task:read only.
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

  // Workspace AND project role both grant member:create (within task:read).
  const adder = await addWorkspaceMember(workspaceId, "adder");
  await addProjectMember(project.id, adder.id, "adder");
  // A project admin whose WORKSPACE role cannot add workspace members.
  const projectAdmin = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(project.id, projectAdmin.id, "admin");
  // Can add to the workspace, but holds no member:create in this project.
  const workspaceAdderOnly = await addWorkspaceMember(workspaceId, "adder");
  await addProjectMember(project.id, workspaceAdderOnly.id, "reader");
  const plainMember = await addWorkspaceMember(workspaceId, "member");
  const newcomer = await createAccount("Nina Newcomer");
  return {
    owner,
    workspaceId,
    project,
    adder,
    projectAdmin,
    workspaceAdderOnly,
    plainMember,
    newcomer,
  };
}
type World = Awaited<ReturnType<typeof buildWorld>>;

async function expectNothingWritten(w: World) {
  expect(await workspaceRows(w.workspaceId, w.newcomer.id)).toHaveLength(0);
  expect(await projectRows(w.project.id, w.newcomer.id)).toHaveLength(0);
  expect(await notificationCount(w.newcomer.id)).toBe(0);
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("adding a person who is not a workspace member to a project", () => {
  it("adds the person to the workspace and the project, and notifies them", async () => {
    const w = await buildWorld();
    const sent = vi.spyOn(email, "sendMemberAddedEmail");
    as(w.owner.user);

    const response = await addToProject(w.project.id, {
      userId: w.newcomer.id,
      role: "member",
      workspaceRole: "viewer",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      userId: w.newcomer.id,
      name: "Nina Newcomer",
      role: "member",
      workspaceRole: "viewer",
      source: "project",
      active: true,
      workspaceMemberAdded: true,
      emailAttempted: true,
      emailSent: true,
    });

    expect(
      (await workspaceRows(w.workspaceId, w.newcomer.id)).map((r) => r.role),
    ).toEqual(["viewer"]);
    expect(
      (await projectRows(w.project.id, w.newcomer.id)).map((r) => r.role),
    ).toEqual(["member"]);
    expect(await notificationCount(w.newcomer.id)).toBe(1);
    expect(sent).toHaveBeenCalledTimes(1);
    const [to, , data] = sent.mock.calls[0] as [
      string,
      string,
      { role: string; workspaceName: string },
    ];
    expect(to).toBe(w.newcomer.email);
    // The message is about the WORKSPACE role.
    expect(data).toMatchObject({
      role: "viewer",
      workspaceName: "Acme Workspace",
    });

    // The person can open the project now, with the project role.
    const access = await projectAccess.resolveProjectAccess(
      w.newcomer.id,
      w.project.id,
    );
    expect(access?.role).toBe("member");
  });

  it("lets a caller holding member:create in BOTH roles add within their permissions", async () => {
    const w = await buildWorld();
    as(w.adder);
    const response = await addToProject(w.project.id, {
      userId: w.newcomer.id,
      role: "reader",
      workspaceRole: "reader",
    });
    expect(response.status).toBe(200);
    expect(await workspaceRows(w.workspaceId, w.newcomer.id)).toHaveLength(1);
    expect(await projectRows(w.project.id, w.newcomer.id)).toHaveLength(1);
  });

  it("needs member:create in the WORKSPACE role, not only in the project", async () => {
    const w = await buildWorld();
    as(w.projectAdmin);
    await expectCode(
      await addToProject(w.project.id, {
        userId: w.newcomer.id,
        role: "viewer",
        workspaceRole: "viewer",
      }),
      403,
      "INSUFFICIENT_PERMISSIONS",
    );
    await expectNothingWritten(w);

    // The same caller still adds an existing workspace member to the project.
    const colleague = await addWorkspaceMember(w.workspaceId, "member");
    expect(
      (
        await addToProject(w.project.id, {
          userId: colleague.id,
          role: "viewer",
        })
      ).status,
    ).toBe(200);
  });

  it("needs member:create in the PROJECT role, not only in the workspace", async () => {
    const w = await buildWorld();
    as(w.workspaceAdderOnly);
    await expectCode(
      await addToProject(w.project.id, {
        userId: w.newcomer.id,
        role: "reader",
        workspaceRole: "reader",
      }),
      403,
      "INSUFFICIENT_PERMISSIONS",
    );
    await expectNothingWritten(w);
  });

  it("checks the delegation of BOTH roles and writes nothing when either fails", async () => {
    const w = await buildWorld();
    as(w.adder);
    // Workspace role beyond the caller's workspace role.
    await expectCode(
      await addToProject(w.project.id, {
        userId: w.newcomer.id,
        role: "reader",
        workspaceRole: "editor",
      }),
      403,
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    await expectNothingWritten(w);
    // Project role beyond the caller's project role.
    await expectCode(
      await addToProject(w.project.id, {
        userId: w.newcomer.id,
        role: "editor",
        workspaceRole: "reader",
      }),
      403,
      "ROLE_EXCEEDS_YOUR_PERMISSIONS",
    );
    await expectNothingWritten(w);
    // Owner is neither.
    as(w.owner.user);
    await expectCode(
      await addToProject(w.project.id, {
        userId: w.newcomer.id,
        role: "reader",
        workspaceRole: "owner",
      }),
      400,
      "OWNER_ROLE_NOT_ALLOWED",
    );
    await expectCode(
      await addToProject(w.project.id, {
        userId: w.newcomer.id,
        role: "owner",
        workspaceRole: "reader",
      }),
      400,
      "OWNER_ROLE_NOT_ALLOWED",
    );
    await expectCode(
      await addToProject(w.project.id, {
        userId: w.newcomer.id,
        role: "reader",
        workspaceRole: "nope",
      }),
      400,
      "UNKNOWN_ROLE",
    );
    await expectNothingWritten(w);
  });

  it("undoes the workspace add when the project step fails", async () => {
    const w = await buildWorld();
    const sent = vi.spyOn(email, "sendMemberAddedEmail");
    vi.spyOn(projectAccess, "isFullAccess").mockRejectedValueOnce(
      new Error("boom"),
    );
    as(w.owner.user);
    const response = await addToProject(w.project.id, {
      userId: w.newcomer.id,
      role: "member",
      workspaceRole: "viewer",
    });
    expect(response.status).toBe(500);
    // No half state: not in the workspace, not in the project, nobody told.
    await expectNothingWritten(w);
    expect(sent).not.toHaveBeenCalled();
  });

  it("closes the person's sockets when it undoes the workspace add", async () => {
    const w = await buildWorld();
    const closeSockets = vi.spyOn(ws, "closeUserWorkspaceConnections");
    vi.spyOn(projectAccess, "isFullAccess").mockRejectedValueOnce(
      new Error("boom"),
    );
    as(w.owner.user);
    const response = await addToProject(w.project.id, {
      userId: w.newcomer.id,
      role: "member",
      workspaceRole: "viewer",
    });
    expect(response.status).toBe(500);
    expect(closeSockets).toHaveBeenCalledWith(w.newcomer.id, w.workspaceId);
  });

  it("refuses a guest caller on every instance, but not the plain add of a workspace member", async () => {
    const w = await buildWorld();
    const guest = await addWorkspaceMember(w.workspaceId, "adder");
    await addProjectMember(w.project.id, guest.id, "adder");
    await db
      .update(schema.userTable)
      .set({ isAnonymous: true })
      .where(eq(schema.userTable.id, guest.id));
    as({ ...guest, isAnonymous: true });

    await expectCode(
      await addToProject(w.project.id, {
        userId: w.newcomer.id,
        role: "reader",
        workspaceRole: "reader",
      }),
      403,
      "GUEST_NOT_ALLOWED",
    );
    await expectNothingWritten(w);

    // Adding an existing workspace member to the project is unchanged.
    expect(
      (
        await addToProject(w.project.id, {
          userId: w.plainMember.id,
          role: "reader",
        })
      ).status,
    ).toBe(200);
  });

  it("refuses a workspaceRole for somebody who already is a workspace member", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    await expectCode(
      await addToProject(w.project.id, {
        userId: w.plainMember.id,
        role: "viewer",
        workspaceRole: "admin",
      }),
      409,
      "ALREADY_WORKSPACE_MEMBER",
    );
    expect(
      (await workspaceRows(w.workspaceId, w.plainMember.id)).map((r) => r.role),
    ).toEqual(["member"]);
    expect(await projectRows(w.project.id, w.plainMember.id)).toHaveLength(0);
  });

  it("still answers 404 for a non-member when no workspaceRole is sent", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    await expectCode(
      await addToProject(w.project.id, {
        userId: w.newcomer.id,
        role: "viewer",
      }),
      404,
      "NOT_WORKSPACE_MEMBER",
    );
    await expectNothingWritten(w);
  });

  it("adds somebody with a full-access workspace role to the workspace only", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    const response = await addToProject(w.project.id, {
      userId: w.newcomer.id,
      role: "viewer",
      workspaceRole: "admin",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      source: "full-access",
      role: "admin",
      workspaceRole: "admin",
      joinedAt: null,
      workspaceMemberAdded: true,
    });
    expect(await workspaceRows(w.workspaceId, w.newcomer.id)).toHaveLength(1);
    // A project row would only become a stale grant after a demotion.
    expect(await projectRows(w.project.id, w.newcomer.id)).toHaveLength(0);
  });

  it("refuses guests, unknown accounts and banned accounts like the workspace route", async () => {
    const w = await buildWorld();
    const guest = await createAccount("Guest");
    await db
      .update(schema.userTable)
      .set({ isAnonymous: true })
      .where(eq(schema.userTable.id, guest.id));
    as(w.owner.user);
    await expectCode(
      await addToProject(w.project.id, {
        userId: guest.id,
        role: "viewer",
        workspaceRole: "viewer",
      }),
      404,
      "USER_CANNOT_BE_ADDED",
    );
    await expectCode(
      await addToProject(w.project.id, {
        userId: "user-nobody",
        role: "viewer",
        workspaceRole: "viewer",
      }),
      404,
      "USER_CANNOT_BE_ADDED",
    );
    expect(await workspaceRows(w.workspaceId, guest.id)).toHaveLength(0);
  });

  it("keeps the response of a plain add for a workspace member", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    const response = await addToProject(w.project.id, {
      userId: w.plainMember.id,
      role: "viewer",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      userId: w.plainMember.id,
      role: "viewer",
      workspaceRole: "member",
      source: "project",
      active: true,
      workspaceMemberAdded: false,
      emailAttempted: false,
      emailSent: false,
    });
    expect(await notificationCount(w.plainMember.id)).toBe(0);
  });
});
