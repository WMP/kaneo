import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import type { Session, User } from "better-auth/types";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serve } from "../../apps/api/node_modules/@hono/node-server";
import type { NodeWebSocket } from "../../apps/api/node_modules/@hono/node-ws";
import { auth } from "../../apps/api/src/auth";
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

// Access to a project comes from a project membership, except for full-access
// users (workspace owner, a role granting workspace:manage_settings, instance
// administrators). See docs/plans/project-membership.md.

vi.mock("../../apps/api/src/events", async (original) => ({
  ...(await original<object>()),
  publishEvent: vi.fn(async () => undefined),
}));
vi.mock(
  "../../apps/api/src/notification/controllers/create-notification",
  () => ({ default: vi.fn(async () => null) }),
);

const { app } = createApp();

const DENIED_PROJECT = "You don't have access to this project";
const DENIED_WORKSPACE = "You don't have access to this workspace";

type World = Awaited<ReturnType<typeof buildWorld>>;

// One workspace with a project that has NO project members yet, then:
// - member:        workspace role `member`, project role `admin` (differs from
//                  the workspace role on purpose)
// - workspaceOnly: workspace role `member`, no project membership
// - fullAdmin:     workspace role `admin` (grants manage_settings), no membership
// - outsider:      owner of a different workspace
async function buildWorld() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const workspaceId = owner.workspace.id;
  const { project, columns } = await createProjectFixture({
    workspaceId,
    members: "none",
  });
  const { project: otherProject } = await createProjectFixture({
    workspaceId,
    members: "none",
    name: "Second project",
  });

  const member = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(project.id, member.id, "admin");
  await addProjectMember(otherProject.id, member.id, "admin");
  const workspaceOnly = await addWorkspaceMember(workspaceId, "member");
  const fullAdmin = await addWorkspaceMember(workspaceId, "admin");
  const outsider = await createWorkspaceMember({ role: "owner" });

  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Task one",
      description: "first",
      status: "to-do",
      columnId: columns.todo.id,
      number: 1,
      position: 1,
    })
    .returning();
  const [task2] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Task two",
      status: "to-do",
      columnId: columns.todo.id,
      number: 2,
      position: 2,
    })
    .returning();
  // Tasks are numbered by the project counter; keep it in step with the seeds.
  await db
    .update(schema.projectTable)
    .set({ lastTaskNumber: 2 })
    .where(eq(schema.projectTable.id, project.id));
  const [comment] = await db
    .insert(schema.activityTable)
    .values({
      taskId: task.id,
      type: "comment",
      userId: owner.user.id,
      content: "a comment",
    })
    .returning();
  const [timeEntry] = await db
    .insert(schema.timeEntryTable)
    .values({
      taskId: task.id,
      userId: owner.user.id,
      startTime: new Date("2026-01-01T09:00:00Z"),
      endTime: new Date("2026-01-01T10:00:00Z"),
    })
    .returning();
  const [label] = await db
    .insert(schema.labelTable)
    .values({ workspaceId, taskId: task.id, name: "bug", color: "#ff0000" })
    .returning();
  const [customField] = await db
    .insert(schema.customFieldDefinitionTable)
    .values({ projectId: project.id, name: "Area", type: "text" })
    .returning();
  const [relation] = await db
    .insert(schema.taskRelationTable)
    .values({
      sourceTaskId: task.id,
      targetTaskId: task2.id,
      relationType: "related",
    })
    .returning();
  const [workflowRule] = await db
    .insert(schema.workflowRuleTable)
    .values({
      projectId: project.id,
      integrationType: "github",
      eventType: "pull_request_opened",
      columnId: columns.inProgress.id,
    })
    .returning();
  const [asset] = await db
    .insert(schema.assetTable)
    .values({
      workspaceId,
      projectId: project.id,
      taskId: task.id,
      objectKey: `assets/${project.id}/probe.png`,
      filename: "probe.png",
      mimeType: "image/png",
      size: 10,
      surface: "description",
    })
    .returning();

  return {
    owner,
    workspaceId,
    project,
    otherProject,
    columns,
    member,
    workspaceOnly,
    fullAdmin,
    outsider,
    task,
    task2,
    comment,
    timeEntry,
    label,
    customField,
    relation,
    workflowRule,
    asset,
  };
}

type RouteCase = {
  name: string;
  method: string;
  path: (w: World) => string;
  body?: (w: World) => unknown;
  // Status an allowed caller gets. Anything but 403 proves the access gate let
  // the request through; the exact status documents what the handler did.
  ok?: number | "gate";
  // Status for the project member (workspace role member, project role admin)
  // when it differs: workspace-level permissions such as
  // workspace:manage_settings come from the WORKSPACE role.
  memberStatus?: number;
};

