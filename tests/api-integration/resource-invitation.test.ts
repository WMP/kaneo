import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { WSContext } from "hono/ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import * as linkModule from "../../apps/api/src/resource/link-resource";
import * as transferModule from "../../apps/api/src/resource/transfer-assignments";
import * as accessModule from "../../apps/api/src/utils/project-access";
import { addConnection, removeConnection } from "../../apps/api/src/ws";
import { defaultRolePayloads } from "../../packages/permissions/src";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture } from "./helpers/fixtures";

// "Invite" and "Link to member" on a person resource (stage 3): the routes under
// `/api/resource/{id}`, acceptance through Better Auth's real accept flow with
// real sessions, the assignment transfer and the workload row of a linked
// resource.

const origin = "http://localhost:5173";
const { app } = createApp();

type Actor = { id: string; email: string; cookie: string };
type ErrorBody = { code?: string; message?: string };

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

// Events published by the transfer, collected the way the activity feed and the
// WebSocket layer receive them.
type AssigneeChanged = {
  taskId: string;
  projectId: string;
  userId: string;
  newAssigneeId?: string;
  addedAssigneeIds?: string[];
  removedAssigneeIds?: string[];
  source?: string;
};
const published: AssigneeChanged[] = [];
void subscribeToEvent<AssigneeChanged>(
  "task.assignee_changed",
  async (data) => {
    published.push(data);
  },
);

type Project = { id: string; name: string; todoId: string };
let workspaceId: string;
let owner: Actor;
let P: Project;
let Q: Project;
let R: Project;
let S: Project;
let alice: typeof schema.resourceTable.$inferSelect;
let aliceEmail: string;
let t1: string;
let t2: string;
let t3: string;
let t4: string;

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
  await db.insert(schema.workspaceRoleTable).values([
    ...(["viewer", "member", "admin"] as const).map((role) => ({
      workspaceId: workspace.id,
      role,
      permission: JSON.stringify(defaultRolePayloads[role]),
      createdAt: now,
      updatedAt: now,
    })),
    {
      // Manages resources but holds nothing else beyond what a viewer holds:
      // not a full-access role, no member:update.
      workspaceId: workspace.id,
      role: "resource_manager",
      permission: JSON.stringify({
        ...defaultRolePayloads.viewer,
        project: ["read", "update"],
      }),
      createdAt: now,
      updatedAt: now,
    },
    {
      // A project role that may invite (and nothing else beyond viewing).
      workspaceId: workspace.id,
      role: "inviter",
      permission: JSON.stringify({
        ...defaultRolePayloads.viewer,
        invitation: ["create"],
      }),
      createdAt: now,
      updatedAt: now,
    },
  ]);
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

async function makeProject(name: string, wsId = workspaceId): Promise<Project> {
  const { project, columns } = await createProjectFixture({
    workspaceId: wsId,
    name,
    members: "none",
  });
  return { id: project.id, name, todoId: columns.todo.id };
}

let taskNumber = 0;
async function makeTask(
  project: Project,
  options: { title?: string; day?: string } = {},
) {
  taskNumber += 1;
  const date = options.day ? new Date(`${options.day}T00:00:00.000Z`) : null;
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      columnId: project.todoId,
      status: "to-do",
      title: options.title ?? `Task ${taskNumber}`,
      priority: "medium",
      number: taskNumber,
      position: taskNumber,
      startDate: date,
      dueDate: date,
    })
    .returning();
  return task.id;
}

async function assign(
  taskId: string,
  target: { userId: string } | { resourceId: string },
  units = 100,
  work: number | null = null,
) {
  await db
    .insert(schema.taskAssignmentTable)
    .values({ taskId, ...target, units, work });
  if ("userId" in target) {
    // The primary mirror is the oldest user row.
    const [task] = await db
      .select({ userId: schema.taskTable.userId })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, taskId));
    if (!task?.userId) {
      await db
        .update(schema.taskTable)
        .set({ userId: target.userId })
        .where(eq(schema.taskTable.id, taskId));
    }
  }
}

async function assignmentsOf(taskId: string) {
  return db
    .select({
      userId: schema.taskAssignmentTable.userId,
      resourceId: schema.taskAssignmentTable.resourceId,
      units: schema.taskAssignmentTable.units,
      work: schema.taskAssignmentTable.work,
    })
    .from(schema.taskAssignmentTable)
    .where(eq(schema.taskAssignmentTable.taskId, taskId));
}

async function primaryOf(taskId: string) {
  const [task] = await db
    .select({ userId: schema.taskTable.userId })
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, taskId));
  return task?.userId ?? null;
}

async function resourceRow(id = alice.id) {
  const [row] = await db
    .select()
    .from(schema.resourceTable)
    .where(eq(schema.resourceTable.id, id));
  return row;
}

async function addMember(
  role: string,
  projects: { project: Project; role: string }[] = [],
  label = "member",
) {
  const actor = await signUp(newEmail(label));
  await join(actor, workspaceId, role);
  for (const entry of projects) {
    await db.insert(schema.projectMemberTable).values({
      projectId: entry.project.id,
      userId: actor.id,
      role: entry.role,
    });
  }
  return actor;
}

function inviteBody(overrides: Record<string, unknown> = {}) {
  return {
    workspaceRole: "member",
    projects: [
      { projectId: P.id, role: "member" },
      { projectId: Q.id, role: "viewer" },
    ],
    ...overrides,
  };
}

function invite(
  actor: Actor,
  body: unknown = inviteBody(),
  resourceId = alice.id,
) {
  return request(
    actor.cookie,
    "POST",
    `/api/resource/${resourceId}/invite`,
    body,
  );
}

function link(actor: Actor, userId: string, resourceId = alice.id) {
  return request(actor.cookie, "POST", `/api/resource/${resourceId}/link`, {
    userId,
  });
}

function accept(actor: Actor, invitationId: string) {
  return request(
    actor.cookie,
    "POST",
    "/api/auth/organization/accept-invitation",
    { invitationId },
  );
}

async function invitationCount() {
  return (await db.select().from(schema.invitationTable)).length;
}

