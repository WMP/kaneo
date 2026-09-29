import type { User } from "better-auth/types";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import createNotification from "../../apps/api/src/notification/controllers/create-notification";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Lists, search, workload, activity, labels, relations, counts, members and
// notifications must not return anything from a project the caller is not a
// member of (stage 2b of docs/plans/project-membership.md). Every test builds
// one workspace with two projects: U belongs to P1 only, the full-access admin
// A sees both, and a user of another workspace is refused.

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => undefined),
}));
vi.mock("@kaneo/email", async (original) => ({
  ...(await original<object>()),
  sendNotificationEmail: sendEmail,
}));
vi.mock("../../apps/api/src/events", async (original) => ({
  ...(await original<object>()),
  publishEvent: vi.fn(async () => undefined),
}));

const { app } = createApp();

const DAY = "2026-10-05T00:00:00.000Z";

async function buildWorld() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const workspaceId = owner.workspace.id;
  const p1 = await createProjectFixture({
    workspaceId,
    members: "none",
    name: "Visible project",
    slug: "vis",
  });
  const p2 = await createProjectFixture({
    workspaceId,
    members: "none",
    name: "Hidden project",
    slug: "hid",
  });

  // A custom role that may reorder projects but does not grant full access.
  await db.insert(schema.workspaceRoleTable).values({
    workspaceId,
    role: "coordinator",
    permission: JSON.stringify({
      project: ["read", "update"],
      task: ["read"],
      workspace: ["read"],
    }),
  });

  // U: workspace member, project admin of P1 only.
  const u = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(p1.project.id, u.id, "admin");
  // V: member of P2 only. W: member of both (shares P1 with U).
  const v = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(p2.project.id, v.id, "member");
  const w = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(p1.project.id, w.id, "member");
  await addProjectMember(p2.project.id, w.id, "member");
  // X: workspace member without any project.
  const x = await addWorkspaceMember(workspaceId, "member");
  // R: restricted user allowed to reorder projects, member of P1.
  const r = await addWorkspaceMember(workspaceId, "coordinator");
  await addProjectMember(p1.project.id, r.id, "member");
  // A: full access through the built-in admin role, no project rows.
  const a = await addWorkspaceMember(workspaceId, "admin");
  const outsider = await createWorkspaceMember({ role: "owner" });

  async function task(
    projectId: string,
    columnId: string,
    number: number,
    title: string,
    extra: Partial<typeof schema.taskTable.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(schema.taskTable)
      .values({
        projectId,
        columnId,
        title,
        status: "to-do",
        number,
        position: number,
        ...extra,
      })
      .returning();
    return row;
  }

  const t1 = await task(p1.project.id, p1.columns.todo.id, 1, "alpha visible", {
    startDate: new Date(DAY),
    dueDate: new Date(DAY),
  });
  const t1b = await task(p1.project.id, p1.columns.todo.id, 2, "beta visible");
  const c1 = await task(p1.project.id, p1.columns.todo.id, 3, "child visible");
  const t2 = await task(p2.project.id, p2.columns.todo.id, 1, "alpha hidden", {
    startDate: new Date(DAY),
    dueDate: new Date(DAY),
  });
  const c2 = await task(p2.project.id, p2.columns.todo.id, 2, "child hidden");
  await db
    .update(schema.projectTable)
    .set({ lastTaskNumber: 3 })
    .where(eq(schema.projectTable.id, p1.project.id));
  await db
    .update(schema.projectTable)
    .set({ lastTaskNumber: 2 })
    .where(eq(schema.projectTable.id, p2.project.id));

  // Relations: t1 blocks t2 (across projects), t1 related t1b, t1 has a
  // subtask in each project.
  const relate = async (
    sourceTaskId: string,
    targetTaskId: string,
    relationType: string,
  ) =>
    (
      await db
        .insert(schema.taskRelationTable)
        .values({ sourceTaskId, targetTaskId, relationType })
        .returning()
    )[0];
  const blocksAcross = await relate(t1.id, t2.id, "blocks");
  const relatedSame = await relate(t1.id, t1b.id, "related");
  await relate(t1.id, c1.id, "subtask");
  await relate(t1.id, c2.id, "subtask");

  // Activity rows (comments) that both match the search term "needle".
  const [comment1] = await db
    .insert(schema.activityTable)
    .values({
      taskId: t1.id,
      type: "comment",
      userId: owner.user.id,
      content: "needle in the visible project",
    })
    .returning();
  const [comment2] = await db
    .insert(schema.activityTable)
    .values({
      taskId: t2.id,
      type: "comment",
      userId: owner.user.id,
      content: "needle in the hidden project",
    })
    .returning();
  // Workspace-level activity (no task): not tied to any project.
  await db.insert(schema.activityTable).values({
    workspaceId,
    type: "calendar_updated",
    userId: owner.user.id,
    content: "workspace calendar changed",
  });

  // Labels: a workspace label definition and one attached to a task per project.
  const [wsLabel] = await db
    .insert(schema.labelTable)
    .values({ workspaceId, name: "ws-label", color: "#111111" })
    .returning();
  const [labelP1] = await db
    .insert(schema.labelTable)
    .values({ workspaceId, taskId: t1.id, name: "on-p1", color: "#222222" })
    .returning();
  const [labelP2] = await db
    .insert(schema.labelTable)
    .values({ workspaceId, taskId: t2.id, name: "on-p2", color: "#333333" })
    .returning();

  // Notifications for U about a task in each project, plus a general one.
  const notify = async (
    userId: string,
    resourceId: string | null,
    resourceType: string | null,
  ) =>
    (
      await db
        .insert(schema.notificationTable)
        .values({
          userId,
          title: `about ${resourceId ?? "nothing"}`,
          type: "info",
          resourceId,
          resourceType,
        })
        .returning()
    )[0];
  const nP1 = await notify(u.id, t1.id, "task");
  const nP2 = await notify(u.id, t2.id, "task");
  const nGeneral = await notify(u.id, null, null);

  return {
    owner,
    workspaceId,
    p1,
    p2,
    u,
    v,
    w,
    x,
    r,
    a,
    outsider,
    t1,
    t1b,
    c1,
    t2,
    c2,
    blocksAcross,
    relatedSame,
    comment1,
    comment2,
    wsLabel,
    labelP1,
    labelP2,
    nP1,
    nP2,
    nGeneral,
  };
}