const ROUTES: RouteCase[] = [
  // Projects
  {
    name: "get project",
    method: "GET",
    path: (w) => `/project/${w.project.id}`,
  },
  {
    name: "update project",
    method: "PUT",
    path: (w) => `/project/${w.project.id}`,
    body: () => ({
      name: "Renamed",
      icon: "Folder",
      slug: "renamed",
      description: "d",
      isPublic: false,
    }),
  },
  {
    name: "archive project",
    method: "PUT",
    path: (w) => `/project/${w.project.id}/archive`,
  },
  {
    name: "unarchive project",
    method: "PUT",
    path: (w) => `/project/${w.project.id}/unarchive`,
  },
  {
    name: "get project background",
    method: "GET",
    path: (w) => `/project/${w.project.id}/background`,
    ok: 404,
  },
  {
    name: "delete project background",
    method: "DELETE",
    path: (w) => `/project/${w.project.id}/background`,
    ok: 204,
  },
  {
    name: "delete project",
    method: "DELETE",
    path: (w) => `/project/${w.project.id}`,
  },
  // Board and tasks
  {
    name: "board",
    method: "GET",
    path: (w) => `/task/tasks/${w.project.id}`,
  },
  { name: "get task", method: "GET", path: (w) => `/task/${w.task.id}` },
  {
    name: "create task",
    method: "POST",
    path: (w) => `/task/${w.project.id}`,
    body: () => ({
      title: "New",
      description: "",
      priority: "low",
      status: "to-do",
    }),
  },
  {
    name: "update task",
    method: "PUT",
    path: (w) => `/task/${w.task.id}`,
    body: (w) => ({
      title: "Changed",
      priority: "low",
      status: "to-do",
      projectId: w.project.id,
      position: 1,
    }),
  },
  { name: "delete task", method: "DELETE", path: (w) => `/task/${w.task.id}` },
  {
    name: "move task",
    method: "PUT",
    path: (w) => `/task/move/${w.task.id}`,
    body: (w) => ({ destinationProjectId: w.otherProject.id }),
  },
  {
    name: "update task description",
    method: "PUT",
    path: (w) => `/task/description/${w.task.id}`,
    body: () => ({ description: "new text" }),
  },
  {
    name: "read task description",
    method: "GET",
    path: (w) => `/task/${w.task.id}/description`,
  },
  {
    name: "description matches",
    method: "GET",
    path: (w) => `/task/description-matches/${w.project.id}?query=first`,
  },
  {
    name: "export tasks",
    method: "GET",
    path: (w) => `/task/export/${w.project.id}`,
  },
  {
    name: "import tasks",
    method: "POST",
    path: (w) => `/task/import/${w.project.id}`,
    body: () => ({ tasks: [{ title: "Imported", status: "to-do" }] }),
  },
  {
    name: "bulk update (single project)",
    method: "PATCH",
    path: () => "/task/bulk",
    body: (w) => ({
      taskIds: [w.task.id],
      operation: "updatePriority",
      value: "high",
    }),
  },
  // Columns
  {
    name: "list columns",
    method: "GET",
    path: (w) => `/column/${w.project.id}`,
  },
  {
    name: "create column",
    method: "POST",
    path: (w) => `/column/${w.project.id}`,
    body: () => ({ name: "Blocked" }),
  },
  {
    name: "update column",
    method: "PUT",
    path: (w) => `/column/${w.columns.todo.id}`,
    body: () => ({ name: "Backlog" }),
  },
  // Comments and activity
  {
    name: "list comments",
    method: "GET",
    path: (w) => `/comment/${w.task.id}`,
  },
  {
    name: "create comment",
    method: "POST",
    path: (w) => `/comment/${w.task.id}`,
    body: () => ({ content: "hello" }),
  },
  {
    name: "update comment",
    method: "PUT",
    path: (w) => `/comment/${w.comment.id}`,
    body: () => ({ content: "edited" }),
    // The gate passes; the handler only lets the author edit.
    ok: 404,
  },
  {
    name: "delete comment",
    method: "DELETE",
    path: (w) => `/comment/${w.comment.id}`,
    // The gate passes; the handler only lets the author delete.
    ok: 404,
  },
  {
    name: "task activity",
    method: "GET",
    path: (w) => `/activity/${w.task.id}`,
  },
  // Time entries
  {
    name: "list time entries",
    method: "GET",
    path: (w) => `/time-entry/task/${w.task.id}`,
  },
  {
    name: "get time entry",
    method: "GET",
    path: (w) => `/time-entry/${w.timeEntry.id}`,
  },
  {
    name: "create time entry",
    method: "POST",
    path: () => "/time-entry",
    body: (w) => ({
      taskId: w.task.id,
      startTime: "2026-02-01T09:00:00Z",
      endTime: "2026-02-01T10:00:00Z",
    }),
  },
  // Labels
  {
    name: "list task labels",
    method: "GET",
    path: (w) => `/label/task/${w.task.id}`,
  },
  {
    name: "get task label",
    method: "GET",
    path: (w) => `/label/${w.label.id}`,
  },
  {
    name: "create task label",
    method: "POST",
    path: () => "/label",
    body: (w) => ({
      name: "feature",
      color: "#00ff00",
      workspaceId: w.workspaceId,
      taskId: w.task.id,
    }),
  },
  // Custom fields
  {
    name: "project custom fields",
    method: "GET",
    path: (w) => `/custom-field/project/${w.project.id}`,
  },
  {
    name: "task custom field values",
    method: "GET",
    path: (w) => `/custom-field/task/${w.task.id}`,
  },
  {
    name: "create project custom field",
    method: "POST",
    path: () => "/custom-field",
    body: (w) => ({ projectId: w.project.id, name: "Owner", type: "text" }),
  },
  {
    name: "delete project custom field",
    method: "DELETE",
    path: (w) => `/custom-field/${w.customField.id}`,
  },
  // Workflow rules
  {
    name: "list workflow rules",
    method: "GET",
    path: (w) => `/workflow-rule/${w.project.id}`,
  },
  {
    name: "upsert workflow rule",
    method: "PUT",
    path: (w) => `/workflow-rule/${w.project.id}`,
    body: (w) => ({
      integrationType: "github",
      eventType: "pull_request_merged",
      columnId: w.columns.done.id,
    }),
  },
  {
    name: "delete workflow rule",
    method: "DELETE",
    path: (w) => `/workflow-rule/${w.workflowRule.id}`,
  },
  // Relations (own resolvers, not workspaceAccess)
  {
    name: "task relations",
    method: "GET",
    path: (w) => `/task-relation/${w.task.id}`,
  },
  {
    name: "project task relations",
    method: "GET",
    path: (w) => `/task-relation/project/${w.project.id}`,
  },
  {
    name: "create relation",
    method: "POST",
    path: () => "/task-relation",
    body: (w) => ({
      sourceTaskId: w.task2.id,
      targetTaskId: w.task.id,
      relationType: "blocks",
    }),
  },
  {
    name: "delete relation",
    method: "DELETE",
    path: (w) => `/task-relation/${w.relation.id}`,
  },
  // Integrations
  {
    name: "get slack integration",
    method: "GET",
    path: (w) => `/slack-integration/project/${w.project.id}`,
  },
  {
    name: "get github integration",
    method: "GET",
    path: (w) => `/github-integration/project/${w.project.id}`,
  },
  {
    name: "create generic webhook integration",
    method: "POST",
    path: (w) => `/generic-webhook-integration/project/${w.project.id}`,
    body: () => ({ webhookUrl: "https://hooks.example.com/kaneo" }),
    // The gate passes; whether the webhook host resolves depends on the network.
    ok: "gate",
    // Managing integrations needs workspace:manage_settings in the WORKSPACE
    // role, which a project admin with the member role does not have.
    memberStatus: 403,
  },
  {
    name: "import gitlab issues (project from body)",
    method: "POST",
    path: () => "/gitlab-integration/import-issues",
    body: (w) => ({ projectId: w.project.id }),
    ok: 404,
  },
  {
    name: "list calendar feeds",
    method: "GET",
    path: (w) => `/calendar-feed/project/${w.project.id}`,
  },
  // Project members
  {
    name: "list project members",
    method: "GET",
    path: (w) => `/project/${w.project.id}/members`,
  },
  {
    name: "assignable project roles",
    method: "GET",
    path: (w) => `/project/${w.project.id}/assignable-roles`,
  },
  // Assets
  {
    name: "download asset",
    method: "GET",
    path: (w) => `/asset/${w.asset.id}`,
    // The gate passes; the test storage has no such object.
    ok: 404,
  },
];