async function createResource(
  kind: "person" | "equipment",
  email: string | null,
) {
  const [row] = await db
    .insert(schema.resourceTable)
    .values({ workspaceId, kind, name: `A ${kind}`, email })
    .returning();
  return row;
}

async function listResources(actor: Actor) {
  const response = await request(
    actor.cookie,
    "GET",
    `/api/resource/workspace/${workspaceId}`,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Array<Record<string, unknown>>;
}

beforeEach(async () => {
  await resetTestDatabase();
  published.length = 0;
  // The first registered user becomes instance administrator: burn the slot.
  await signUp(newEmail("throwaway"));

  const workspace = await makeWorkspace("ResourceInvite");
  workspaceId = workspace.id;
  owner = await signUp(newEmail("owner"));
  await join(owner, workspaceId, "owner");
  P = await makeProject("Project P");
  Q = await makeProject("Project Q");
  R = await makeProject("Project R");
  S = await makeProject("Project S");

  aliceEmail = newEmail("alice");
  alice = await createResource("person", aliceEmail);
  t1 = await makeTask(P, { title: "t1", day: "2030-01-02" });
  t2 = await makeTask(P, { title: "t2", day: "2030-01-02" });
  t3 = await makeTask(Q, { title: "t3", day: "2030-01-02" });
  t4 = await makeTask(R, { title: "t4", day: "2030-01-02" });
  await assign(t1, { resourceId: alice.id }, 80);
  await assign(t2, { resourceId: alice.id }, 100, 5);
  await assign(t3, { resourceId: alice.id }, 60);
  await assign(t4, { resourceId: alice.id }, 100);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("inviting a person resource", () => {
  it("creates one invitation with a row per project and remembers it on the resource", async () => {
    const response = await invite(owner);
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      id: string;
      created: boolean;
      email: string;
      projects: { projectId: string; role: string }[];
    };
    expect(body.created).toBe(true);
    expect(body.email).toBe(aliceEmail);

    const invitations = await db.select().from(schema.invitationTable);
    expect(invitations).toHaveLength(1);
    expect(invitations[0]).toMatchObject({
      id: body.id,
      workspaceId,
      email: aliceEmail,
      role: "member",
      status: "pending",
      inviterId: owner.id,
    });
    const projectRows = await db
      .select({
        projectId: schema.invitationProjectTable.projectId,
        role: schema.invitationProjectTable.role,
      })
      .from(schema.invitationProjectTable)
      .where(eq(schema.invitationProjectTable.invitationId, body.id));
    expect(
      Object.fromEntries(projectRows.map((r) => [r.projectId, r.role])),
    ).toEqual({ [P.id]: "member", [Q.id]: "viewer" });
    const [originRow] = await db
      .select()
      .from(schema.invitationOriginTable)
      .where(eq(schema.invitationOriginTable.invitationId, body.id));
    expect(originRow?.source).toBe("project");
    expect((await resourceRow()).invitationId).toBe(body.id);

    // The list shows the state, never the invitation id.
    const listed = (await listResources(owner)).find((r) => r.id === alice.id);
    expect(listed?.invitation).toMatchObject({ status: "pending" });
    expect(listed).not.toHaveProperty("invitationId");
    expect(JSON.stringify(listed)).not.toContain(body.id);
    expect(listed?.user).toBeNull();
  });

  it("reports an expired invitation and none after it was canceled", async () => {
    const body = (await (await invite(owner)).json()) as { id: string };
    await db
      .update(schema.invitationTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitationTable.id, body.id));
    let listed = (await listResources(owner)).find((r) => r.id === alice.id);
    expect(listed?.invitation).toMatchObject({ status: "expired" });

    await db
      .update(schema.invitationTable)
      .set({ status: "canceled" })
      .where(eq(schema.invitationTable.id, body.id));
    listed = (await listResources(owner)).find((r) => r.id === alice.id);
    expect(listed?.invitation).toBeNull();
  });

  it("adds the projects to the live invitation of the same role when invited again", async () => {
    const first = (await (await invite(owner)).json()) as { id: string };
    const second = await invite(
      owner,
      inviteBody({
        projects: [{ projectId: R.id, role: "viewer" }],
      }),
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as {
      id: string;
      created: boolean;
      emailAttempted: boolean;
    };
    expect(body.id).toBe(first.id);
    expect(body.created).toBe(false);
    expect(body.emailAttempted).toBe(false);
    expect(await invitationCount()).toBe(1);
    const rows = await db
      .select()
      .from(schema.invitationProjectTable)
      .where(eq(schema.invitationProjectTable.invitationId, first.id));
    expect(rows).toHaveLength(3);
  });

  it("detaches the invitation when the email of the resource changes", async () => {
    await invite(owner);
    const response = await request(
      owner.cookie,
      "PATCH",
      `/api/resource/${alice.id}`,
      { email: "Somebody.Else@Example.com" },
    );
    expect(response.status).toBe(200);
    const row = await resourceRow();
    expect(row.email).toBe("somebody.else@example.com");
    expect(row.invitationId).toBeNull();
    const listed = (await listResources(owner)).find((r) => r.id === alice.id);
    expect(listed?.invitation).toBeNull();
  });

  it("lower-cases the email and keeps it to a person", async () => {
    const created = await request(
      owner.cookie,
      "POST",
      `/api/resource/workspace/${workspaceId}`,
      { kind: "person", name: "Bob", email: "Bob@Example.COM" },
    );
    expect(created.status).toBe(200);
    expect(((await created.json()) as { email: string }).email).toBe(
      "bob@example.com",
    );

    const equipment = await request(
      owner.cookie,
      "POST",
      `/api/resource/workspace/${workspaceId}`,
      { kind: "equipment", name: "Drill", email: "drill@example.com" },
    );
    expect(equipment.status).toBe(400);
    expect(((await equipment.json()) as ErrorBody).code).toBe(
      "RESOURCE_EMAIL_NOT_ALLOWED",
    );

    const drill = await createResource("equipment", null);
    const patched = await request(
      owner.cookie,
      "PATCH",
      `/api/resource/${drill.id}`,
      { email: "drill@example.com" },
    );
    expect(patched.status).toBe(400);
  });

  describe("validation", () => {
    it("refuses a resource that is not a person", async () => {
      const drill = await createResource("equipment", null);
      const response = await invite(owner, inviteBody(), drill.id);
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).code).toBe(
        "RESOURCE_NOT_PERSON",
      );
      expect(await invitationCount()).toBe(0);
    });

    it("refuses a person without an email", async () => {
      const bob = await createResource("person", null);
      const response = await invite(owner, inviteBody(), bob.id);
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).code).toBe(
        "RESOURCE_HAS_NO_EMAIL",
      );
      expect(await invitationCount()).toBe(0);
    });

    it("refuses a resource that is linked already", async () => {
      const member = await addMember("member");
      await db
        .update(schema.resourceTable)
        .set({ userId: member.id })
        .where(eq(schema.resourceTable.id, alice.id));
      const response = await invite(owner);
      expect(response.status).toBe(409);
      expect(((await response.json()) as ErrorBody).code).toBe(
        "RESOURCE_ALREADY_LINKED",
      );
      expect(await invitationCount()).toBe(0);
    });

    it("answers 403 for a resource of another workspace", async () => {
      const other = await makeWorkspace("Other");
      const stranger = await signUp(newEmail("stranger"));
      await join(stranger, other.id, "owner");
      const response = await invite(stranger);
      expect(response.status).toBe(403);
      expect(await invitationCount()).toBe(0);
      expect((await resourceRow()).invitationId).toBeNull();
    });

    it("needs at least one project, and lists each once", async () => {
      expect((await invite(owner, inviteBody({ projects: [] }))).status).toBe(
        400,
      );
      const duplicate = await invite(
        owner,
        inviteBody({
          projects: [
            { projectId: P.id, role: "member" },
            { projectId: P.id, role: "viewer" },
          ],
        }),
      );
      expect(duplicate.status).toBe(400);
      expect(((await duplicate.json()) as ErrorBody).code).toBe(
        "DUPLICATE_PROJECT",
      );
      expect(await invitationCount()).toBe(0);
    });

    it("refuses a project of another workspace like a project without access", async () => {
      const other = await makeWorkspace("Other");
      const foreign = await makeProject("Foreign", other.id);
      const response = await invite(
        owner,
        inviteBody({ projects: [{ projectId: foreign.id, role: "viewer" }] }),
      );
      expect(response.status).toBe(403);
      expect(await invitationCount()).toBe(0);
    });

    it("refuses an unknown role and the owner role", async () => {
      const unknown = await invite(
        owner,
        inviteBody({ workspaceRole: "nope" }),
      );
      expect(unknown.status).toBe(400);
      expect(((await unknown.json()) as ErrorBody).code).toBe("UNKNOWN_ROLE");
      const ownerRole = await invite(
        owner,
        inviteBody({ workspaceRole: "owner" }),
      );
      expect(ownerRole.status).toBe(400);
      expect(((await ownerRole.json()) as ErrorBody).code).toBe(
        "OWNER_ROLE_NOT_ALLOWED",
      );
      const ownerProject = await invite(
        owner,
        inviteBody({ projects: [{ projectId: P.id, role: "owner" }] }),
      );
      expect(ownerProject.status).toBe(400);
      expect(await invitationCount()).toBe(0);
    });

    it("answers 409 ALREADY_WORKSPACE_MEMBER when the address belongs to a member", async () => {
      const member = await addMember("member");
      await db
        .update(schema.resourceTable)
        .set({ email: member.email.toUpperCase() })
        .where(eq(schema.resourceTable.id, alice.id));
      const response = await invite(owner);
      expect(response.status).toBe(409);
      expect(((await response.json()) as ErrorBody).code).toBe(
        "ALREADY_WORKSPACE_MEMBER",
      );
      expect(await invitationCount()).toBe(0);
      expect((await resourceRow()).invitationId).toBeNull();
    });
  });

  describe("delegation, per project", () => {
    // Workspace role `resource_manager` (project:update, viewer permissions
    // otherwise), project role `inviter` in P (may invite, views), `member` in Q
    // (cannot invite), nothing in R.
    async function manager() {
      return addMember(
        "resource_manager",
        [
          { project: P, role: "inviter" },
          { project: Q, role: "member" },
        ],
        "manager",
      );
    }

    it("lets an inviter invite to a project they may invite to, within their own roles", async () => {
      const actor = await manager();
      const response = await invite(
        actor,
        inviteBody({
          workspaceRole: "viewer",
          projects: [{ projectId: P.id, role: "viewer" }],
        }),
      );
      expect(response.status).toBe(201);
      expect(await invitationCount()).toBe(1);
      const [invitation] = await db.select().from(schema.invitationTable);
      expect(invitation.inviterId).toBe(actor.id);
    });

    it("refuses a project role above the inviter's own in that project", async () => {
      const actor = await manager();
      const response = await invite(
        actor,
        inviteBody({
          workspaceRole: "viewer",
          projects: [{ projectId: P.id, role: "member" }],
        }),
      );
      expect(response.status).toBe(403);
      expect(((await response.json()) as ErrorBody).code).toBe(
        "ROLE_EXCEEDS_YOUR_PERMISSIONS",
      );
      expect(await invitationCount()).toBe(0);
      expect((await resourceRow()).invitationId).toBeNull();
    });

    it("refuses a project where the caller cannot invite, and creates nothing for the others", async () => {
      const actor = await manager();
      const response = await invite(
        actor,
        inviteBody({
          workspaceRole: "viewer",
          projects: [
            { projectId: P.id, role: "viewer" },
            { projectId: Q.id, role: "viewer" },
          ],
        }),
      );
      expect(response.status).toBe(403);
      expect(((await response.json()) as ErrorBody).code).toBe(
        "INSUFFICIENT_PERMISSIONS",
      );
      expect(await invitationCount()).toBe(0);
      expect((await resourceRow()).invitationId).toBeNull();
    });

    it("refuses a project the caller cannot open", async () => {
      const actor = await manager();
      const response = await invite(
        actor,
        inviteBody({
          workspaceRole: "viewer",
          projects: [{ projectId: R.id, role: "viewer" }],
        }),
      );
      expect(response.status).toBe(403);
      expect(await invitationCount()).toBe(0);
    });

    it("refuses a workspace role above the caller's own", async () => {
      const actor = await manager();
      const response = await invite(
        actor,
        inviteBody({
          workspaceRole: "member",
          projects: [{ projectId: P.id, role: "viewer" }],
        }),
      );
      expect(response.status).toBe(403);
      expect(((await response.json()) as ErrorBody).code).toBe(
        "ROLE_EXCEEDS_YOUR_PERMISSIONS",
      );
      expect(await invitationCount()).toBe(0);
    });

    it("needs the right to manage resources", async () => {
      const viewer = await addMember(
        "viewer",
        [{ project: P, role: "inviter" }],
        "viewer",
      );
      const response = await invite(
        viewer,
        inviteBody({
          workspaceRole: "viewer",
          projects: [{ projectId: P.id, role: "viewer" }],
        }),
      );
      expect(response.status).toBe(403);
      expect(await invitationCount()).toBe(0);
    });

    it("offers only the projects the caller can invite to", async () => {
      const actor = await manager();
      const forManager = await request(
        actor.cookie,
        "GET",
        `/api/resource/${alice.id}/invite-defaults`,
      );
      expect(forManager.status).toBe(200);
      expect(
        (
          (await forManager.json()) as { projects: { id: string }[] }
        ).projects.map((p) => p.id),
      ).toEqual([P.id]);

      const forOwner = await request(
        owner.cookie,
        "GET",
        `/api/resource/${alice.id}/invite-defaults`,
      );
      const projects = (
        (await forOwner.json()) as {
          projects: { id: string; hasAssignments: boolean }[];
        }
      ).projects;
      // The projects with assignments first (pre-selected), then the others.
      expect(projects.map((p) => [p.id, p.hasAssignments])).toEqual([
        [P.id, true],
        [Q.id, true],
        [R.id, true],
        [S.id, false],
      ]);
    });
  });
});

