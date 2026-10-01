import type { User } from "better-auth/types";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
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

// The lists behind the unified people tables:
// - `GET /api/workspace/{id}/members?include=projects` adds, for a caller who
//   manages members, the projects each person belongs to (only projects the
//   caller can open) and whether they have full access;
// - `GET /api/project/{id}/members` returns the workspace role of every row and
//   the date the person joined the project.

const { app } = createApp();

type WorkspaceRow = {
  id: string;
  name: string;
  role: string;
  memberId: string;
  joinedAt: string;
  fullAccess?: boolean;
  projects?: { id: string; name: string; role: string }[];
};

type ProjectRow = {
  userId: string;
  role: string;
  workspaceRole: string;
  joinedAt: string | null;
  source: "project" | "full-access";
  active: boolean;
};

function as(user: unknown) {
  mockAuthenticatedSession(user as User);
}

async function workspaceMembers(workspaceId: string, query = "") {
  const response = await app.request(
    `/api/workspace/${workspaceId}/members${query}`,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as WorkspaceRow[];
}

async function projectMembers(projectId: string) {
  const response = await app.request(`/api/project/${projectId}/members`);
  expect(response.status).toBe(200);
  return (await response.json()) as ProjectRow[];
}

async function buildWorld() {
  const owner = await createWorkspaceMember({
    role: "owner",
    userName: "Owner",
  });
  const workspaceId = owner.workspace.id;
  const { project: alpha } = await createProjectFixture({
    workspaceId,
    name: "Alpha",
    members: "none",
  });
  const { project: beta } = await createProjectFixture({
    workspaceId,
    name: "Beta",
    members: "none",
  });
  const { project: gamma } = await createProjectFixture({
    workspaceId,
    name: "Gamma",
    members: "none",
  });
  await db.insert(schema.workspaceRoleTable).values({
    workspaceId,
    role: "people-manager",
    permission: JSON.stringify({
      member: ["create", "update"],
      project: ["read"],
      task: ["read"],
    }),
  });

  const admin = await addWorkspaceMember(workspaceId, "admin");
  // Belongs to Alpha (member) and Beta (viewer).
  const ann = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(alpha.id, ann.id, "member");
  await addProjectMember(beta.id, ann.id, "viewer");
  // Belongs to Beta and Gamma.
  const bob = await addWorkspaceMember(workspaceId, "viewer");
  await addProjectMember(beta.id, bob.id, "member");
  await addProjectMember(gamma.id, bob.id, "admin");
  // Can manage members, but only belongs to Alpha.
  const manager = await addWorkspaceMember(workspaceId, "people-manager");
  await addProjectMember(alpha.id, manager.id, "admin");
  // No projects at all.
  const idle = await addWorkspaceMember(workspaceId, "member");
  // A plain member of Alpha.
  const plain = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(alpha.id, plain.id, "member");
  return {
    owner,
    workspaceId,
    alpha,
    beta,
    gamma,
    admin,
    ann,
    bob,
    manager,
    idle,
    plain,
  };
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("workspace members with include=projects", () => {
  it("lists the projects and the project role of every person for a full-access caller", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    const rows = await workspaceMembers(w.workspaceId, "?include=projects");
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(w.owner.user.id)).toMatchObject({
      role: "owner",
      fullAccess: true,
      projects: [],
    });
    expect(byId.get(w.admin.id)).toMatchObject({
      role: "admin",
      fullAccess: true,
      projects: [],
    });
    expect(byId.get(w.ann.id)).toMatchObject({
      role: "member",
      fullAccess: false,
      projects: [
        { id: w.alpha.id, name: "Alpha", role: "member" },
        { id: w.beta.id, name: "Beta", role: "viewer" },
      ],
    });
    expect(byId.get(w.bob.id)?.projects).toEqual([
      { id: w.beta.id, name: "Beta", role: "member" },
      { id: w.gamma.id, name: "Gamma", role: "admin" },
    ]);
    expect(byId.get(w.idle.id)).toMatchObject({
      fullAccess: false,
      projects: [],
    });
    // Always present: the membership id (for role changes) and the join date.
    for (const row of rows) {
      expect(typeof row.memberId).toBe("string");
      expect(Number.isNaN(Date.parse(row.joinedAt))).toBe(false);
    }
  });

  it("limits the projects to the ones a member manager can open", async () => {
    const w = await buildWorld();
    as(w.manager);
    const rows = await workspaceMembers(w.workspaceId, "?include=projects");
    const byId = new Map(rows.map((row) => [row.id, row]));

    // A role that manages members sees everyone ...
    expect(rows.map((row) => row.id)).toContain(w.idle.id);
    expect(rows.map((row) => row.id)).toContain(w.bob.id);
    // ... but the manager only belongs to Alpha, so neither Beta nor Gamma
    // appear, not even for a person who is only in those.
    expect(byId.get(w.ann.id)?.projects).toEqual([
      { id: w.alpha.id, name: "Alpha", role: "member" },
    ]);
    expect(byId.get(w.bob.id)?.projects).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain("Beta");
    expect(JSON.stringify(rows)).not.toContain("Gamma");
    expect(byId.get(w.manager.id)?.projects).toEqual([
      { id: w.alpha.id, name: "Alpha", role: "admin" },
    ]);
    // Full access is a fact about the person's workspace role, not a project.
    expect(byId.get(w.admin.id)?.fullAccess).toBe(true);
  });

  it("adds nothing for a caller who does not manage members", async () => {
    const w = await buildWorld();
    as(w.plain);
    const rows = await workspaceMembers(w.workspaceId, "?include=projects");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty("projects");
      expect(row).not.toHaveProperty("fullAccess");
    }
    // The visibility rule of the plain list is unchanged: people who share no
    // project with the caller are not listed.
    expect(rows.map((row) => row.id)).not.toContain(w.bob.id);
  });

  it("adds nothing unless asked", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    for (const row of await workspaceMembers(w.workspaceId)) {
      expect(row).not.toHaveProperty("projects");
      expect(row).not.toHaveProperty("fullAccess");
    }
  });

  it("leaves out a project role that grants nothing any more", async () => {
    const w = await buildWorld();
    await db
      .update(schema.projectMemberTable)
      .set({ role: "deleted-role" })
      .where(eq(schema.projectMemberTable.userId, w.ann.id));
    as(w.owner.user);
    const rows = await workspaceMembers(w.workspaceId, "?include=projects");
    expect(rows.find((row) => row.id === w.ann.id)?.projects).toEqual([]);
  });

  it("never names the projects of another workspace", async () => {
    const w = await buildWorld();
    const elsewhere = await createWorkspaceMember({ role: "owner" });
    const { project: foreign } = await createProjectFixture({
      workspaceId: elsewhere.workspace.id,
      name: "Foreign",
      members: "none",
    });
    await addProjectMember(foreign.id, w.ann.id, "member");
    as(w.owner.user);
    const rows = await workspaceMembers(w.workspaceId, "?include=projects");
    expect(JSON.stringify(rows)).not.toContain("Foreign");
  });
});