const ACTORS = [
  { key: "member", allowed: true },
  { key: "fullAdmin", allowed: true },
  { key: "workspaceOnly", allowed: false, message: DENIED_PROJECT },
  { key: "outsider", allowed: false, message: DENIED_WORKSPACE },
] as const;

function actorUser(w: World, key: (typeof ACTORS)[number]["key"]): User {
  return (key === "outsider" ? w.outsider.user : w[key]) as User;
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

beforeEach(async () => {
  await resetTestDatabase();
});

describe("single-project routes are gated by project membership", () => {
  describe.each(ROUTES)("$method $name", (route) => {
    it.each(ACTORS)("$key", async (actor) => {
      const w = await buildWorld();
      mockAuthenticatedSession(actorUser(w, actor.key));

      const response = await call(route.path(w), route.method, route.body?.(w));

      if (actor.key === "member" && route.memberStatus !== undefined) {
        expect(response.status).toBe(route.memberStatus);
        expect(await response.text()).toBe("Insufficient permissions");
      } else if (actor.allowed) {
        const text = await response.clone().text();
        if (route.ok === "gate") {
          expect(response.status, text).not.toBe(403);
          expect(response.status, text).not.toBe(401);
        } else {
          expect(response.status, text).toBe(route.ok ?? 200);
        }
      } else {
        expect(response.status).toBe(403);
        expect(await response.text()).toBe(actor.message);
      }
    });
  });
});

describe("project roles decide what a member can do inside the project", () => {
  async function seeded(workspaceRole: string, projectRole: string) {
    const w = await buildWorld();
    const user = await addWorkspaceMember(w.workspaceId, workspaceRole);
    await addProjectMember(w.project.id, user.id, projectRole);
    mockAuthenticatedSession(user);
    return { w, user };
  }

  const createTaskBody = {
    title: "By role",
    description: "",
    priority: "low",
    status: "to-do",
  };

  it("a project viewer cannot create tasks, a project member can", async () => {
    const viewer = await seeded("member", "viewer");
    const denied = await call(
      `/task/${viewer.w.project.id}`,
      "POST",
      createTaskBody,
    );
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe("Insufficient permissions");
    // Reading still works with the viewer project role.
    expect((await call(`/task/${viewer.w.task.id}`, "GET")).status).toBe(200);

    const member = await seeded("viewer", "member");
    const allowed = await call(
      `/task/${member.w.project.id}`,
      "POST",
      createTaskBody,
    );
    expect(allowed.status).toBe(200);
  });

  it("the project role, not the workspace role, is what applies in the project", async () => {
    // Workspace role member may create tasks; the project role viewer may not.
    const downgraded = await seeded("member", "viewer");
    expect(
      (await call(`/task/${downgraded.w.project.id}`, "POST", createTaskBody))
        .status,
    ).toBe(403);

    // Workspace role viewer may not; the project role member may.
    const upgraded = await seeded("viewer", "member");
    expect(
      (await call(`/task/${upgraded.w.project.id}`, "POST", createTaskBody))
        .status,
    ).toBe(200);
  });

  it("a project role that no longer resolves grants nothing", async () => {
    const custom = await seeded("member", "vanished-role");
    const response = await call(`/task/${custom.w.task.id}`, "GET");
    expect(response.status).toBe(403);
    expect(await response.text()).toBe(DENIED_PROJECT);
  });

  it("owner cannot be stored as a project role", async () => {
    const w = await buildWorld();
    const user = await addWorkspaceMember(w.workspaceId, "member");
    for (const role of ["owner", "admin,owner"]) {
      await expect(
        addProjectMember(w.project.id, user.id, role),
      ).rejects.toThrow();
    }
  });

  it("a custom workspace role works as a project role", async () => {
    const w = await buildWorld();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: w.workspaceId,
      role: "triager",
      permission: JSON.stringify({ task: ["read", "create"] }),
    });
    const user = await addWorkspaceMember(w.workspaceId, "viewer");
    await addProjectMember(w.project.id, user.id, "triager");
    mockAuthenticatedSession(user);
    expect(
      (await call(`/task/${w.project.id}`, "POST", createTaskBody)).status,
    ).toBe(200);
    // task:update is not part of the role.
    expect(
      (await call(`/task/title/${w.task.id}`, "PUT", { title: "renamed" }))
        .status,
    ).toBe(403);
  });

  it("an instance administrator reaches a project without any membership", async () => {
    const w = await buildWorld();
    const [admin] = await db
      .insert(schema.userTable)
      .values({
        id: "instance-admin",
        email: "instance-admin@example.com",
        emailVerified: true,
        name: "Instance admin",
        role: "admin",
      })
      .returning();
    mockAuthenticatedSession(admin as User);
    expect((await call(`/task/${w.task.id}`, "GET")).status).toBe(200);
    expect(
      (await call(`/task/${w.project.id}`, "POST", createTaskBody)).status,
    ).toBe(200);
  });
});