describe("accepting an invitation sent from a resource", () => {
  async function inviteAndSignUp(body: unknown = inviteBody()) {
    const response = await invite(owner, body);
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const invitee = await signUp(aliceEmail);
    return { id, invitee };
  }

  it("links the resource and moves the assignments in the projects the account can open", async () => {
    const { id, invitee } = await inviteAndSignUp();
    // The account already sits on t1 (say, from an earlier membership): the
    // two assignments merge into one.
    await assign(t1, { userId: invitee.id }, 50, 8);

    const response = await accept(invitee, id);
    expect(response.status).toBe(200);

    const row = await resourceRow();
    expect(row.userId).toBe(invitee.id);
    expect(row.invitationId).toBeNull();

    // t1: one row, the higher units, the work of the side that has it.
    expect(await assignmentsOf(t1)).toEqual([
      { userId: invitee.id, resourceId: null, units: 80, work: 8 },
    ]);
    // t2 and t3 (P and Q are invited to): converted in place, work kept.
    expect(await assignmentsOf(t2)).toEqual([
      { userId: invitee.id, resourceId: null, units: 100, work: 5 },
    ]);
    expect(await assignmentsOf(t3)).toEqual([
      { userId: invitee.id, resourceId: null, units: 60, work: null },
    ]);
    // t4 is in R, which the account cannot open: it stays on the resource.
    expect(await assignmentsOf(t4)).toEqual([
      { userId: null, resourceId: alice.id, units: 100, work: null },
    ]);

    // The primary mirror follows the assignment table.
    expect(await primaryOf(t1)).toBe(invitee.id);
    expect(await primaryOf(t2)).toBe(invitee.id);
    expect(await primaryOf(t3)).toBe(invitee.id);
    expect(await primaryOf(t4)).toBeNull();

    // The list shows the link, the account and no invitation.
    const listed = (await listResources(owner)).find((r) => r.id === alice.id);
    expect(listed?.userId).toBe(invitee.id);
    expect(listed?.user).toMatchObject({
      id: invitee.id,
      email: aliceEmail,
    });
    expect(listed?.invitation).toBeNull();
  });

  it("publishes the assignee events of a normal change, for the tasks that changed", async () => {
    const { id, invitee } = await inviteAndSignUp();
    await assign(t1, { userId: invitee.id }, 50, 8);
    published.length = 0;

    expect((await accept(invitee, id)).status).toBe(200);

    await vi.waitFor(() => {
      expect(published.map((event) => event.taskId).sort()).toEqual(
        [t2, t3].sort(),
      );
    });
    for (const event of published) {
      // The account is the actor of its own re-attribution, whoever sent the
      // invitation.
      expect(event).toMatchObject({
        userId: invitee.id,
        newAssigneeId: invitee.id,
        addedAssigneeIds: [invitee.id],
        removedAssigneeIds: [],
        source: "resource_link",
      });
    }
    expect(new Set(published.map((event) => event.projectId))).toEqual(
      new Set([P.id, Q.id]),
    );

    // The activity feed got its entry, and the person got no notification for
    // their own re-attributed tasks.
    await vi.waitFor(async () => {
      const activity = await db
        .select({ type: schema.activityTable.type })
        .from(schema.activityTable)
        .where(eq(schema.activityTable.taskId, t2));
      expect(activity.map((row) => row.type)).toContain("assignee_changed");
    });
    const notifications = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, invitee.id));
    expect(notifications).toEqual([]);
  });

  it("moves every assignment for somebody with full access", async () => {
    const { id, invitee } = await inviteAndSignUp(
      inviteBody({ workspaceRole: "admin" }),
    );
    expect((await accept(invitee, id)).status).toBe(200);
    for (const taskId of [t1, t2, t3, t4]) {
      expect(
        (await assignmentsOf(taskId)).every(
          (row) => row.userId === invitee.id && row.resourceId === null,
        ),
      ).toBe(true);
    }
    expect(await primaryOf(t4)).toBe(invitee.id);
  });

  it("keeps the older user as the primary assignee of a task that has one", async () => {
    const other = await addMember("member", [{ project: P, role: "member" }]);
    const shared = await makeTask(P, { title: "shared" });
    await assign(shared, { userId: other.id }, 100);
    await assign(shared, { resourceId: alice.id }, 100);
    const { id, invitee } = await inviteAndSignUp();
    expect((await accept(invitee, id)).status).toBe(200);

    expect(await primaryOf(shared)).toBe(other.id);
    const rows = await assignmentsOf(shared);
    expect(rows.map((row) => row.userId).sort()).toEqual(
      [invitee.id, other.id].sort(),
    );
  });

  it("does nothing to resources when a plain workspace invitation is accepted", async () => {
    const email = newEmail("plain");
    const [invitation] = await db
      .insert(schema.invitationTable)
      .values({
        workspaceId,
        email,
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 3_600_000),
        inviterId: owner.id,
      })
      .returning();
    const person = await signUp(email);
    expect((await accept(person, invitation.id)).status).toBe(200);
    const row = await resourceRow();
    expect(row.userId).toBeNull();
    expect(await assignmentsOf(t1)).toHaveLength(1);
  });

  it("reverts the acceptance when the transfer fails, and leaves the resource untouched", async () => {
    const { id, invitee } = await inviteAndSignUp();
    vi.spyOn(transferModule, "moveResourceAssignmentsToUser").mockRejectedValue(
      new Error("boom"),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await accept(invitee, id);
    expect(response.status).toBe(500);
    expect(((await response.json()) as ErrorBody).code).toBe(
      "PROJECT_INVITATION_NOT_APPLIED",
    );

    // Memberships, link and assignments rolled back together; the invitation
    // is pending again and can be used once the fault is gone.
    const memberRows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, invitee.id));
    expect(memberRows).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.projectMemberTable)
        .where(eq(schema.projectMemberTable.userId, invitee.id)),
    ).toEqual([]);
    const [invitation] = await db
      .select({ status: schema.invitationTable.status })
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, id));
    expect(invitation?.status).toBe("pending");
    const row = await resourceRow();
    expect(row.userId).toBeNull();
    expect(row.invitationId).toBe(id);
    expect(await assignmentsOf(t1)).toEqual([
      { userId: null, resourceId: alice.id, units: 80, work: null },
    ]);

    vi.restoreAllMocks();
    expect((await accept(invitee, id)).status).toBe(200);
    expect((await resourceRow()).userId).toBe(invitee.id);
  });
});

