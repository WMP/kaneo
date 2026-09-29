import { createHash, randomUUID } from "node:crypto";
import type { User } from "better-auth/types";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
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

type Access = {
  mode: "full" | "member";
  role: string | null;
  capabilities: Record<string, boolean>;
};

const ALL_KEYS = [
  "createTasks",
  "updateTasks",
  "deleteTasks",
  "assignTasks",
  "createLabels",
  "attachLabels",
  "manageWorkspaceLabels",
  "updateProject",
  "deleteProject",
  "shareProject",
  "manageMembers",
  "addMembers",
  "inviteToProject",
  "cancelProjectInvitations",
  "manageIntegrations",
];

// What a project role can grant. Label definitions of the workspace and
// integrations follow the WORKSPACE role instead.
const WORKSPACE_ROLE_KEYS = ["manageWorkspaceLabels", "manageIntegrations"];
const PROJECT_ROLE_KEYS = ALL_KEYS.filter(
  (key) => !WORKSPACE_ROLE_KEYS.includes(key),
).sort();

function trueKeys(access: Access) {
  return Object.entries(access.capabilities)
    .filter(([, allowed]) => allowed)
    .map(([key]) => key)
    .sort();
}

async function buildWorld() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const workspaceId = owner.workspace.id;
  const { project } = await createProjectFixture({
    workspaceId,
    members: "none",
  });

  // A custom workspace role that may manage members but nothing else.
  await db.insert(schema.workspaceRoleTable).values({
    workspaceId,
    role: "people-manager",
    permission: JSON.stringify({
      member: ["create", "update", "delete"],
      task: ["read"],
    }),
  });

  // Workspace VIEWER with the project role admin: acts with the project role.
  const viewerButProjectAdmin = await addWorkspaceMember(workspaceId, "viewer");
  await addProjectMember(project.id, viewerButProjectAdmin.id, "admin");
  // Workspace MEMBER (a fairly wide role) who is only a project viewer.
  const memberButProjectViewer = await addWorkspaceMember(
    workspaceId,
    "member",
  );
  await addProjectMember(project.id, memberButProjectViewer.id, "viewer");
  const projectMember = await addWorkspaceMember(workspaceId, "viewer");
  await addProjectMember(project.id, projectMember.id, "member");
  const peopleManager = await addWorkspaceMember(workspaceId, "viewer");
  await addProjectMember(project.id, peopleManager.id, "people-manager");
  // Full access through the workspace role, no project row.
  const fullAdmin = await addWorkspaceMember(workspaceId, "admin");
  // A composite role name resolves as an unknown role and grants nothing.
  const workspaceOnly = await addWorkspaceMember(workspaceId, "admin,x");
  const noProject = await addWorkspaceMember(workspaceId, "member");
  const outsider = await createWorkspaceMember({ role: "owner" });
  // An instance administrator who belongs to another workspace only.
  const other = await createWorkspaceMember({ role: "member" });
  const [platformAdmin] = await db
    .update(schema.userTable)
    .set({ role: "admin" })
    .where(eq(schema.userTable.id, other.user.id))
    .returning();

  return {
    owner,
    workspaceId,
    project,
    viewerButProjectAdmin,
    memberButProjectViewer,
    projectMember,
    peopleManager,
    fullAdmin,
    workspaceOnly,
    noProject,
    outsider,
    platformAdmin,
  };
}
type World = Awaited<ReturnType<typeof buildWorld>>;

function as(user: unknown) {
  mockAuthenticatedSession(user as User);
}

function accessOf(w: World) {
  return app.request(`/api/project/${w.project.id}/access`);
}