type World = Awaited<ReturnType<typeof buildWorld>>;

function call(path: string, method = "GET", body?: unknown) {
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

async function json<T = any>(response: Response): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as T;
}

function actAs(user: unknown) {
  mockAuthenticatedSession(user as User);
}

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
});

describe("project list and reorder", () => {
  it("lists only the caller's projects, with only their statistics", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const own = await json<Array<any>>(
      await call(`/project?workspaceId=${w.workspaceId}`),
    );
    expect(own.map((p) => p.id)).toEqual([w.p1.project.id]);
    expect(own[0].statistics.totalTasks).toBe(3);

    actAs(w.a);
    const all = await json<Array<any>>(
      await call(`/project?workspaceId=${w.workspaceId}`),
    );
    expect(all.map((p) => p.id).sort()).toEqual(
      [w.p1.project.id, w.p2.project.id].sort(),
    );
    expect(
      all.find((p) => p.id === w.p2.project.id).statistics.totalTasks,
    ).toBe(2);
  });

  it("a member of no project gets an empty list, not the whole workspace", async () => {
    const w = await buildWorld();
    actAs(w.x);
    expect(
      await json(await call(`/project?workspaceId=${w.workspaceId}`)),
    ).toEqual([]);
  });

  it("refuses a user of another workspace", async () => {
    const w = await buildWorld();
    actAs(w.outsider.user);
    expect((await call(`/project?workspaceId=${w.workspaceId}`)).status).toBe(
      403,
    );
    expect(
      (await call(`/project/portfolio?workspaceId=${w.workspaceId}`)).status,
    ).toBe(403);
  });

  it("reorder rejects an inaccessible id like an unknown one and lists only visible projects", async () => {
    const w = await buildWorld();
    actAs(w.r);
    const denied = await call(
      `/project/reorder?workspaceId=${w.workspaceId}`,
      "PUT",
      {
        projects: [
          { id: w.p1.project.id, position: 1 },
          { id: w.p2.project.id, position: 0 },
        ],
      },
    );
    expect(denied.status).toBe(400);
    const unknown = await call(
      `/project/reorder?workspaceId=${w.workspaceId}`,
      "PUT",
      {
        projects: [
          { id: w.p1.project.id, position: 1 },
          { id: "no-such-project", position: 0 },
        ],
      },
    );
    expect(unknown.status).toBe(400);
    // Same shape of answer for both: the payload cannot probe for projects.
    expect((await denied.text()).replace(w.p2.project.id, "X")).toBe(
      (await unknown.text()).replace("no-such-project", "X"),
    );

    const ok = await json<Array<any>>(
      await call(`/project/reorder?workspaceId=${w.workspaceId}`, "PUT", {
        projects: [{ id: w.p1.project.id, position: 0 }],
      }),
    );
    expect(ok.map((p) => p.id)).toEqual([w.p1.project.id]);

    actAs(w.a);
    const full = await json<Array<any>>(
      await call(`/project/reorder?workspaceId=${w.workspaceId}`, "PUT", {
        projects: [
          { id: w.p2.project.id, position: 0 },
          { id: w.p1.project.id, position: 1 },
        ],
      }),
    );
    expect(full).toHaveLength(2);
  });
});