describe("linking a resource to a member", () => {
  it("moves the assignments in the projects the member can open and merges duplicates", async () => {
    const member = await addMember("member", [{ project: P, role: "member" }]);
    await assign(t1, { userId: member.id }, 30);

    const response = await link(owner, member.id);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      movedTaskCount: number;
      resource: { userId: string; user: { id: string } | null };
    };
    expect(body.movedTaskCount).toBe(2);
    expect(body.resource.userId).toBe(member.id);
    expect(body.resource.user?.id).toBe(member.id);

    // t1 merges: the higher units (the resource's 80), not the sum.
    expect(await assignmentsOf(t1)).toEqual([
      { userId: member.id, resourceId: null, units: 80, work: null },
    ]);
    expect(await assignmentsOf(t2)).toEqual([
      { userId: member.id, resourceId: null, units: 100, work: 5 },
    ]);
    // Q and R are out of reach for this member.
    expect(await assignmentsOf(t3)).toEqual([
      { userId: null, resourceId: alice.id, units: 60, work: null },
    ]);
    expect(await assignmentsOf(t4)).toEqual([
      { userId: null, resourceId: alice.id, units: 100, work: null },
    ]);
    expect(await primaryOf(t2)).toBe(member.id);
    expect(await primaryOf(t3)).toBeNull();
    expect((await resourceRow()).userId).toBe(member.id);

    await vi.waitFor(() => {
      expect(published.map((event) => event.taskId)).toEqual([t2]);
    });
    expect(published[0]).toMatchObject({
      userId: owner.id,
      newAssigneeId: member.id,
    });
  });

  it("keeps the work of the side that has it when the account's assignment wins", async () => {
    const member = await addMember("member", [{ project: P, role: "member" }]);
    await assign(t2, { userId: member.id }, 100);
    expect((await link(owner, member.id)).status).toBe(200);
    // Equal units: the account's row is kept, and it takes the resource's work.
    expect(await assignmentsOf(t2)).toEqual([
      { userId: member.id, resourceId: null, units: 100, work: 5 },
    ]);
  });

  it("gives a full-access member every assignment", async () => {
    const admin = await addMember("admin");
    const response = await link(owner, admin.id);
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { movedTaskCount: number }).movedTaskCount,
    ).toBe(4);
    expect(await assignmentsOf(t4)).toEqual([
      { userId: admin.id, resourceId: null, units: 100, work: null },
    ]);
  });

  it("refuses somebody who is not a member of the workspace", async () => {
    const outsider = await signUp(newEmail("outsider"));
    const response = await link(owner, outsider.id);
    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).code).toBe(
      "NOT_A_WORKSPACE_MEMBER",
    );
    expect((await resourceRow()).userId).toBeNull();
    expect(await assignmentsOf(t1)).toHaveLength(1);
    expect((await assignmentsOf(t1))[0]?.resourceId).toBe(alice.id);
  });

  it("refuses a resource that is linked already, and one that is not a person", async () => {
    const member = await addMember("member", [{ project: P, role: "member" }]);
    expect((await link(owner, member.id)).status).toBe(200);
    const again = await link(owner, member.id);
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorBody).code).toBe(
      "RESOURCE_ALREADY_LINKED",
    );

    const drill = await createResource("equipment", null);
    const equipment = await link(owner, member.id, drill.id);
    expect(equipment.status).toBe(400);
    expect(((await equipment.json()) as ErrorBody).code).toBe(
      "RESOURCE_NOT_PERSON",
    );
  });

  it("needs member:update as well as the right to manage resources", async () => {
    const member = await addMember("member", [{ project: P, role: "member" }]);
    const manager = await addMember("resource_manager", [], "manager");
    const denied = await link(manager, member.id);
    expect(denied.status).toBe(403);
    expect((await resourceRow()).userId).toBeNull();

    const plain = await addMember("member", [], "plain");
    expect((await link(plain, member.id)).status).toBe(403);

    // Built-in admin holds both.
    const admin = await addMember("admin", [], "admin");
    expect((await link(admin, member.id)).status).toBe(200);
  });

  it("unlinks, leaving the moved assignments with the account", async () => {
    const member = await addMember("member", [{ project: P, role: "member" }]);
    const notLinked = await request(
      owner.cookie,
      "POST",
      `/api/resource/${alice.id}/unlink`,
    );
    expect(notLinked.status).toBe(409);
    expect(((await notLinked.json()) as ErrorBody).code).toBe(
      "RESOURCE_NOT_LINKED",
    );

    await link(owner, member.id);
    const response = await request(
      owner.cookie,
      "POST",
      `/api/resource/${alice.id}/unlink`,
    );
    expect(response.status).toBe(200);
    expect((await resourceRow()).userId).toBeNull();
    expect(await assignmentsOf(t2)).toEqual([
      { userId: member.id, resourceId: null, units: 100, work: 5 },
    ]);
    // The assignments that stayed on the resource are still its own.
    expect((await assignmentsOf(t3))[0]?.resourceId).toBe(alice.id);
  });

  it("does not show a linked account to a caller who cannot see that member", async () => {
    const hidden = await addMember("member", [{ project: R, role: "member" }]);
    await db
      .update(schema.resourceTable)
      .set({ userId: hidden.id })
      .where(eq(schema.resourceTable.id, alice.id));
    // Reads resources (project:read) but shares no project with `hidden` and
    // manages no members.
    const reader = await addMember("viewer", [{ project: P, role: "viewer" }]);
    const listed = (await listResources(reader)).find((r) => r.id === alice.id);
    // The link is known ("linked"), the account is not: no id, no identity.
    expect(listed?.linked).toBe(true);
    expect(listed?.userId).toBeNull();
    expect(listed?.user).toBeNull();
    expect(JSON.stringify(listed)).not.toContain(hidden.id);
    expect(JSON.stringify(listed)).not.toContain(hidden.email);

    const asOwner = (await listResources(owner)).find((r) => r.id === alice.id);
    expect(asOwner?.linked).toBe(true);
    expect(asOwner?.userId).toBe(hidden.id);
    expect(asOwner?.user).toMatchObject({ id: hidden.id, email: hidden.email });
  });

  it("says an unlinked resource is not linked", async () => {
    const listed = (await listResources(owner)).find((r) => r.id === alice.id);
    expect(listed?.linked).toBe(false);
    expect(listed?.userId).toBeNull();
  });

  it("does not reveal the link in the single-resource responses either", async () => {
    const hidden = await addMember("member", [{ project: R, role: "member" }]);
    await db
      .update(schema.resourceTable)
      .set({ userId: hidden.id })
      .where(eq(schema.resourceTable.id, alice.id));
    // Manages resources (project:update) but sees no member of R.
    const manager = await addMember(
      "resource_manager",
      [{ project: P, role: "viewer" }],
      "manager",
    );
    const response = await request(
      manager.cookie,
      "PATCH",
      `/api/resource/${alice.id}`,
      { name: "Alice again" },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.linked).toBe(true);
    expect(body.userId).toBeNull();
    expect(body.user).toBeNull();
  });
});