describe("project members with the workspace role", () => {
  it("returns the workspace role of every row and when project members joined", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    const rows = await projectMembers(w.alpha.id);
    const byId = new Map(rows.map((row) => [row.userId, row]));

    // Full-access rows: the workspace role (also the `role`), no join date.
    expect(byId.get(w.owner.user.id)).toMatchObject({
      source: "full-access",
      role: "owner",
      workspaceRole: "owner",
      joinedAt: null,
    });
    expect(byId.get(w.admin.id)).toMatchObject({
      source: "full-access",
      role: "admin",
      workspaceRole: "admin",
      joinedAt: null,
    });
    // Project rows: the project role AND the workspace role, and a date.
    expect(byId.get(w.ann.id)).toMatchObject({
      source: "project",
      role: "member",
      workspaceRole: "member",
    });
    expect(byId.get(w.manager.id)).toMatchObject({
      source: "project",
      role: "admin",
      workspaceRole: "people-manager",
    });
    for (const row of rows.filter((entry) => entry.source === "project")) {
      expect(Number.isNaN(Date.parse(row.joinedAt ?? ""))).toBe(false);
    }
  });

  it("is readable by a plain project member", async () => {
    const w = await buildWorld();
    as(w.plain);
    const rows = await projectMembers(w.alpha.id);
    expect(rows.find((row) => row.userId === w.ann.id)?.workspaceRole).toBe(
      "member",
    );
  });
});