describe("stale and revoked access", () => {
  it("a project row of a user who left the workspace grants nothing", async () => {
    const w = await buildWorld();
    mockAuthenticatedSession(w.member as User);
    expect((await call(`/task/${w.task.id}`, "GET")).status).toBe(200);

    // Row removed directly, as a legacy or out-of-band removal would leave it.
    await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, w.workspaceId),
          eq(schema.workspaceUserTable.userId, w.member.id),
        ),
      );
    const rows = await db
      .select()
      .from(schema.projectMemberTable)
      .where(eq(schema.projectMemberTable.userId, w.member.id));
    expect(rows.length).toBeGreaterThan(0);

    const response = await call(`/task/${w.task.id}`, "GET");
    expect(response.status).toBe(403);
    expect(await response.text()).toBe(DENIED_WORKSPACE);
  });

  it("deleting the project member row revokes access immediately", async () => {
    const w = await buildWorld();
    mockAuthenticatedSession(w.member as User);
    expect((await call(`/task/${w.task.id}`, "GET")).status).toBe(200);
    await db
      .delete(schema.projectMemberTable)
      .where(eq(schema.projectMemberTable.userId, w.member.id));
    const response = await call(`/task/${w.task.id}`, "GET");
    expect(response.status).toBe(403);
    expect(await response.text()).toBe(DENIED_PROJECT);
  });
});