describe("who sees the invitation state of a resource", () => {
  async function invited() {
    expect((await invite(owner)).status).toBe(201);
  }
  const stateFor = async (actor: Actor) =>
    (await listResources(actor)).find((r) => r.id === alice.id)?.invitation;

  it("shows it to somebody who can invite in the workspace role", async () => {
    await invited();
    expect(await stateFor(owner)).toMatchObject({ status: "pending" });
    const admin = await addMember("admin", [], "admin");
    expect(await stateFor(admin)).toMatchObject({ status: "pending" });
  });

  it("shows it to somebody who can invite in at least one project", async () => {
    await invited();
    const inviter = await addMember("viewer", [
      { project: P, role: "inviter" },
    ]);
    expect(await stateFor(inviter)).toMatchObject({ status: "pending" });
  });

  it("hides it from somebody who can invite nowhere", async () => {
    await invited();
    const reader = await addMember("viewer", [{ project: P, role: "viewer" }]);
    expect(await stateFor(reader)).toBeNull();
    const manager = await addMember("resource_manager", [], "manager");
    expect(await stateFor(manager)).toBeNull();
  });
});

describe("workload of a linked resource", () => {
  type WorkloadRow = { userId: string | null; counts: number[] };
  async function workload(actor: Actor) {
    const response = await request(
      actor.cookie,
      "GET",
      `/api/workload/${workspaceId}?from=2030-01-01&to=2030-01-07`,
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { assignees: WorkloadRow[] }).assignees;
  }

  it("gives an unlinked resource its own row", async () => {
    const rows = await workload(owner);
    expect(rows.find((row) => row.userId === alice.id)?.counts[0]).toBe(4);
  });

  it("has one row for the account, counting what stayed on the resource", async () => {
    const member = await addMember("member", [{ project: P, role: "member" }]);
    // The account is on a task of Q as well, next to the resource and a
    // colleague: the account and its resource are one person, so the task is
    // split between two people (the higher allocation counts), not three.
    const colleague = await addMember("member", [], "colleague");
    const both = await makeTask(Q, { title: "both", day: "2030-01-02" });
    await assign(both, { userId: member.id }, 100);
    await assign(both, { resourceId: alice.id }, 50);
    await assign(both, { userId: colleague.id }, 100);

    expect((await link(owner, member.id)).status).toBe(200);

    const rows = await workload(owner);
    // No row of the resource's own any more.
    expect(rows.find((row) => row.userId === alice.id)).toBeUndefined();
    const memberRows = rows.filter((row) => row.userId === member.id);
    expect(memberRows).toHaveLength(1);
    // t1 and t2 moved (2), t3 and t4 stayed on the resource (2), and half of
    // `both`.
    expect(memberRows[0]?.counts[0]).toBe(4.5);
  });

  it("drills through an account into the tasks of its linked resource", async () => {
    const member = await addMember("member", [{ project: P, role: "member" }]);
    await link(owner, member.id);
    const response = await request(
      owner.cookie,
      "GET",
      `/api/workload/${workspaceId}/tasks?from=2030-01-01&to=2030-01-07&assigneeId=${member.id}`,
    );
    expect(response.status).toBe(200);
    const { tasks } = (await response.json()) as { tasks: { id: string }[] };
    expect(tasks.map((task) => task.id).sort()).toEqual(
      [t1, t2, t3, t4].sort(),
    );
  });

  it("respects the project scope of the caller for the leftover assignments", async () => {
    const member = await addMember("member", [{ project: P, role: "member" }]);
    await link(owner, member.id);
    // Sees only P: t3 and t4 (Q, R) are out of scope for them.
    const viewer = await addMember("viewer", [{ project: P, role: "viewer" }]);
    const rows = await workload(viewer);
    const memberRow = rows.find((row) => row.userId === member.id);
    expect(memberRow?.counts[0] ?? 0).toBe(2);
    expect(rows.find((row) => row.userId === alice.id)).toBeUndefined();
  });
});