async function accessFor(w: World, user: unknown): Promise<Access> {
  as(user);
  const response = await accessOf(w);
  expect(response.status).toBe(200);
  return (await response.json()) as Access;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("GET /project/{projectId}/access", () => {
  it("evaluates a project member with the PROJECT role, not the workspace role", async () => {
    const w = await buildWorld();
    const access = await accessFor(w, w.viewerButProjectAdmin);
    expect(access.mode).toBe("member");
    expect(access.role).toBe("admin");
    expect(Object.keys(access.capabilities).sort()).toEqual(
      [...ALL_KEYS].sort(),
    );
    // Everything the project role grants, but nothing that is decided by the
    // workspace role (viewer): workspace labels and integrations.
    expect(trueKeys(access)).toEqual(PROJECT_ROLE_KEYS);
  });

  it("does not widen a project viewer by a wider workspace role", async () => {
    const w = await buildWorld();
    const access = await accessFor(w, w.memberButProjectViewer);
    expect(access).toMatchObject({ mode: "member", role: "viewer" });
    // The wide workspace role only opens what the workspace role decides
    // (label definitions of the workspace); every project right stays shut.
    expect(trueKeys(access)).toEqual(["manageWorkspaceLabels"]);
  });

  it("gives the built-in project member role task and label rights only", async () => {
    const w = await buildWorld();
    const access = await accessFor(w, w.projectMember);
    expect(access).toMatchObject({ mode: "member", role: "member" });
    expect(access.capabilities).toMatchObject({
      createTasks: true,
      updateTasks: true,
      deleteTasks: false,
      deleteProject: false,
      manageMembers: false,
      inviteToProject: false,
      manageIntegrations: false,
    });
  });

  it("evaluates member management from the project statements", async () => {
    const w = await buildWorld();
    const access = await accessFor(w, w.peopleManager);
    expect(access.role).toBe("people-manager");
    expect(trueKeys(access)).toEqual(["addMembers", "manageMembers"]);
  });

  it("gives a full-access role its workspace role and integrations", async () => {
    const w = await buildWorld();
    const admin = await accessFor(w, w.fullAdmin);
    expect(admin).toMatchObject({ mode: "full", role: "admin" });
    expect(trueKeys(admin)).toEqual([...ALL_KEYS].sort());

    const owner = await accessFor(w, w.owner.user);
    expect(owner).toMatchObject({ mode: "full", role: "owner" });
    expect(trueKeys(owner)).toEqual([...ALL_KEYS].sort());
  });

  it("ignores a stale project row of a full-access user", async () => {
    const w = await buildWorld();
    // The row was written before a promotion; the workspace role wins.
    await addProjectMember(w.project.id, w.fullAdmin.id, "viewer");
    const access = await accessFor(w, w.fullAdmin);
    expect(access).toMatchObject({ mode: "full", role: "admin" });
    expect(access.capabilities.deleteProject).toBe(true);
  });

  it("reports an instance administrator who is not a workspace member without a role", async () => {
    const w = await buildWorld();
    const access = await accessFor(w, w.platformAdmin);
    expect(access.mode).toBe("full");
    expect(trueKeys(access)).toEqual([...ALL_KEYS].sort());
    expect(access.role).toBeNull();
  });

  it("refuses callers without project access", async () => {
    const w = await buildWorld();
    for (const user of [w.noProject, w.workspaceOnly]) {
      as(user);
      const response = await accessOf(w);
      expect(response.status).toBe(403);
      expect(await response.text()).toBe(
        "You don't have access to this project",
      );
    }
    as(w.outsider.user);
    expect((await accessOf(w)).status).toBe(403);
    mockAnonymousSession();
    expect((await accessOf(w)).status).toBe(401);
  });

  it("follows a role change", async () => {
    const w = await buildWorld();
    expect((await accessFor(w, w.projectMember)).capabilities.deleteTasks).toBe(
      false,
    );
    await db
      .update(schema.projectMemberTable)
      .set({ role: "admin" })
      .where(eq(schema.projectMemberTable.userId, w.projectMember.id));
    const access = await accessFor(w, w.projectMember);
    expect(access.role).toBe("admin");
    expect(access.capabilities.deleteTasks).toBe(true);
  });

  it("does not offer invitations to a guest account on Kaneo Cloud", async () => {
    const w = await buildWorld();
    const guest = { ...w.viewerButProjectAdmin, isAnonymous: true };
    // Self-hosted: guests are not gated.
    expect((await accessFor(w, guest)).capabilities.inviteToProject).toBe(true);

    vi.stubEnv("KANEO_CLOUD", "true");
    try {
      const cloudGuest = await accessFor(w, guest);
      expect(cloudGuest.capabilities.inviteToProject).toBe(false);
      // Only the invitation gate is affected.
      expect(cloudGuest.capabilities.cancelProjectInvitations).toBe(true);
      expect(cloudGuest.capabilities.addMembers).toBe(true);
      expect(
        (await accessFor(w, w.viewerButProjectAdmin)).capabilities
          .inviteToProject,
      ).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns 400 for an unknown project", async () => {
    const w = await buildWorld();
    as(w.fullAdmin);
    const response = await app.request(`/api/project/${randomUUID()}/access`);
    expect(response.status).toBe(400);
  });
});

describe("GET /project/{projectId}/access with API keys", () => {
  async function bearerFor(userId: string, permissions: object | null) {
    mockAnonymousSession();
    const key = `test_${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      referenceId: userId,
      userId,
      key: createHash("sha256").update(key).digest("base64url"),
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      permissions: permissions ? JSON.stringify(permissions) : null,
    });
    return key;
  }

  async function withKey(w: World, key: string): Promise<Access> {
    const response = await app.request(`/api/project/${w.project.id}/access`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(response.status).toBe(200);
    return (await response.json()) as Access;
  }

  it("intersects the key scope with the project role", async () => {
    const w = await buildWorld();
    const narrow = await bearerFor(w.viewerButProjectAdmin.id, {
      project: ["read"],
      task: ["read", "create"],
      invitation: ["create"],
    });
    const access = await withKey(w, narrow);
    expect(access).toMatchObject({ mode: "member", role: "admin" });
    expect(trueKeys(access)).toEqual(["createTasks", "inviteToProject"]);
  });

  it("keeps a full-access owner within the key scope", async () => {
    const w = await buildWorld();
    const readOnly = await bearerFor(w.owner.user.id, {
      project: ["read"],
      task: ["read"],
    });
    const access = await withKey(w, readOnly);
    expect(access.mode).toBe("full");
    expect(trueKeys(access)).toEqual([]);
  });

  it("does not add rights a key scope has but the project role lacks", async () => {
    const w = await buildWorld();
    const wide = await bearerFor(w.memberButProjectViewer.id, {
      project: ["read", "update", "delete"],
      task: ["read", "create", "update", "delete", "assign"],
      member: ["create", "update", "delete"],
      workspace: ["manage_settings"],
    });
    expect(trueKeys(await withKey(w, wide))).toEqual([]);
  });

  it("treats a key without a scope like the session", async () => {
    const w = await buildWorld();
    const unscoped = await bearerFor(w.viewerButProjectAdmin.id, null);
    const access = await withKey(w, unscoped);
    expect(trueKeys(access)).toEqual(PROJECT_ROLE_KEYS);
  });
});