describe("portfolio", () => {
  it("drops projects, tasks and cross-project dependencies the caller cannot reach", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const own = await json<any>(
      await call(`/project/portfolio?workspaceId=${w.workspaceId}`),
    );
    expect(own.projects.map((p: any) => p.id)).toEqual([w.p1.project.id]);
    expect(own.projects[0].tasks.map((t: any) => t.id).sort()).toEqual(
      [w.t1.id, w.t1b.id, w.c1.id].sort(),
    );
    expect(own.dependencies).toEqual([]);
    expect(JSON.stringify(own)).not.toContain(w.t2.id);

    actAs(w.w);
    const both = await json<any>(
      await call(`/project/portfolio?workspaceId=${w.workspaceId}`),
    );
    expect(both.dependencies).toHaveLength(1);

    actAs(w.a);
    const all = await json<any>(
      await call(`/project/portfolio?workspaceId=${w.workspaceId}`),
    );
    expect(all.projects).toHaveLength(2);
    expect(all.dependencies).toHaveLength(1);
    expect(all.dependencies[0]).toMatchObject({
      sourceTaskId: w.t1.id,
      targetTaskId: w.t2.id,
    });
  });
});

describe("search", () => {
  const search = (w: World, q: string, extra = "") =>
    call(`/search?workspaceId=${w.workspaceId}&q=${q}${extra}`);

  it("returns hits of the caller's projects only, for every result type", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const own = await json<{ results: any[] }>(await search(w, "hidden"));
    expect(own.results).toEqual([]);

    const visible = await json<{ results: any[] }>(
      await search(w, "visible", "&limit=50"),
    );
    expect(visible.results.length).toBeGreaterThan(0);
    for (const result of visible.results) {
      expect(result.projectId ?? w.p1.project.id).toBe(w.p1.project.id);
    }

    const needle = await json<{ results: any[] }>(
      await search(w, "needle", "&limit=50"),
    );
    expect(needle.results.map((r) => r.id)).toEqual([w.comment1.id]);

    // Projects by name and tasks by short id.
    const byProjectName = await json<{ results: any[] }>(
      await search(w, "project", "&type=projects"),
    );
    expect(byProjectName.results.map((r) => r.id)).toEqual([w.p1.project.id]);
    const shortId = await json<{ results: any[] }>(
      await search(w, "hid-1", "&type=tasks"),
    );
    expect(shortId.results).toEqual([]);
  });

  it("projectId and excludeProjectId cannot reach an inaccessible project", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const scoped = await json<{ results: any[] }>(
      await search(w, "alpha", `&projectId=${w.p2.project.id}`),
    );
    expect(scoped.results).toEqual([]);
    const excluded = await json<{ results: any[] }>(
      await search(w, "alpha", `&excludeProjectId=${w.p1.project.id}`),
    );
    expect(excluded.results).toEqual([]);
  });

  it("a full-access caller finds both projects", async () => {
    const w = await buildWorld();
    actAs(w.a);
    const needle = await json<{ results: any[] }>(
      await search(w, "needle", "&limit=50"),
    );
    expect(needle.results.map((r) => r.id).sort()).toEqual(
      [w.comment1.id, w.comment2.id].sort(),
    );
    const tasks = await json<{ results: any[] }>(
      await search(w, "alpha", "&type=tasks"),
    );
    expect(tasks.results.map((r) => r.id).sort()).toEqual(
      [w.t1.id, w.t2.id].sort(),
    );
  });

  it("refuses a user of another workspace", async () => {
    const w = await buildWorld();
    actAs(w.outsider.user);
    expect((await search(w, "alpha")).status).toBe(403);
  });
});

describe("workload", () => {
  const range = "from=2026-10-01&to=2026-10-31";
  const total = (body: any) =>
    body.assignees.reduce(
      (sum: number, row: any) =>
        sum + row.counts.reduce((a: number, b: number) => a + b, 0),
      0,
    );

  it("counts and lists only tasks of the caller's projects", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const own = await json<any>(
      await call(`/workload/${w.workspaceId}?${range}`),
    );
    expect(total(own)).toBe(1);
    const tasks = await json<any>(
      await call(
        `/workload/${w.workspaceId}/tasks?${range}&assigneeId=unassigned`,
      ),
    );
    expect(tasks.tasks.map((t: any) => t.id)).toEqual([w.t1.id]);

    // `projectId` can only narrow the set.
    const forced = await json<any>(
      await call(
        `/workload/${w.workspaceId}/tasks?${range}&assigneeId=unassigned&projectId=${w.p2.project.id}`,
      ),
    );
    expect(forced.tasks).toEqual([]);
    const forcedAggregate = await json<any>(
      await call(
        `/workload/${w.workspaceId}?${range}&projectId=${w.p2.project.id}`,
      ),
    );
    expect(total(forcedAggregate)).toBe(0);

    actAs(w.a);
    const all = await json<any>(
      await call(`/workload/${w.workspaceId}?${range}`),
    );
    expect(total(all)).toBe(2);
    const allTasks = await json<any>(
      await call(
        `/workload/${w.workspaceId}/tasks?${range}&assigneeId=unassigned`,
      ),
    );
    expect(allTasks.tasks.map((t: any) => t.id).sort()).toEqual(
      [w.t1.id, w.t2.id].sort(),
    );
  });

  it("lists only the members the caller may see as assignee rows", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const own = await json<any>(
      await call(`/workload/${w.workspaceId}?${range}`),
    );
    const ids = own.assignees.map((row: any) => row.userId);
    expect(ids).toContain(w.u.id);
    expect(ids).toContain(w.w.id);
    expect(ids).not.toContain(w.v.id);
    expect(ids).not.toContain(w.x.id);
  });

  it("refuses a user of another workspace", async () => {
    const w = await buildWorld();
    actAs(w.outsider.user);
    expect((await call(`/workload/${w.workspaceId}?${range}`)).status).toBe(
      403,
    );
  });
});