describe("assignments of a resource in a project of another workspace", () => {
  it("are not moved by a link", async () => {
    const other = await makeWorkspace("Other");
    const foreign = await makeProject("Foreign", other.id);
    const foreignTask = await makeTask(foreign);
    await assign(foreignTask, { resourceId: alice.id }, 100);
    const admin = await addMember("admin");
    await link(owner, admin.id);
    expect((await assignmentsOf(foreignTask))[0]?.resourceId).toBe(alice.id);
  });
});

describe("assignments moved by a link", () => {
  it("are found by the same query the assignee routes use", async () => {
    const member = await addMember("member", [{ project: P, role: "member" }]);
    await link(owner, member.id);
    const response = await request(owner.cookie, "GET", `/api/task/${t2}`);
    expect(response.status).toBe(200);
    const task = (await response.json()) as {
      userId: string | null;
      assignees?: { userId: string | null; resourceId: string | null }[];
    };
    expect(task.userId).toBe(member.id);
    expect(
      task.assignees?.some(
        (assignee) => assignee.userId === member.id && !assignee.resourceId,
      ),
    ).toBe(true);
  });
});

describe("privacy of the fold in the workload", () => {
  type WorkloadRow = {
    userId: string | null;
    name: string | null;
    counts: number[];
  };
  async function workload(actor: Actor) {
    const response = await request(
      actor.cookie,
      "GET",
      `/api/workload/${workspaceId}?from=2030-01-01&to=2030-01-07`,
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { assignees: WorkloadRow[] }).assignees;
  }

  // The account is in project R only, the viewer in P only: they share nothing,
  // so the viewer may not learn who the resource is linked to.
  async function hiddenAccount() {
    const hidden = await addMember("member", [{ project: R, role: "member" }]);
    await db
      .update(schema.resourceTable)
      .set({ userId: hidden.id })
      .where(eq(schema.resourceTable.id, alice.id));
    const viewer = await addMember("viewer", [{ project: P, role: "viewer" }]);
    return { hidden, viewer };
  }

  it("keeps a row of its own for a caller who cannot see the account", async () => {
    const { hidden, viewer } = await hiddenAccount();
    const rows = await workload(viewer);
    const own = rows.find((row) => row.userId === alice.id);
    expect(own?.name).toBe("A person");
    expect(own?.counts[0]).toBe(2);
    // Nothing of the account leaks: no row, no name, no id.
    expect(rows.find((row) => row.userId === hidden.id)).toBeUndefined();
    expect(JSON.stringify(rows)).not.toContain(hidden.id);
    expect(JSON.stringify(rows)).not.toContain(hidden.email);
  });

  it("folds it for a caller who can see the account", async () => {
    const { hidden } = await hiddenAccount();
    const rows = await workload(owner);
    expect(rows.find((row) => row.userId === alice.id)).toBeUndefined();
    expect(rows.find((row) => row.userId === hidden.id)?.counts[0]).toBe(4);
  });

  it("does not let the drill-through of an account confirm a hidden link", async () => {
    const { hidden, viewer } = await hiddenAccount();
    const tasksOf = async (actor: Actor, assigneeId: string) => {
      const response = await request(
        actor.cookie,
        "GET",
        `/api/workload/${workspaceId}/tasks?from=2030-01-01&to=2030-01-07&assigneeId=${assigneeId}`,
      );
      expect(response.status).toBe(200);
      return ((await response.json()) as { tasks: { id: string }[] }).tasks
        .map((task) => task.id)
        .sort();
    };
    // The hidden account's id finds nothing of the resource for the viewer...
    expect(await tasksOf(viewer, hidden.id)).toEqual([]);
    // ...their row is the resource's own, which drills through as before.
    expect(await tasksOf(viewer, alice.id)).toEqual([t1, t2].sort());
    // The owner sees the account's row with the resource's tasks in it.
    expect(await tasksOf(owner, hidden.id)).toEqual([t1, t2, t3, t4].sort());
  });
});