describe("projects of the pending invitations", () => {
  type InvitationProjects = {
    invitationId: string;
    projects: { id: string; name: string; role: string }[];
  }[];

  async function invite(
    w: Awaited<ReturnType<typeof buildWorld>>,
    projectId: string,
    email: string,
    projectRole: string,
  ) {
    as(w.owner.user);
    const response = await app.request(
      `/api/project/${projectId}/invitations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, workspaceRole: "viewer", projectRole }),
      },
    );
    expect([200, 201]).toContain(response.status);
    return ((await response.json()) as { id: string }).id;
  }

  async function read(workspaceId: string) {
    const response = await app.request(
      `/api/workspace/${workspaceId}/invitation-projects`,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as InvitationProjects;
  }

  it("names the projects and roles of project invitations, and leaves plain workspace invitations out", async () => {
    const w = await buildWorld();
    const alphaInvite = await invite(w, w.alpha.id, "a@example.com", "member");
    // The same person invited to a second project: one invitation, two projects.
    await invite(w, w.beta.id, "a@example.com", "viewer");
    const gammaInvite = await invite(w, w.gamma.id, "g@example.com", "admin");
    await db.insert(schema.invitationTable).values({
      id: "plain-invite",
      workspaceId: w.workspaceId,
      email: "plain@example.com",
      role: "viewer",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
      inviterId: w.owner.user.id,
    });

    as(w.owner.user);
    const rows = await read(w.workspaceId);
    const byId = new Map(rows.map((row) => [row.invitationId, row.projects]));
    expect(byId.get(alphaInvite)).toEqual([
      { id: w.alpha.id, name: "Alpha", role: "member" },
      { id: w.beta.id, name: "Beta", role: "viewer" },
    ]);
    expect(byId.get(gammaInvite)).toEqual([
      { id: w.gamma.id, name: "Gamma", role: "admin" },
    ]);
    expect(byId.has("plain-invite")).toBe(false);
  });

  it("names only projects the caller can open, and only to somebody who manages invitations", async () => {
    const w = await buildWorld();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: w.workspaceId,
      role: "invite-manager",
      permission: JSON.stringify({
        invitation: ["create", "cancel"],
        project: ["read"],
        task: ["read"],
      }),
    });
    const invitationManager = await addWorkspaceMember(
      w.workspaceId,
      "invite-manager",
    );
    await addProjectMember(w.alpha.id, invitationManager.id, "admin");
    const both = await invite(w, w.alpha.id, "a@example.com", "member");
    await invite(w, w.beta.id, "a@example.com", "viewer");
    const betaOnly = await invite(w, w.beta.id, "b@example.com", "member");

    // Only Alpha is visible to the invitation manager: Beta is not named and an
    // invitation that grants nothing visible is left out.
    as(invitationManager);
    const rows = await read(w.workspaceId);
    expect(rows).toEqual([
      {
        invitationId: both,
        projects: [{ id: w.alpha.id, name: "Alpha", role: "member" }],
      },
    ]);
    expect(rows.some((row) => row.invitationId === betaOnly)).toBe(false);
    expect(JSON.stringify(rows)).not.toContain("Beta");

    // Nobody without invitation rights learns anything.
    as(w.plain);
    expect(await read(w.workspaceId)).toEqual([]);
    as(w.manager);
    expect(await read(w.workspaceId)).toEqual([]);
  });
});