describe("workspace activity and export", () => {
  it("returns task activity of the caller's projects plus workspace-level activity", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const own = await json<any>(
      await call(`/workspace/${w.workspaceId}/activity?limit=100`),
    );
    expect(own.data.map((row: any) => row.id)).toContain(w.comment1.id);
    expect(own.data.map((row: any) => row.id)).not.toContain(w.comment2.id);
    expect(own.data.some((row: any) => row.taskId === null)).toBe(true);
    expect(own.data.every((row: any) => row.taskId !== w.t2.id)).toBe(true);
    // The count does not include the hidden rows either.
    actAs(w.a);
    const all = await json<any>(
      await call(`/workspace/${w.workspaceId}/activity?limit=100`),
    );
    expect(all.pagination.total).toBe(own.pagination.total + 1);
    expect(all.data.map((row: any) => row.id)).toContain(w.comment2.id);
  });

  it("a projectId filter cannot reach an inaccessible project", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const forced = await json<any>(
      await call(
        `/workspace/${w.workspaceId}/activity?projectId=${w.p2.project.id}`,
      ),
    );
    expect(forced.data).toEqual([]);
    expect(forced.pagination.total).toBe(0);
  });

  it("the export applies the same scope", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const own = await json<any>(
      await call(`/workspace/${w.workspaceId}/activity/export?format=json`),
    );
    expect(own.data.map((row: any) => row.id)).toContain(w.comment1.id);
    expect(own.data.map((row: any) => row.id)).not.toContain(w.comment2.id);
    const csv = await (
      await call(`/workspace/${w.workspaceId}/activity/export?format=csv`)
    ).text();
    expect(csv).toContain("needle in the visible project");
    expect(csv).not.toContain("needle in the hidden project");

    actAs(w.a);
    const all = await json<any>(
      await call(`/workspace/${w.workspaceId}/activity/export?format=json`),
    );
    expect(all.data.map((row: any) => row.id)).toContain(w.comment2.id);
  });

  it("refuses a user of another workspace", async () => {
    const w = await buildWorld();
    actAs(w.outsider.user);
    expect((await call(`/workspace/${w.workspaceId}/activity`)).status).toBe(
      403,
    );
  });
});

describe("workspace labels", () => {
  it("excludes labels attached to tasks of inaccessible projects", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const own = await json<Array<any>>(
      await call(`/label/workspace/${w.workspaceId}`),
    );
    expect(own.map((label) => label.id).sort()).toEqual(
      [w.wsLabel.id, w.labelP1.id].sort(),
    );

    actAs(w.a);
    const all = await json<Array<any>>(
      await call(`/label/workspace/${w.workspaceId}`),
    );
    expect(all.map((label) => label.id).sort()).toEqual(
      [w.wsLabel.id, w.labelP1.id, w.labelP2.id].sort(),
    );
  });

  it("refuses a user of another workspace", async () => {
    const w = await buildWorld();
    actAs(w.outsider.user);
    expect((await call(`/label/workspace/${w.workspaceId}`)).status).toBe(403);
  });
});