describe("project creation", () => {
  it("makes the creator a project admin and hides the project from other members", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const creator = await addWorkspaceMember(owner.workspace.id, "member");
    const bystander = await addWorkspaceMember(owner.workspace.id, "member");

    mockAuthenticatedSession(creator as User);
    const created = await call("/project", "POST", {
      name: "Made by a member",
      workspaceId: owner.workspace.id,
      icon: "Folder",
      slug: "mbm",
    });
    expect(created.status).toBe(200);
    const project = (await created.json()) as { id: string };

    const rows = await db
      .select()
      .from(schema.projectMemberTable)
      .where(eq(schema.projectMemberTable.projectId, project.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: creator.id, role: "admin" });

    // The creator's workspace role (member) cannot update projects; the
    // project admin role they got can.
    const update = await call(`/project/${project.id}`, "PUT", {
      name: "Renamed by creator",
      icon: "Folder",
      slug: "mbm",
      description: "",
      isPublic: false,
    });
    expect(update.status).toBe(200);

    mockAuthenticatedSession(bystander as User);
    const hidden = await call(`/project/${project.id}`, "GET");
    expect(hidden.status).toBe(403);
    expect(await hidden.text()).toBe(DENIED_PROJECT);
  });
});

describe("requests that touch several projects", () => {
  it("bulk update needs access to every project involved", async () => {
    const w = await buildWorld();
    const [foreignTask] = await db
      .insert(schema.taskTable)
      .values({
        projectId: w.otherProject.id,
        title: "In another project",
        status: "to-do",
        columnId: null,
        number: 1,
        position: 1,
      })
      .returning();
    // Access to `project` only.
    const partial = await addWorkspaceMember(w.workspaceId, "member");
    await addProjectMember(w.project.id, partial.id, "admin");
    mockAuthenticatedSession(partial as User);

    const both = await call("/task/bulk", "PATCH", {
      taskIds: [w.task.id, foreignTask.id],
      operation: "updatePriority",
      value: "high",
    });
    expect(both.status).toBe(403);
    expect(await both.text()).toBe(DENIED_PROJECT);
    const [unchanged] = await db
      .select({ priority: schema.taskTable.priority })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, w.task.id));
    expect(unchanged?.priority).not.toBe("high");

    const single = await call("/task/bulk", "PATCH", {
      taskIds: [w.task.id],
      operation: "updatePriority",
      value: "high",
    });
    expect(single.status).toBe(200);

    // The permission is required in every project too: a viewer of the second
    // project cannot ride on an admin role in the first.
    await addProjectMember(w.otherProject.id, partial.id, "viewer");
    const mixed = await call("/task/bulk", "PATCH", {
      taskIds: [w.task.id, foreignTask.id],
      operation: "updatePriority",
      value: "low",
    });
    expect(mixed.status).toBe(403);
    expect(await mixed.text()).toBe("Insufficient permissions");
  });

  it("moving a task needs access, and task:create, in the destination project", async () => {
    const w = await buildWorld();
    const mover = await addWorkspaceMember(w.workspaceId, "member");
    await addProjectMember(w.project.id, mover.id, "admin");
    mockAuthenticatedSession(mover as User);

    const noAccess = await call(`/task/move/${w.task.id}`, "PUT", {
      destinationProjectId: w.otherProject.id,
    });
    expect(noAccess.status).toBe(403);
    expect(await noAccess.text()).toBe(DENIED_PROJECT);

    await addProjectMember(w.otherProject.id, mover.id, "viewer");
    const readOnly = await call(`/task/move/${w.task.id}`, "PUT", {
      destinationProjectId: w.otherProject.id,
    });
    expect(readOnly.status).toBe(403);
    expect(await readOnly.text()).toBe("Insufficient permissions");

    await db
      .update(schema.projectMemberTable)
      .set({ role: "member" })
      .where(
        and(
          eq(schema.projectMemberTable.projectId, w.otherProject.id),
          eq(schema.projectMemberTable.userId, mover.id),
        ),
      );
    const moved = await call(`/task/move/${w.task.id}`, "PUT", {
      destinationProjectId: w.otherProject.id,
    });
    expect(moved.status).toBe(200);
  });

  it("linking a relation into a project needs access to that project", async () => {
    const w = await buildWorld();
    const [foreignTask] = await db
      .insert(schema.taskTable)
      .values({
        projectId: w.otherProject.id,
        title: "Elsewhere",
        status: "to-do",
        number: 1,
        position: 1,
      })
      .returning();
    const user = await addWorkspaceMember(w.workspaceId, "member");
    await addProjectMember(w.project.id, user.id, "admin");
    mockAuthenticatedSession(user as User);

    const denied = await call("/task-relation", "POST", {
      sourceTaskId: w.task.id,
      targetTaskId: foreignTask.id,
      relationType: "related",
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe(DENIED_PROJECT);

    // Read-only in the target project is not enough: the relation is written
    // into a task there.
    await addProjectMember(w.otherProject.id, user.id, "viewer");
    const readOnly = await call("/task-relation", "POST", {
      sourceTaskId: w.task.id,
      targetTaskId: foreignTask.id,
      relationType: "related",
    });
    expect(readOnly.status).toBe(403);
    expect(await readOnly.text()).toBe("Insufficient permissions");

    await db
      .update(schema.projectMemberTable)
      .set({ role: "member" })
      .where(
        and(
          eq(schema.projectMemberTable.projectId, w.otherProject.id),
          eq(schema.projectMemberTable.userId, user.id),
        ),
      );
    const allowed = await call("/task-relation", "POST", {
      sourceTaskId: w.task.id,
      targetTaskId: foreignTask.id,
      relationType: "related",
    });
    expect(allowed.status).toBe(200);
  });

  it("moving a project uses the target workspace role, never the project role", async () => {
    const source = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: source.workspace.id,
      members: "none",
    });
    const target = await createWorkspaceMember({ role: "owner" });

    // Project admin in the source project, ordinary workspace member there,
    // and only a viewer of the target workspace.
    const mover = await addWorkspaceMember(source.workspace.id, "member");
    await addProjectMember(project.id, mover.id, "admin");
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: target.workspace.id,
      userId: mover.id,
      role: "viewer",
      joinedAt: new Date(),
    });
    mockAuthenticatedSession(mover as User);

    const denied = await call(`/project/${project.id}/move`, "PUT", {
      workspaceId: target.workspace.id,
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe(
      "Insufficient permissions in the target workspace",
    );

    // Promoted in the target workspace: project:create is now held there.
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "member" })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, target.workspace.id),
          eq(schema.workspaceUserTable.userId, mover.id),
        ),
      );
    const moved = await call(`/project/${project.id}/move`, "PUT", {
      workspaceId: target.workspace.id,
    });
    expect(moved.status, await moved.clone().text()).toBe(200);
  });
});