describe("leaving the workspace unlinks the resources of the account", () => {
  async function linked(role = "member") {
    const member = await addMember(role, [{ project: P, role: "member" }]);
    expect((await link(owner, member.id)).status).toBe(200);
    const [row] = await db
      .select({ id: schema.workspaceUserTable.id })
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, member.id));
    return { member, memberId: row.id };
  }

  it("removing the member clears the link and moves nothing back", async () => {
    const { member, memberId } = await linked();
    const response = await request(
      owner.cookie,
      "POST",
      "/api/auth/organization/remove-member",
      { organizationId: workspaceId, memberIdOrEmail: memberId },
    );
    expect(response.status).toBe(200);
    expect((await resourceRow()).userId).toBeNull();
    // What moved stays with the account, what stayed stays on the resource.
    expect((await assignmentsOf(t2))[0]?.userId).toBe(member.id);
    expect((await assignmentsOf(t3))[0]?.resourceId).toBe(alice.id);
    // The resource is a plain resource again: it can be linked anew.
    const other = await addMember("member", [{ project: P, role: "member" }]);
    expect((await link(owner, other.id)).status).toBe(200);
  });

  it("leaving clears the link", async () => {
    const { member } = await linked();
    const response = await request(
      member.cookie,
      "POST",
      "/api/auth/organization/leave",
      { organizationId: workspaceId },
    );
    expect(response.status).toBe(200);
    expect((await resourceRow()).userId).toBeNull();
  });

  it("deleting the account clears the link", async () => {
    const { member } = await linked();
    await db.delete(schema.userTable).where(eq(schema.userTable.id, member.id));
    expect((await resourceRow()).userId).toBeNull();
  });

  it("clears only the links in that workspace", async () => {
    const { member, memberId } = await linked();
    const other = await makeWorkspace("Elsewhere");
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: other.id,
      userId: member.id,
      role: "member",
      joinedAt: new Date(),
    });
    const [elsewhere] = await db
      .insert(schema.resourceTable)
      .values({
        workspaceId: other.id,
        kind: "person",
        name: "Elsewhere",
        userId: member.id,
      })
      .returning();
    await request(
      owner.cookie,
      "POST",
      "/api/auth/organization/remove-member",
      { organizationId: workspaceId, memberIdOrEmail: memberId },
    );
    expect((await resourceRow()).userId).toBeNull();
    expect((await resourceRow(elsewhere.id)).userId).toBe(member.id);
  });
});