describe("task relations", () => {
  it("drops a relation whose other task is in an inaccessible project", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const byTask = await json<Array<any>>(
      await call(`/task-relation/${w.t1.id}`),
    );
    expect(byTask.map((rel) => rel.id).sort()).toEqual(
      byTask
        .filter((rel) => rel.id !== w.blocksAcross.id)
        .map((rel) => rel.id)
        .sort(),
    );
    expect(byTask.map((rel) => rel.id)).toContain(w.relatedSame.id);
    expect(JSON.stringify(byTask)).not.toContain(w.t2.id);
    expect(JSON.stringify(byTask)).not.toContain(w.c2.id);

    const byProject = await json<Array<any>>(
      await call(`/task-relation/project/${w.p1.project.id}`),
    );
    expect(byProject.map((rel) => rel.id)).not.toContain(w.blocksAcross.id);
    expect(byProject.map((rel) => rel.id)).toContain(w.relatedSame.id);
    expect(JSON.stringify(byProject)).not.toContain(w.t2.id);
    expect(JSON.stringify(byProject)).not.toContain("Hidden project");

    // A caller who can open both projects still sees the link.
    actAs(w.w);
    const both = await json<Array<any>>(
      await call(`/task-relation/${w.t1.id}`),
    );
    expect(both.map((rel) => rel.id)).toContain(w.blocksAcross.id);

    actAs(w.a);
    const all = await json<Array<any>>(await call(`/task-relation/${w.t1.id}`));
    expect(all.map((rel) => rel.id)).toContain(w.blocksAcross.id);
  });

  it("the project task export drops the relation too", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const exported = await json<any>(
      await call(`/task/export/${w.p1.project.id}`),
    );
    expect(JSON.stringify(exported)).not.toContain(w.t2.id);
    actAs(w.a);
    const full = await json<any>(await call(`/task/export/${w.p1.project.id}`));
    expect(JSON.stringify(full)).toContain(w.t2.id);
  });

  it("update and delete answer 404 for a relation whose target is hidden", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const update = await call(`/task-relation/${w.blocksAcross.id}`, "PATCH", {
      lagDays: 3,
    });
    expect(update.status).toBe(404);
    const remove = await call(`/task-relation/${w.blocksAcross.id}`, "DELETE");
    expect(remove.status).toBe(404);
    const [still] = await db
      .select()
      .from(schema.taskRelationTable)
      .where(eq(schema.taskRelationTable.id, w.blocksAcross.id));
    expect(still).toBeTruthy();
    // Visible relations are still editable.
    expect(
      (await call(`/task-relation/${w.relatedSame.id}`, "DELETE")).status,
    ).toBe(200);
  });

  it("refuses a user of another workspace", async () => {
    const w = await buildWorld();
    actAs(w.outsider.user);
    expect((await call(`/task-relation/${w.t1.id}`)).status).toBe(403);
    expect(
      (await call(`/task-relation/project/${w.p1.project.id}`)).status,
    ).toBe(403);
  });
});

describe("subtask counts", () => {
  const countsOf = (body: any, taskId: string) => {
    const board = body.data ?? body;
    return [
      ...board.columns.flatMap((column: any) => column.tasks),
      ...board.plannedTasks,
      ...board.archivedTasks,
    ].find((task: any) => task.id === taskId)?.subtaskCounts;
  };

  it("counts only children in projects the caller can open", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const own = await json<any>(await call(`/task/tasks/${w.p1.project.id}`));
    expect(countsOf(own, w.t1.id)).toEqual({ completed: 0, total: 1 });

    actAs(w.w);
    const both = await json<any>(await call(`/task/tasks/${w.p1.project.id}`));
    expect(countsOf(both, w.t1.id)).toEqual({ completed: 0, total: 2 });

    actAs(w.a);
    const all = await json<any>(await call(`/task/tasks/${w.p1.project.id}`));
    expect(countsOf(all, w.t1.id)).toEqual({ completed: 0, total: 2 });
  });

  it("a public board still counts only public children", async () => {
    const w = await buildWorld();
    await db
      .update(schema.projectTable)
      .set({ isPublic: true })
      .where(eq(schema.projectTable.id, w.p1.project.id));
    mockAnonymousSession();
    const body = await json<any>(
      await call(`/public-project/${w.p1.project.id}`),
    );
    // P2 is not public, so its child is not counted.
    expect(countsOf(body, w.t1.id)).toEqual({ completed: 0, total: 1 });
  });
});

describe("workspace member list", () => {
  it("shows a restricted caller only themselves, full-access members and people sharing a project", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const own = await json<Array<any>>(
      await call(`/workspace/${w.workspaceId}/members`),
    );
    const ids = own.map((member) => member.id).sort();
    expect(ids).toEqual(
      [w.u.id, w.w.id, w.r.id, w.owner.user.id, w.a.id].sort(),
    );
    expect(ids).not.toContain(w.v.id);
    expect(ids).not.toContain(w.x.id);
    // No internal field leaks.
    expect(own[0]).not.toHaveProperty("instanceRole");
  });

  it("a member of no project sees only themselves and full-access members", async () => {
    const w = await buildWorld();
    actAs(w.x);
    const ids = (
      await json<Array<any>>(await call(`/workspace/${w.workspaceId}/members`))
    )
      .map((member) => member.id)
      .sort();
    expect(ids).toEqual([w.x.id, w.owner.user.id, w.a.id].sort());
  });

  it("a full-access caller sees everyone", async () => {
    const w = await buildWorld();
    actAs(w.a);
    const ids = (
      await json<Array<any>>(await call(`/workspace/${w.workspaceId}/members`))
    ).map((member) => member.id);
    for (const user of [w.u, w.v, w.w, w.x, w.r, w.a]) {
      expect(ids).toContain(user.id);
    }
    expect(ids).toContain(w.owner.user.id);
  });

  it("refuses a user of another workspace", async () => {
    const w = await buildWorld();
    actAs(w.outsider.user);
    expect((await call(`/workspace/${w.workspaceId}/members`)).status).toBe(
      403,
    );
  });
});