describe("moving a project cleans its memberships", () => {
  it("drops members who are not in the target workspace or whose role does not exist there", async () => {
    const source = await createWorkspaceMember({ role: "owner" });
    const target = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: source.workspace.id,
      role: "source-only",
      permission: JSON.stringify({ task: ["read"] }),
    });
    const { project } = await createProjectFixture({
      workspaceId: source.workspace.id,
      members: "none",
    });

    const inTarget = await addWorkspaceMember(source.workspace.id, "member");
    const notInTarget = await addWorkspaceMember(source.workspace.id, "member");
    const customRoleInTarget = await addWorkspaceMember(
      source.workspace.id,
      "member",
    );
    for (const user of [inTarget, customRoleInTarget]) {
      await db.insert(schema.workspaceUserTable).values({
        workspaceId: target.workspace.id,
        userId: user.id,
        role: "member",
        joinedAt: new Date(),
      });
    }
    await addProjectMember(project.id, inTarget.id, "member");
    await addProjectMember(project.id, notInTarget.id, "member");
    await addProjectMember(project.id, customRoleInTarget.id, "source-only");

    const [invitation] = await db
      .insert(schema.invitationTable)
      .values({
        workspaceId: source.workspace.id,
        email: "pending@example.com",
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 86_400_000),
        inviterId: source.user.id,
      })
      .returning();
    await db.insert(schema.invitationProjectTable).values({
      invitationId: invitation.id,
      projectId: project.id,
      role: "member",
    });

    mockAuthenticatedSession(target.user as User);
    // The target owner also needs to reach the source project to move it:
    // make the mover a member of the source workspace as well.
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: source.workspace.id,
      userId: target.user.id,
      role: "owner",
      joinedAt: new Date(),
    });
    const moved = await call(`/project/${project.id}/move`, "PUT", {
      workspaceId: target.workspace.id,
    });
    expect(moved.status, await moved.clone().text()).toBe(200);

    const remaining = await db
      .select({ userId: schema.projectMemberTable.userId })
      .from(schema.projectMemberTable)
      .where(eq(schema.projectMemberTable.projectId, project.id));
    expect(remaining.map((row) => row.userId).sort()).toEqual([inTarget.id]);
    // Pending project invitations do not follow the project.
    expect(
      await db
        .select()
        .from(schema.invitationProjectTable)
        .where(eq(schema.invitationProjectTable.projectId, project.id)),
    ).toHaveLength(0);
  });
});