describe("the transfer under a concurrent change", () => {
  it("merges into a row of the account that is added while it runs", async () => {
    const member = await addMember("member", [{ project: P, role: "member" }]);
    // Somebody assigns the account to t1 in a transaction that is still open
    // when the link starts: the link's insert waits for it, then merges into
    // the committed row instead of failing on the unique key.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inserted: () => void = () => undefined;
    const insertedRow = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const concurrent = db.transaction(async (tx) => {
      await tx.insert(schema.taskAssignmentTable).values({
        taskId: t1,
        userId: member.id,
        units: 90,
        work: 7,
      });
      inserted();
      await held;
    });
    await insertedRow;
    const linking = link(owner, member.id);
    await new Promise((resolve) => setTimeout(resolve, 400));
    release();
    await concurrent;

    const response = await linking;
    expect(response.status).toBe(200);
    // t1: the account's 90 beats the resource's 80, its work is kept.
    expect(await assignmentsOf(t1)).toEqual([
      { userId: member.id, resourceId: null, units: 90, work: 7 },
    ]);
    expect((await assignmentsOf(t2))[0]?.userId).toBe(member.id);
  });
});

describe("resource email limits", () => {
  it("refuses an address longer than an email can be", async () => {
    const long = `${"a".repeat(250)}@example.com`;
    const response = await request(
      owner.cookie,
      "POST",
      `/api/resource/workspace/${workspaceId}`,
      { kind: "person", name: "Long", email: long },
    );
    expect(response.status).toBe(400);
  });
});

describe("the rows the transfer writes", () => {
  it("converts a resource row in place: same id and creation time", async () => {
    const [before] = await db
      .select()
      .from(schema.taskAssignmentTable)
      .where(eq(schema.taskAssignmentTable.taskId, t2));
    const member = await addMember("member", [{ project: P, role: "member" }]);
    expect((await link(owner, member.id)).status).toBe(200);
    const [after] = await db
      .select()
      .from(schema.taskAssignmentTable)
      .where(eq(schema.taskAssignmentTable.taskId, t2));
    expect(after.id).toBe(before.id);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.userId).toBe(member.id);
    expect(after.resourceId).toBeNull();
  });

  it("merges into the account's own row and drops the resource row when both exist", async () => {
    const member = await addMember("member", [{ project: P, role: "member" }]);
    await assign(t1, { userId: member.id }, 30);
    const [own] = await db
      .select()
      .from(schema.taskAssignmentTable)
      .where(eq(schema.taskAssignmentTable.userId, member.id));
    expect((await link(owner, member.id)).status).toBe(200);
    const rows = await db
      .select()
      .from(schema.taskAssignmentTable)
      .where(eq(schema.taskAssignmentTable.taskId, t1));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(own.id);
    expect(rows[0]?.units).toBe(80);
  });

  it("reports the projects whose tasks moved", async () => {
    const member = await addMember("member", [
      { project: P, role: "member" },
      { project: Q, role: "member" },
    ]);
    const response = await link(owner, member.id);
    const body = (await response.json()) as { movedProjectIds: string[] };
    expect([...body.movedProjectIds].sort()).toEqual([P.id, Q.id].sort());
  });
});

describe("leaving the workspace when the cleanup fails", () => {
  it("still closes the leaver's sockets", async () => {
    const member = await addMember("member", [{ project: P, role: "member" }]);
    expect((await link(owner, member.id)).status).toBe(200);
    const socket = { send: vi.fn(), close: vi.fn() };
    const connection = addConnection(
      P.id,
      socket as unknown as WSContext,
      member.id,
      "window",
      workspaceId,
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(linkModule, "unlinkUserResources").mockRejectedValueOnce(
      new Error("database went away"),
    );
    try {
      await request(member.cookie, "POST", "/api/auth/organization/leave", {
        organizationId: workspaceId,
      });
      await vi.waitFor(() => expect(socket.close).toHaveBeenCalledTimes(1));
    } finally {
      removeConnection(P.id, connection);
    }
  });
});

describe("invite defaults when a project stops being accessible meanwhile", () => {
  it("leaves out just that project", async () => {
    const actor = await addMember(
      "resource_manager",
      [
        { project: P, role: "inviter" },
        { project: Q, role: "inviter" },
      ],
      "manager",
    );
    // The scope was resolved when R was still open to them; it is not any more.
    vi.spyOn(accessModule, "accessibleProjectIds").mockResolvedValue(null);
    const response = await request(
      actor.cookie,
      "GET",
      `/api/resource/${alice.id}/invite-defaults`,
    );
    expect(response.status).toBe(200);
    const ids = (
      (await response.json()) as { projects: { id: string }[] }
    ).projects
      .map((project) => project.id)
      .sort();
    expect(ids).toEqual([P.id, Q.id].sort());
  });
});