describe("notifications", () => {
  it("lists and marks only notifications about tasks in accessible projects", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const listed = await json<Array<any>>(await call("/notification"));
    expect(listed.map((n) => n.id).sort()).toEqual(
      [w.nP1.id, w.nGeneral.id].sort(),
    );
    expect(JSON.stringify(listed)).not.toContain(w.t2.id);
    expect((await call(`/notification/${w.nP2.id}/read`, "PATCH")).status).toBe(
      404,
    );
    expect((await call(`/notification/${w.nP1.id}/read`, "PATCH")).status).toBe(
      200,
    );
  });

  it("a notification reappears when access is granted again", async () => {
    const w = await buildWorld();
    await addProjectMember(w.p2.project.id, w.u.id, "viewer");
    actAs(w.u);
    const listed = await json<Array<any>>(await call("/notification"));
    expect(listed.map((n) => n.id)).toContain(w.nP2.id);
  });

  it("a full-access user is notified about every project", async () => {
    const w = await buildWorld();
    const created = await createNotification({
      userId: w.a.id,
      resourceId: w.t2.id,
      resourceType: "task",
      type: "task_comment",
    });
    expect(created).not.toBeNull();
  });

  it("does not create a notification for a user without access to the task's project", async () => {
    const w = await buildWorld();
    expect(
      await createNotification({
        userId: w.u.id,
        resourceId: w.t2.id,
        resourceType: "task",
        type: "task_comment",
      }),
    ).toBeNull();
    expect(
      await createNotification({
        userId: w.u.id,
        resourceId: w.t1.id,
        resourceType: "task",
        type: "task_comment",
      }),
    ).not.toBeNull();
    const rows = await db
      .select()
      .from(schema.notificationTable)
      .where(
        and(
          eq(schema.notificationTable.userId, w.u.id),
          eq(schema.notificationTable.resourceId, w.t2.id),
        ),
      );
    // Only the historical fixture row, never a new one.
    expect(rows).toHaveLength(1);
  });

  it("mentions notify only mentioned users who can open the task", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const before = (await db.select().from(schema.notificationTable)).length;
    const response = await call("/activity/comment", "POST", {
      taskId: w.t1.id,
      comment: `hi <kaneo-mention id="${w.v.id}">v</kaneo-mention> and <kaneo-mention id="${w.w.id}">w</kaneo-mention>`,
    });
    expect(response.status).toBe(200);
    const created = (await db.select().from(schema.notificationTable)).slice(
      before,
    );
    const recipients = created.map((row) => row.userId);
    expect(recipients).toContain(w.w.id);
    expect(recipients).not.toContain(w.v.id);
  });

  it("external channels are not used for a task the user can no longer open", async () => {
    const w = await buildWorld();
    const { deliverNotification } = await vi.importActual<
      typeof import("../../apps/api/src/notification-preferences/delivery")
    >("../../apps/api/src/notification-preferences/delivery");
    await db
      .insert(schema.userNotificationPreferenceTable)
      .values({ userId: w.u.id, emailEnabled: true });
    await db.insert(schema.userNotificationWorkspaceRuleTable).values({
      userId: w.u.id,
      workspaceId: w.workspaceId,
      isActive: true,
      emailEnabled: true,
    });
    await deliverNotification(w.nP1.id);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    await deliverNotification(w.nP2.id);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    // Losing the project removes the historical one as well.
    await db
      .delete(schema.projectMemberTable)
      .where(eq(schema.projectMemberTable.userId, w.u.id));
    await deliverNotification(w.nP1.id);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("notification preferences", () => {
  it("selected projects must be accessible, and stale selections are not echoed", async () => {
    const w = await buildWorld();
    actAs(w.u);
    const rule = (projectIds: string[]) =>
      call(`/notification-preferences/workspaces/${w.workspaceId}`, "PUT", {
        isActive: true,
        emailEnabled: false,
        ntfyEnabled: false,
        gotifyEnabled: false,
        webhookEnabled: false,
        projectMode: "selected",
        selectedProjectIds: projectIds,
      });
    const denied = await rule([w.p2.project.id]);
    expect(denied.status).toBe(400);
    expect(await denied.text()).toContain("invalid");
    const mixed = await rule([w.p1.project.id, w.p2.project.id]);
    expect(mixed.status).toBe(400);
    expect((await rule([w.p1.project.id])).status).toBe(200);

    // A selection that predates a membership change is not echoed back.
    await db.insert(schema.userNotificationWorkspaceProjectTable).values(
      (
        await db
          .select({ id: schema.userNotificationWorkspaceRuleTable.id })
          .from(schema.userNotificationWorkspaceRuleTable)
          .where(eq(schema.userNotificationWorkspaceRuleTable.userId, w.u.id))
      ).map((row) => ({
        workspaceId: w.workspaceId,
        workspaceRuleId: row.id,
        projectId: w.p2.project.id,
      })),
    );
    const read = await json<any>(await call("/notification-preferences"));
    expect(read.workspaces[0].selectedProjectIds).toEqual([w.p1.project.id]);
  });
});

describe("assignees", () => {
  it("an assignee needs access to the task's project (single, list, create, import, duplicate)", async () => {
    const w = await buildWorld();
    actAs(w.u);

    const single = await call(`/task/assignee/${w.t1.id}`, "PUT", {
      userId: w.v.id,
    });
    expect(single.status).toBe(403);
    const list = await call(`/task/${w.t1.id}/assignees`, "PUT", {
      userIds: [w.w.id, w.v.id],
    });
    expect(list.status).toBe(403);
    const create = await call(`/task/${w.p1.project.id}`, "POST", {
      title: "for V",
      description: "",
      priority: "low",
      status: "to-do",
      userId: w.v.id,
    });
    expect(create.status).toBe(403);
    const imported = await json<any>(
      await call(`/task/import/${w.p1.project.id}`, "POST", {
        tasks: [
          { title: "ok", status: "to-do", userId: w.w.id },
          { title: "not ok", status: "to-do", userId: w.v.id },
        ],
      }),
    );
    expect(imported.results.successful).toBe(1);
    expect(imported.results.failed).toBe(1);

    // A user with access can be assigned.
    expect(
      (
        await call(`/task/assignee/${w.t1.id}`, "PUT", {
          userId: w.w.id,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`/task/${w.t1.id}/assignees`, "PUT", {
          userIds: [w.w.id, w.u.id],
        })
      ).status,
    ).toBe(200);
  });

  it("assigning a user to a task of a project they cannot open fails", async () => {
    const w = await buildWorld();
    actAs(w.a);
    // U is not a member of P2.
    expect(
      (await call(`/task/assignee/${w.t2.id}`, "PUT", { userId: w.u.id }))
        .status,
    ).toBe(403);
    expect(
      (await call(`/task/${w.t2.id}/assignees`, "PUT", { userIds: [w.u.id] }))
        .status,
    ).toBe(403);
    // Full-access members and project members can be.
    expect(
      (await call(`/task/assignee/${w.t2.id}`, "PUT", { userId: w.v.id }))
        .status,
    ).toBe(200);
    expect(
      (await call(`/task/assignee/${w.t2.id}`, "PUT", { userId: w.a.id }))
        .status,
    ).toBe(200);
    expect(
      (
        await call(`/task/assignee/${w.t2.id}`, "PUT", {
          userId: w.owner.user.id,
        })
      ).status,
    ).toBe(200);
  });

  it("a current assignee who lost project access does not block unrelated edits", async () => {
    const w = await buildWorld();
    await db
      .update(schema.taskTable)
      .set({ userId: w.v.id })
      .where(eq(schema.taskTable.id, w.t2.id));
    await db.insert(schema.taskAssignmentTable).values({
      taskId: w.t2.id,
      userId: w.v.id,
    });
    await db
      .delete(schema.projectMemberTable)
      .where(eq(schema.projectMemberTable.userId, w.v.id));
    actAs(w.a);
    // Re-sending the same assignee list is not a new assignment.
    expect(
      (await call(`/task/${w.t2.id}/assignees`, "PUT", { userIds: [w.v.id] }))
        .status,
    ).toBe(200);
    // Nor is re-sending the current primary assignee with another edit.
    expect(
      (
        await call(`/task/${w.t2.id}`, "PUT", {
          title: "alpha hidden, renamed",
          description: "",
          priority: "low",
          status: "to-do",
          position: 0,
          projectId: w.p2.project.id,
          userId: w.v.id,
        })
      ).status,
    ).toBe(200);
    // But a NEW assignment of somebody without access is still refused.
    expect(
      (await call(`/task/assignee/${w.t2.id}`, "PUT", { userId: w.x.id }))
        .status,
    ).toBe(403);
  });

  it("a user from another workspace can never be assigned", async () => {
    const w = await buildWorld();
    actAs(w.a);
    expect(
      (
        await call(`/task/assignee/${w.t1.id}`, "PUT", {
          userId: w.outsider.user.id,
        })
      ).status,
    ).toBe(403);
  });
});

describe("MCP tools call the filtered routes", () => {
  it("list_projects, search, list_workspace_members and list_workspace_labels use the routes covered above", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../../apps/api/src/mcp/tools.ts", import.meta.url),
        "utf8",
      ),
    );
    expect(source).toContain("`/api/project?${qs.toString()}`");
    expect(source).toContain("`/api/search?${qs.toString()}`");
    expect(source).toContain("/members`");
    expect(source).toContain("`/api/label/workspace/");
  });
});