describe("workspace-level permissions come from the workspace role", () => {
  // Project role admin, workspace role viewer: the person may work in the
  // project, but holds none of the workspace-level permissions.
  async function projectAdminWithViewerRole() {
    const w = await buildWorld();
    const user = await addWorkspaceMember(w.workspaceId, "viewer");
    await addProjectMember(w.project.id, user.id, "admin");
    return { w, user };
  }

  it("does not reveal integration secrets to a project admin", async () => {
    const { w, user } = await projectAdminWithViewerRole();
    await db.insert(schema.integrationTable).values([
      {
        projectId: w.project.id,
        type: "gitea",
        config: JSON.stringify({
          baseUrl: "https://gitea.example",
          accessToken: "gitea-access-token",
          repositoryOwner: "owner",
          repositoryName: "repo",
          webhookSecret: "gitea-webhook-secret",
        }),
      },
      {
        projectId: w.project.id,
        type: "gitlab",
        config: JSON.stringify({
          baseUrl: "https://gitlab.example",
          projectPath: "group/repo",
          accessToken: "gitlab-access-token",
          webhookSecret: "gitlab-webhook-secret",
        }),
      },
    ]);
    const read = async (path: string) => {
      const response = await call(path, "GET");
      expect(response.status).toBe(200);
      return (await response.json()) as Record<string, string>;
    };
    const giteaPath = `/gitea-integration/project/${w.project.id}`;
    const gitlabPath = `/gitlab-integration/project/${w.project.id}`;

    mockAuthenticatedSession(user as User);
    expect((await read(giteaPath)).webhookSecret).toBe("");
    const gitlabRestricted = await read(gitlabPath);
    expect(gitlabRestricted.webhookSecret).toBe("");
    expect(gitlabRestricted.maskedAccessToken).toBe("");

    // Full access through the workspace role (manage_settings) sees them.
    mockAuthenticatedSession(w.fullAdmin as User);
    expect((await read(giteaPath)).webhookSecret).toBe("gitea-webhook-secret");
    expect((await read(gitlabPath)).webhookSecret).toBe(
      "gitlab-webhook-secret",
    );
  });

  it("cannot set external comment authors but can still work on tasks", async () => {
    const { w, user } = await projectAdminWithViewerRole();
    mockAuthenticatedSession(user as User);

    const external = await call(`/comment/${w.task.id}`, "POST", {
      content: "Imported as somebody else",
      externalSource: "planka",
      externalUserName: "Historical Author",
    });
    expect(external.status).toBe(403);
    const attributed = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.externalUserName, "Historical Author"));
    expect(attributed).toHaveLength(0);

    // The project admin role still carries task permissions in this project.
    expect(
      (await call(`/comment/${w.task.id}`, "POST", { content: "Plain" }))
        .status,
    ).toBe(200);
    expect(
      (await call(`/task/title/${w.task.id}`, "PUT", { title: "Renamed" }))
        .status,
    ).toBe(200);

    // A full-access user with manage_settings may attribute imports.
    mockAuthenticatedSession(w.fullAdmin as User);
    expect(
      (
        await call(`/comment/${w.task.id}`, "POST", {
          content: "Imported",
          externalSource: "planka",
          externalUserName: "Historical Author",
        })
      ).status,
    ).toBe(200);
  });

  it("does not let a project admin manage integrations of the project", async () => {
    const { w, user } = await projectAdminWithViewerRole();
    mockAuthenticatedSession(user as User);
    const response = await call(
      `/generic-webhook-integration/project/${w.project.id}`,
      "POST",
      { webhookUrl: "https://hooks.example.com/kaneo" },
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Insufficient permissions");
  });
});

describe("attaching a label names a task in the body", () => {
  it("needs access, and label:update, in that task's project", async () => {
    const w = await buildWorld();
    const [foreignTask] = await db
      .insert(schema.taskTable)
      .values({
        projectId: w.otherProject.id,
        title: "Elsewhere",
        status: "to-do",
        number: 1,
        position: 1,
      })
      .returning();
    // A workspace label: belongs to no task and no project.
    const [workspaceLabel] = await db
      .insert(schema.labelTable)
      .values({
        workspaceId: w.workspaceId,
        name: "shared",
        color: "#0000ff",
      })
      .returning();
    const user = await addWorkspaceMember(w.workspaceId, "member");
    await addProjectMember(w.project.id, user.id, "admin");
    mockAuthenticatedSession(user as User);

    const attach = (taskId: string) =>
      call(`/label/${workspaceLabel.id}/task`, "PUT", { taskId });

    const noAccess = await attach(foreignTask.id);
    expect(noAccess.status).toBe(403);
    expect(await noAccess.text()).toBe(DENIED_PROJECT);

    // A project viewer may read but not edit labels there.
    await addProjectMember(w.otherProject.id, user.id, "viewer");
    const readOnly = await attach(foreignTask.id);
    expect(readOnly.status).toBe(403);
    expect(await readOnly.text()).toBe("Insufficient permissions");

    await db
      .update(schema.projectMemberTable)
      .set({ role: "member" })
      .where(
        and(
          eq(schema.projectMemberTable.projectId, w.otherProject.id),
          eq(schema.projectMemberTable.userId, user.id),
        ),
      );
    const allowed = await attach(foreignTask.id);
    expect(allowed.status, await allowed.clone().text()).toBe(200);
  });
});

// WebSocket upgrade ---------------------------------------------------------

type Socket = NodeWebSocket["wss"]["clients"] extends Set<infer S> ? S : never;
const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const nodeWsRequire = createRequire(apiRequire.resolve("@hono/node-ws"));
const WebSocket: new (
  url: string,
  options: { headers: Record<string, string> },
) => Socket = nodeWsRequire("ws").WebSocket;

describe("project WebSocket upgrade", () => {
  let server: ReturnType<typeof serve>;
  let baseUrl: string;
  const sockets: Socket[] = [];
  const usersByCookie = new Map<string, User>();

  function sessionFor(user: User): Session {
    const now = new Date();
    return {
      id: `session-${user.id}`,
      token: `token-${user.id}`,
      userId: user.id,
      expiresAt: new Date(now.getTime() + 3_600_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    };
  }

  beforeEach(async () => {
    usersByCookie.clear();
    vi.spyOn(auth.api, "getSession").mockImplementation((async ({
      headers,
    }: {
      headers: HeadersInit;
    }) => {
      const cookie = new Headers(headers).get("cookie") ?? "";
      const user = usersByCookie.get(cookie);
      return user ? { session: sessionFor(user), user } : null;
    }) as never);
    const created = createApp();
    server = serve({
      fetch: created.app.fetch,
      hostname: "127.0.0.1",
      port: 0,
    });
    created.injectWebSocket(server);
    if (!server.listening) await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    baseUrl = `ws://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function connect(projectId: string, user: User) {
    const cookie = `uid=${user.id}`;
    usersByCookie.set(cookie, user);
    const socket = new WebSocket(`${baseUrl}/api/ws/${projectId}`, {
      headers: { cookie, origin: "http://localhost:5173" },
    });
    sockets.push(socket);
    socket.on("error", () => {});
    return new Promise<number>((resolve) => {
      socket.once("open", () => resolve(101));
      socket.once(
        "unexpected-response",
        (_request: unknown, response: IncomingMessage) => {
          response.resume();
          resolve(response.statusCode ?? 0);
          socket.terminate();
        },
      );
    });
  }

  it("upgrades for a member and a full-access user, refuses everyone else", async () => {
    const w = await buildWorld();
    expect(await connect(w.project.id, w.member as User)).toBe(101);
    expect(await connect(w.project.id, w.fullAdmin as User)).toBe(101);
    expect(await connect(w.project.id, w.workspaceOnly as User)).toBe(403);
    expect(await connect(w.project.id, w.outsider.user as User)).toBe(403);
  });
});