describe("search scope details", () => {
  const search = (w: World, q: string, extra = "") =>
    call(`/search?workspaceId=${w.workspaceId}&q=${q}${extra}`);

  it("returns workspace results to a caller who has no project scope at all", async () => {
    const w = await buildWorld();
    actAs(w.x);
    const all = await json<{ results: any[] }>(
      await search(w, "Integration", "&limit=50"),
    );
    // (The workspace query joins members, so the same workspace can repeat.)
    expect(new Set(all.results.map((r) => r.type))).toEqual(
      new Set(["workspace"]),
    );
    expect(new Set(all.results.map((r) => r.id))).toEqual(
      new Set([w.workspaceId]),
    );
    const workspacesOnly = await json<{ results: any[] }>(
      await search(w, "Integration", "&type=workspaces"),
    );
    expect(new Set(workspacesOnly.results.map((r) => r.id))).toEqual(
      new Set([w.workspaceId]),
    );
    // Project-scoped types stay empty for them.
    expect(
      (await json<{ results: any[] }>(await search(w, "alpha", "&type=tasks")))
        .results,
    ).toEqual([]);
  });

  it("an instance administrator who is not a workspace member searches everything", async () => {
    const w = await buildWorld();
    const [instanceAdmin] = await db
      .insert(schema.userTable)
      .values({
        id: "instance-admin",
        email: "instance-admin@example.com",
        emailVerified: true,
        name: "Instance admin",
        role: "admin",
      })
      .returning();
    actAs(instanceAdmin);
    const tasks = await json<{ results: any[] }>(
      await search(w, "alpha", "&type=tasks"),
    );
    expect(tasks.results.map((r) => r.id).sort()).toEqual(
      [w.t1.id, w.t2.id].sort(),
    );
    const projects = await json<{ results: any[] }>(
      await search(w, "project", "&type=projects"),
    );
    expect(projects.results).toHaveLength(2);
  });
});

describe("member list for member managers", () => {
  it("a caller whose workspace role can manage members sees everyone", async () => {
    const w = await buildWorld();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: w.workspaceId,
      role: "people-manager",
      permission: JSON.stringify({
        member: ["update"],
        project: ["read"],
        task: ["read"],
        workspace: ["read"],
      }),
    });
    const manager = await addWorkspaceMember(w.workspaceId, "people-manager");
    await addProjectMember(w.p1.project.id, manager.id, "member");
    actAs(manager);
    const ids = (
      await json<Array<any>>(await call(`/workspace/${w.workspaceId}/members`))
    ).map((member) => member.id);
    for (const user of [w.u, w.v, w.w, w.x, w.r, w.a]) {
      expect(ids).toContain(user.id);
    }
  });

  it("a role without any member permission does not", async () => {
    const w = await buildWorld();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: w.workspaceId,
      role: "reader",
      permission: JSON.stringify({ member: ["read"], project: ["read"] }),
    });
    const reader = await addWorkspaceMember(w.workspaceId, "reader");
    await addProjectMember(w.p1.project.id, reader.id, "member");
    actAs(reader);
    const ids = (
      await json<Array<any>>(await call(`/workspace/${w.workspaceId}/members`))
    ).map((member) => member.id);
    expect(ids).not.toContain(w.v.id);
    expect(ids).not.toContain(w.x.id);
  });
});

describe("notification list scope", () => {
  it("a full-access user lists notifications about every project", async () => {
    const w = await buildWorld();
    const [forAdmin] = await db
      .insert(schema.notificationTable)
      .values({
        userId: w.a.id,
        title: "hidden-project notification",
        resourceId: w.t2.id,
        resourceType: "task",
      })
      .returning();
    actAs(w.a);
    const listed = await json<Array<any>>(await call("/notification"));
    expect(listed.map((n) => n.id)).toContain(forAdmin.id);
  });

  it("a project role that can no longer be exercised hides the notification", async () => {
    const w = await buildWorld();
    await db
      .update(schema.projectMemberTable)
      .set({ role: "deleted-role" })
      .where(eq(schema.projectMemberTable.userId, w.u.id));
    actAs(w.u);
    const listed = await json<Array<any>>(await call("/notification"));
    expect(listed.map((n) => n.id)).toEqual([w.nGeneral.id]);
  });
});
