import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  subscribeToEvent,
  waitForPendingEventHandlers,
} from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type App = ReturnType<typeof createApp>["app"];
// biome-ignore lint/suspicious/noExplicitAny: parsed JSON bodies are inspected loosely
type Json = Record<string, any>;

// Events the tests look at. Handlers cannot be removed from the bus, so they are
// registered once and the list is cleared before every test.
const published: { type: string; data: Json }[] = [];
const WATCHED_EVENTS = [
  "project.updated",
  "subtask-parents.refresh",
  "task.status_changed",
  "task.updated",
  "task.created",
];

beforeAll(async () => {
  for (const type of WATCHED_EVENTS) {
    await subscribeToEvent<Json>(type, async (data) => {
      published.push({ type, data });
    });
  }
});

const jsonHeaders = { "content-type": "application/json" };

function request(app: App, method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: jsonHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("API integration: workspace columns", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    published.length = 0;
  });

  async function setup() {
    const admin = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();
    const workspaceId = admin.workspace.id;
    const base = `/api/workspace-column/${workspaceId}`;

    const call = (method: string, path: string, body?: unknown) =>
      request(app, method, `${base}${path}`, body);

    async function createColumn(name: string, extra: Json = {}) {
      const response = await call("POST", "", { name, ...extra });
      expect(response.status, await response.clone().text()).toBe(200);
      return (await response.json()) as Json;
    }

    async function listColumns() {
      const response = await call("GET", "");
      expect(response.status).toBe(200);
      return (await response.json()) as {
        enforced: boolean;
        columns: Json[];
      };
    }

    async function enforce(fallbackColumnId?: string) {
      return call("PUT", "/enforcement", { enforced: true, fallbackColumnId });
    }

    return {
      admin,
      app,
      workspaceId,
      base,
      call,
      createColumn,
      listColumns,
      enforce,
    };
  }

  async function projectColumns(projectId: string) {
    return db
      .select()
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, projectId))
      .orderBy(asc(schema.columnTable.position));
  }

  let taskNumber = 0;

  async function addTask(
    projectId: string,
    column: { id: string; slug: string } | null,
    title: string,
    position = 1,
    status?: string,
  ) {
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title,
        status: status ?? column?.slug ?? "to-do",
        columnId: column?.id ?? null,
        position,
        number: ++taskNumber,
        priority: "medium",
      })
      .returning();
    return task;
  }

  async function taskRow(id: string) {
    const [row] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, id));
    return row;
  }

  async function addRule(projectId: string, columnId: string) {
    await db.insert(schema.workflowRuleTable).values({
      projectId,
      integrationType: "github",
      eventType: "pull_request_opened",
      columnId,
    });
  }

  async function flush() {
    await waitForPendingEventHandlers();
  }

  describe("reading and managing the workspace columns", () => {
    it("starts empty and not enforced", async () => {
      const { listColumns } = await setup();
      expect(await listColumns()).toEqual({ enforced: false, columns: [] });
    });

    it("creates columns at the end with a stable slug", async () => {
      const { createColumn, listColumns, workspaceId } = await setup();

      const first = await createColumn("Backlog", {
        icon: "Inbox",
        color: "#ff0000",
      });
      const second = await createColumn("In Review", { isFinal: false });
      const third = await createColumn("Done", { isFinal: true });

      expect(first).toMatchObject({
        workspaceId,
        name: "Backlog",
        slug: "backlog",
        position: 0,
        icon: "Inbox",
        color: "#ff0000",
        isFinal: false,
      });
      expect(second).toMatchObject({ slug: "in-review", position: 1 });
      expect(third).toMatchObject({ slug: "done", position: 2, isFinal: true });

      const { columns } = await listColumns();
      expect(columns.map((c) => c.slug)).toEqual([
        "backlog",
        "in-review",
        "done",
      ]);
      expect(typeof columns[0].createdAt).toBe("string");
    });

    it("refuses a duplicate slug and a reserved slug with a code", async () => {
      const { call, createColumn } = await setup();
      await createColumn("Backlog");

      const duplicate = await call("POST", "", { name: "  BACKLOG " });
      expect(duplicate.status).toBe(409);
      expect(await duplicate.json()).toMatchObject({
        code: "WORKSPACE_COLUMN_SLUG_CONFLICT",
      });

      const reserved = await call("POST", "", { name: "Planned" });
      expect(reserved.status).toBe(409);
      expect(await reserved.json()).toMatchObject({
        code: "WORKSPACE_COLUMN_RESERVED_SLUG",
      });

      const empty = await call("POST", "", { name: "!!!" });
      expect(empty.status).toBe(400);
    });

    it("updates name, icon, color and final flag but never the slug", async () => {
      const { call, createColumn } = await setup();
      const column = await createColumn("Backlog", { icon: "Inbox" });

      const response = await call("PUT", `/${column.id}`, {
        name: "Ideas",
        icon: null,
        color: "#00ff00",
        isFinal: true,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: column.id,
        name: "Ideas",
        slug: "backlog",
        icon: null,
        color: "#00ff00",
        isFinal: true,
      });

      const untouched = await call("PUT", `/${column.id}`, { color: null });
      expect((await untouched.json()).name).toBe("Ideas");
    });

    it("reorders and returns every column in the new order", async () => {
      const { call, createColumn } = await setup();
      const a = await createColumn("A");
      const b = await createColumn("B");
      const c = await createColumn("C");

      const response = await call("PUT", "/reorder", {
        columns: [
          { id: a.id, position: 2 },
          { id: b.id, position: 0 },
          { id: c.id, position: 1 },
        ],
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Json[];
      expect(body.map((column) => column.slug)).toEqual(["b", "c", "a"]);
    });

    it("rejects a reorder naming a column of another workspace and persists nothing", async () => {
      const { call, createColumn, listColumns } = await setup();
      const a = await createColumn("A");
      const b = await createColumn("B");

      const other = await createWorkspaceMember({ role: "admin" });
      const [foreign] = await db
        .insert(schema.workspaceColumnTable)
        .values({
          workspaceId: other.workspace.id,
          name: "Foreign",
          slug: "foreign",
        })
        .returning();

      const response = await call("PUT", "/reorder", {
        columns: [
          { id: a.id, position: 5 },
          { id: b.id, position: 4 },
          { id: foreign.id, position: 0 },
        ],
      });
      expect(response.status).toBe(404);

      const { columns } = await listColumns();
      expect(columns.map((column) => [column.slug, column.position])).toEqual([
        ["a", 0],
        ["b", 1],
      ]);
      const [untouched] = await db
        .select()
        .from(schema.workspaceColumnTable)
        .where(eq(schema.workspaceColumnTable.id, foreign.id));
      expect(untouched.position).toBe(0);
    });

    it("answers 404 for a workspace column of another workspace", async () => {
      const { call } = await setup();
      const other = await createWorkspaceMember({ role: "admin" });
      const [foreign] = await db
        .insert(schema.workspaceColumnTable)
        .values({
          workspaceId: other.workspace.id,
          name: "Foreign",
          slug: "foreign",
        })
        .returning();

      const update = await call("PUT", `/${foreign.id}`, { name: "Hijacked" });
      expect(update.status).toBe(404);
      const remove = await call("DELETE", `/${foreign.id}`);
      expect(remove.status).toBe(404);

      const [untouched] = await db
        .select()
        .from(schema.workspaceColumnTable)
        .where(eq(schema.workspaceColumnTable.id, foreign.id));
      expect(untouched.name).toBe("Foreign");
    });
  });

  describe("authorization", () => {
    async function withRole(role: string) {
      const { admin, workspaceId, createColumn } = await setup();
      const column = await createColumn("Backlog");
      const user = await addWorkspaceMember(workspaceId, role);
      mockAuthenticatedSession(user);
      const { app } = createApp();
      return {
        workspaceId,
        column,
        call: (method: string, path: string, body?: unknown) =>
          request(
            app,
            method,
            `/api/workspace-column/${workspaceId}${path}`,
            body,
          ),
        admin,
      };
    }

    it("lets every member read, including the enforced flag", async () => {
      for (const role of ["viewer", "member"]) {
        const { call, column } = await withRole(role);
        const response = await call("GET", "");
        expect(response.status, role).toBe(200);
        const body = (await response.json()) as Json;
        expect(body.enforced).toBe(false);
        expect(body.columns.map((c: Json) => c.id)).toEqual([column.id]);
      }
    });

    it("refuses members without project:update on every management route", async () => {
      const { call, column } = await withRole("member");

      expect((await call("POST", "", { name: "New" })).status).toBe(403);
      expect(
        (await call("PUT", `/${column.id}`, { name: "Changed" })).status,
      ).toBe(403);
      expect(
        (
          await call("PUT", "/reorder", {
            columns: [{ id: column.id, position: 3 }],
          })
        ).status,
      ).toBe(403);
      expect((await call("DELETE", `/${column.id}`)).status).toBe(403);

      const [row] = await db
        .select()
        .from(schema.workspaceColumnTable)
        .where(eq(schema.workspaceColumnTable.id, column.id));
      expect(row).toMatchObject({ name: "Backlog", position: 0 });
    });

    it("needs workspace:manage_settings for the enforcement routes", async () => {
      const { workspaceId, createColumn } = await setup();
      await createColumn("Backlog");
      // project:update is enough to edit the columns, not to enforce them.
      await db.insert(schema.workspaceRoleTable).values({
        workspaceId,
        role: "columns-editor",
        permission: JSON.stringify({ project: ["read", "update"] }),
      });
      const editor = await addWorkspaceMember(workspaceId, "columns-editor");
      mockAuthenticatedSession(editor);
      const { app } = createApp();
      const base = `/api/workspace-column/${workspaceId}`;

      expect((await request(app, "POST", base, { name: "Doing" })).status).toBe(
        200,
      );
      expect(
        (await request(app, "GET", `${base}/enforcement-preview`)).status,
      ).toBe(403);
      expect(
        (await request(app, "PUT", `${base}/enforcement`, { enforced: true }))
          .status,
      ).toBe(403);

      const [workspace] = await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId));
      expect(workspace.enforceColumns).toBe(false);
    });

    it("refuses a user of another workspace everywhere", async () => {
      const { workspaceId, createColumn } = await setup();
      const column = await createColumn("Backlog");
      const outsider = await createWorkspaceMember({ role: "owner" });
      mockAuthenticatedSession(outsider.user);
      const { app } = createApp();
      const base = `/api/workspace-column/${workspaceId}`;

      const responses = await Promise.all([
        request(app, "GET", base),
        request(app, "POST", base, { name: "Intruder" }),
        request(app, "PUT", `${base}/${column.id}`, { name: "Intruder" }),
        request(app, "PUT", `${base}/reorder`, { columns: [] }),
        request(app, "DELETE", `${base}/${column.id}`),
        request(app, "GET", `${base}/enforcement-preview`),
        request(app, "PUT", `${base}/enforcement`, { enforced: true }),
      ]);
      expect(responses.map((r) => r.status)).toEqual([
        403, 403, 403, 403, 403, 403, 403,
      ]);

      const rows = await db
        .select()
        .from(schema.workspaceColumnTable)
        .where(eq(schema.workspaceColumnTable.workspaceId, workspaceId));
      expect(rows.map((row) => row.name)).toEqual(["Backlog"]);
    });
  });

  describe("without enforcement", () => {
    it("keeps projects untouched when workspace columns change", async () => {
      const { createColumn, call, workspaceId } = await setup();
      const { project } = await createProjectFixture({ workspaceId });
      const before = await projectColumns(project.id);

      const column = await createColumn("Backlog");
      await call("PUT", `/${column.id}`, { name: "Renamed", isFinal: true });
      await call("PUT", "/reorder", {
        columns: [{ id: column.id, position: 7 }],
      });
      await call("DELETE", `/${column.id}`);

      expect(await projectColumns(project.id)).toEqual(before);
      await flush();
      expect(published.filter((e) => e.type === "project.updated")).toEqual([]);
    });

    it("copies the workspace columns, linked, into a new project", async () => {
      const { app, createColumn, workspaceId } = await setup();
      const backlog = await createColumn("Backlog", { icon: "Inbox" });
      const done = await createColumn("Done", {
        isFinal: true,
        color: "green",
      });

      const response = await request(app, "POST", "/api/project", {
        workspaceId,
        name: "Roadmap",
        icon: "Folder",
        slug: "roadmap",
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const project = (await response.json()) as Json;

      const columns = await projectColumns(project.id);
      expect(
        columns.map((c) => ({
          name: c.name,
          slug: c.slug,
          position: c.position,
          icon: c.icon,
          color: c.color,
          isFinal: c.isFinal,
          link: c.workspaceColumnId,
        })),
      ).toEqual([
        {
          name: "Backlog",
          slug: "backlog",
          position: 0,
          icon: "Inbox",
          color: null,
          isFinal: false,
          link: backlog.id,
        },
        {
          name: "Done",
          slug: "done",
          position: 1,
          icon: null,
          color: "green",
          isFinal: true,
          link: done.id,
        },
      ]);
    });

    it("keeps the default columns when the workspace defines none", async () => {
      const { app, workspaceId } = await setup();
      const response = await request(app, "POST", "/api/project", {
        workspaceId,
        name: "Plain",
        icon: "Folder",
        slug: "plain",
      });
      const project = (await response.json()) as Json;

      const columns = await projectColumns(project.id);
      expect(columns.map((c) => c.slug)).toEqual([
        "to-do",
        "in-progress",
        "in-review",
        "done",
      ]);
      expect(columns.every((c) => c.workspaceColumnId === null)).toBe(true);
    });

    it("lets project columns be edited", async () => {
      const { app, workspaceId } = await setup();
      const { project, columns } = await createProjectFixture({ workspaceId });

      const created = await request(app, "POST", `/api/column/${project.id}`, {
        name: "Extra",
      });
      expect(created.status).toBe(200);
      const renamed = await request(
        app,
        "PUT",
        `/api/column/${columns.todo.id}`,
        {
          name: "Backlog",
        },
      );
      expect(renamed.status).toBe(200);
    });
  });

  describe("turning enforcement on", () => {
    // A project with the default columns (to-do, in-progress, in-review, done)
    // against the workspace columns Backlog, To Do, Done (final).
    async function scenario() {
      const ctx = await setup();
      const { workspaceId, createColumn } = ctx;
      const backlog = await createColumn("Backlog");
      const todo = await createColumn("To Do");
      const done = await createColumn("Done", { isFinal: true });
      const { project, columns } = await createProjectFixture({ workspaceId });
      return { ...ctx, backlog, todo, done, project, columns };
    }

    it("refuses to enable without workspace columns", async () => {
      const { call, workspaceId } = await setup();
      await createProjectFixture({ workspaceId });

      const enable = await call("PUT", "/enforcement", { enforced: true });
      expect(enable.status).toBe(400);
      expect(await enable.json()).toMatchObject({
        code: "WORKSPACE_COLUMNS_EMPTY",
      });
      const preview = await call("GET", "/enforcement-preview");
      expect(preview.status).toBe(400);
      expect(await preview.json()).toMatchObject({
        code: "WORKSPACE_COLUMNS_EMPTY",
      });

      const [workspace] = await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId));
      expect(workspace.enforceColumns).toBe(false);
    });

    it("previews per project without writing anything", async () => {
      const { call, project, columns, backlog, workspaceId } = await scenario();
      await addTask(project.id, columns.todo, "a");
      await addTask(project.id, columns.todo, "b");
      await addTask(project.id, columns.inProgress, "c");
      await addTask(project.id, columns.inReview, "d");
      await addTask(project.id, columns.done, "e");
      await addRule(project.id, columns.inProgress.id);
      await addRule(project.id, columns.inReview.id);
      await addRule(project.id, columns.inReview.id);
      const untouched = await createProjectFixture({ workspaceId });
      const before = await projectColumns(project.id);

      const response = await call("GET", "/enforcement-preview");
      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as Json;

      expect(body.fallbackColumnId).toBe(backlog.id);
      expect(body.projects).toHaveLength(2);
      const entry = body.projects.find((p: Json) => p.projectId === project.id);
      expect(entry).toMatchObject({
        projectName: project.name,
        changed: true,
        create: [
          { workspaceColumnId: backlog.id, name: "Backlog", slug: "backlog" },
        ],
        tasksMoved: 2,
        workflowRulesDeleted: 3,
      });
      expect(
        entry.remove.map((r: Json) => [
          r.slug,
          r.taskCount,
          r.workflowRuleCount,
        ]),
      ).toEqual([
        ["in-progress", 1, 1],
        ["in-review", 1, 2],
      ]);
      // "To Do" and "Done" match by slug and only need the link and position.
      expect(
        entry.update.map((u: Json) => [u.slug, u.newSlug, u.matchedBy]),
      ).toEqual([
        ["to-do", "to-do", "slug"],
        ["done", "done", "slug"],
      ]);
      expect(body.totals).toMatchObject({
        projects: 2,
        projectsChanged: 2,
        columnsCreated: 2,
        columnsRemoved: 4,
        tasksMoved: 2,
      });

      // Nothing was written.
      expect(await projectColumns(project.id)).toEqual(before);
      expect(
        (await projectColumns(untouched.project.id)).every(
          (c) => c.workspaceColumnId === null,
        ),
      ).toBe(true);
      const rules = await db.select().from(schema.workflowRuleTable);
      expect(rules).toHaveLength(3);
    });

    it("rejects an unknown fallback column in preview and enforcement", async () => {
      const { call, project } = await scenario();
      const before = await projectColumns(project.id);

      const preview = await call(
        "GET",
        "/enforcement-preview?fallbackColumnId=missing",
      );
      expect(preview.status).toBe(404);
      const enable = await call("PUT", "/enforcement", {
        enforced: true,
        fallbackColumnId: "missing",
      });
      expect(enable.status).toBe(404);

      expect(await projectColumns(project.id)).toEqual(before);
      await flush();
      expect(published.filter((e) => e.type === "project.updated")).toEqual([]);
    });

    it("rolls every project back when the sync fails part way", async () => {
      const { call, project, columns, workspaceId, backlog } = await scenario();
      await db
        .update(schema.projectTable)
        .set({ position: 0 })
        .where(eq(schema.projectTable.id, project.id));
      await addTask(project.id, columns.inReview, "moves fine");
      const second = await createProjectFixture({ workspaceId });
      await db
        .update(schema.projectTable)
        .set({ position: 1 })
        .where(eq(schema.projectTable.id, second.project.id));
      // The second project's column "To Do" is linked to "Backlog", so it is the
      // fallback there, and it is full: appending the moved task overflows the
      // integer position and fails after the first project was already rewritten.
      const fallbackColumn = {
        id: second.columns.todo.id,
        slug: second.columns.todo.slug,
      };
      await addTask(second.project.id, fallbackColumn, "last slot", 2147483647);
      await addTask(second.project.id, second.columns.inReview, "overflows");
      await db
        .update(schema.columnTable)
        .set({ workspaceColumnId: backlog.id })
        .where(eq(schema.columnTable.id, second.columns.todo.id));
      const firstBefore = await projectColumns(project.id);
      const secondBefore = await projectColumns(second.project.id);
      const tasksBefore = await db.select().from(schema.taskTable);

      const response = await call("PUT", "/enforcement", { enforced: true });
      expect(response.status).toBe(500);

      const [workspace] = await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId));
      expect(workspace.enforceColumns).toBe(false);
      expect(await projectColumns(project.id)).toEqual(firstBefore);
      expect(await projectColumns(second.project.id)).toEqual(secondBefore);
      expect(await db.select().from(schema.taskTable)).toEqual(tasksBefore);
      await flush();
      expect(published.filter((e) => e.type === "project.updated")).toEqual([]);
    });

    it("matches by link, slug and name, removes the rest and moves its tasks", async () => {
      const { call, project, columns, backlog, todo, done, workspaceId } =
        await scenario();
      // In Progress: stale slug, but a name that slugifies to "backlog" (name match).
      await db
        .update(schema.columnTable)
        .set({ name: "Backlog", slug: "backlog-legacy" })
        .where(eq(schema.columnTable.id, columns.inProgress.id));
      // In Review: linked to the workspace column "To Do" (link match). The
      // project column "To Do" has the same slug but loses to the link.
      await db
        .update(schema.columnTable)
        .set({ workspaceColumnId: todo.id })
        .where(eq(schema.columnTable.id, columns.inReview.id));

      const backlogTask = await addTask(
        project.id,
        { id: columns.inProgress.id, slug: "backlog-legacy" },
        "in progress task",
        3,
      );
      const linkedTask = await addTask(
        project.id,
        columns.inReview,
        "review",
        1,
      );
      const removedTask1 = await addTask(project.id, columns.todo, "todo 1", 5);
      const removedTask2 = await addTask(project.id, columns.todo, "todo 2", 2);
      const doneTask = await addTask(project.id, columns.done, "done task", 1);
      await addRule(project.id, columns.todo.id);
      await addRule(project.id, columns.inReview.id);
      await addRule(project.id, columns.done.id);
      // A task without a column (virtual status) stays as it is.
      const planned = await addTask(project.id, null, "planned", 1, "planned");

      const response = await call("PUT", "/enforcement", { enforced: true });
      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as Json;
      expect(body).toMatchObject({
        enforced: true,
        fallbackColumnId: backlog.id,
        totals: {
          projects: 1,
          projectsChanged: 1,
          columnsCreated: 0,
          columnsRemoved: 1,
          columnsUpdated: 3,
          tasksMoved: 2,
          workflowRulesDeleted: 1,
        },
      });
      expect(body.projects[0]).toMatchObject({
        projectId: project.id,
        tasksMoved: 2,
        workflowRulesDeleted: 1,
        remove: [{ columnId: columns.todo.id, slug: "to-do" }],
      });

      const after = await projectColumns(project.id);
      expect(
        after.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          position: c.position,
          isFinal: c.isFinal,
          link: c.workspaceColumnId,
        })),
      ).toEqual([
        {
          id: columns.inProgress.id,
          name: "Backlog",
          slug: "backlog",
          position: 0,
          isFinal: false,
          link: backlog.id,
        },
        {
          id: columns.inReview.id,
          name: "To Do",
          slug: "to-do",
          position: 1,
          isFinal: false,
          link: todo.id,
        },
        {
          id: columns.done.id,
          name: "Done",
          slug: "done",
          position: 2,
          isFinal: true,
          link: done.id,
        },
      ]);

      // Renamed columns keep their id; their tasks take the workspace slug.
      expect(await taskRow(backlogTask.id)).toMatchObject({
        columnId: columns.inProgress.id,
        status: "backlog",
      });
      expect(await taskRow(linkedTask.id)).toMatchObject({
        columnId: columns.inReview.id,
        status: "to-do",
      });
      // Tasks of the removed "To Do" column are appended to the fallback
      // (Backlog), in their old order, after the task already there.
      const moved1 = await taskRow(removedTask1.id);
      const moved2 = await taskRow(removedTask2.id);
      for (const moved of [moved1, moved2]) {
        expect(moved).toMatchObject({
          columnId: columns.inProgress.id,
          status: "backlog",
        });
      }
      expect(moved2.position).toBe(4);
      expect(moved1.position).toBe(5);
      expect(await taskRow(doneTask.id)).toMatchObject({
        columnId: columns.done.id,
        status: "done",
      });
      expect(await taskRow(planned.id)).toMatchObject({
        columnId: null,
        status: "planned",
      });

      // The rule of the removed column went with it; the others stay.
      const rules = await db.select().from(schema.workflowRuleTable);
      expect(rules.map((r) => r.columnId).sort()).toEqual(
        [columns.inReview.id, columns.done.id].sort(),
      );

      const [workspace] = await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId));
      expect(workspace.enforceColumns).toBe(true);
    });

    it("creates the missing columns and moves tasks to the chosen fallback", async () => {
      const { call, project, columns, done } = await scenario();
      // "Backlog" matches nothing and is created; "To Do" and "Done" match by
      // slug; "In Progress" and "In Review" are removed.
      const todoTask = await addTask(project.id, columns.todo, "todo", 1);
      const progressTask = await addTask(
        project.id,
        columns.inProgress,
        "progress",
        1,
      );
      const reviewTask = await addTask(
        project.id,
        columns.inReview,
        "review",
        2,
      );
      const doneTask = await addTask(project.id, columns.done, "done", 4);

      const response = await call("PUT", "/enforcement", {
        enforced: true,
        fallbackColumnId: done.id,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as Json;
      expect(body.fallbackColumnId).toBe(done.id);
      expect(body.totals).toMatchObject({
        columnsCreated: 1,
        columnsRemoved: 2,
        tasksMoved: 2,
      });

      const after = await projectColumns(project.id);
      expect(
        after.map((c) => [c.slug, c.position, !!c.workspaceColumnId]),
      ).toEqual([
        ["backlog", 0, true],
        ["to-do", 1, true],
        ["done", 2, true],
      ]);
      const backlogColumn = after[0];
      const finalColumn = after[2];
      expect(backlogColumn.id).not.toBe(columns.todo.id);
      expect(await taskRow(progressTask.id)).toMatchObject({
        columnId: finalColumn.id,
        status: "done",
        position: 5,
      });
      expect(await taskRow(reviewTask.id)).toMatchObject({
        columnId: finalColumn.id,
        status: "done",
        position: 6,
      });
      expect(await taskRow(doneTask.id)).toMatchObject({
        columnId: finalColumn.id,
        position: 4,
      });
      expect(await taskRow(todoTask.id)).toMatchObject({
        columnId: columns.todo.id,
        status: "to-do",
      });
    });

    it("publishes project.updated for changed projects and no per-task event", async () => {
      const { call, project, columns, workspaceId } = await scenario();
      await addTask(project.id, columns.inReview, "to be moved");
      const second = await createProjectFixture({ workspaceId });
      // Already exact: no change, no event.
      const exact = await createProjectFixture({ workspaceId });
      await db
        .delete(schema.columnTable)
        .where(eq(schema.columnTable.projectId, exact.project.id));
      const workspaceColumns = await db
        .select()
        .from(schema.workspaceColumnTable)
        .where(eq(schema.workspaceColumnTable.workspaceId, workspaceId));
      await db.insert(schema.columnTable).values(
        workspaceColumns.map((c) => ({
          projectId: exact.project.id,
          name: c.name,
          slug: c.slug,
          position: c.position,
          icon: c.icon,
          color: c.color,
          isFinal: c.isFinal,
          workspaceColumnId: c.id,
        })),
      );

      const response = await call("PUT", "/enforcement", { enforced: true });
      expect(response.status).toBe(200);
      expect(((await response.json()) as Json).totals).toMatchObject({
        projects: 3,
        projectsChanged: 2,
      });
      await flush();

      const updatedProjects = published
        .filter((e) => e.type === "project.updated")
        .map((e) => e.data.projectId)
        .sort();
      expect(updatedProjects).toEqual([project.id, second.project.id].sort());
      expect(published.some((e) => e.type === "subtask-parents.refresh")).toBe(
        true,
      );
      expect(
        published.filter((e) =>
          ["task.status_changed", "task.updated", "task.created"].includes(
            e.type,
          ),
        ),
      ).toEqual([]);
    });

    it("turning it off only clears the flag and enabling again changes nothing", async () => {
      const { call, project, workspaceId } = await scenario();
      await call("PUT", "/enforcement", { enforced: true });
      const enforced = await projectColumns(project.id);

      const off = await call("PUT", "/enforcement", { enforced: false });
      expect(off.status).toBe(200);
      expect(await off.json()).toMatchObject({
        enforced: false,
        fallbackColumnId: null,
        projects: [],
      });
      const [workspace] = await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId));
      expect(workspace.enforceColumns).toBe(false);
      expect(await projectColumns(project.id)).toEqual(enforced);

      const again = await call("PUT", "/enforcement", { enforced: true });
      expect(((await again.json()) as Json).totals).toMatchObject({
        projects: 1,
        projectsChanged: 0,
        columnsCreated: 0,
        columnsRemoved: 0,
        columnsUpdated: 0,
      });
      expect(await projectColumns(project.id)).toEqual(enforced);
    });
  });

  describe("while enforced", () => {
    async function enforced() {
      const ctx = await setup();
      const { workspaceId, createColumn } = ctx;
      const backlog = await createColumn("Backlog");
      const doing = await createColumn("Doing");
      const done = await createColumn("Done", { isFinal: true });
      const first = await createProjectFixture({ workspaceId });
      const second = await createProjectFixture({ workspaceId });
      const response = await ctx.enforce();
      expect(response.status, await response.clone().text()).toBe(200);
      published.length = 0;
      return { ...ctx, backlog, doing, done, first, second };
    }

    it("refuses project column create, update, delete and reorder with a code", async () => {
      const { app, first } = await enforced();
      const columns = await projectColumns(first.project.id);
      const before = columns;
      const target = columns[0];

      const responses = [
        await request(app, "POST", `/api/column/${first.project.id}`, {
          name: "Extra",
        }),
        await request(app, "PUT", `/api/column/${target.id}`, {
          name: "Renamed",
        }),
        await request(app, "DELETE", `/api/column/${columns[2].id}`),
        await request(app, "PUT", `/api/column/reorder/${first.project.id}`, {
          columns: [{ id: target.id, position: 9 }],
        }),
      ];
      for (const response of responses) {
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          code: "WORKSPACE_COLUMNS_ENFORCED",
        });
      }

      expect(await projectColumns(first.project.id)).toEqual(before);
      await flush();
      expect(published.filter((e) => e.type === "project.updated")).toEqual([]);
    });

    it("allows project column edits again once enforcement is off", async () => {
      const { app, call, first } = await enforced();
      await call("PUT", "/enforcement", { enforced: false });

      const response = await request(
        app,
        "POST",
        `/api/column/${first.project.id}`,
        { name: "Extra" },
      );
      expect(response.status).toBe(200);
    });

    it("propagates a created column to every project", async () => {
      const { createColumn, first, second, workspaceId } = await enforced();
      // A project created later already copies the columns.
      const created = await createColumn("Review", {
        icon: "Eye",
        color: "blue",
      });

      for (const { project } of [first, second]) {
        const columns = await projectColumns(project.id);
        expect(columns.map((c) => c.slug)).toEqual([
          "backlog",
          "doing",
          "done",
          "review",
        ]);
        expect(columns[3]).toMatchObject({
          name: "Review",
          position: 3,
          icon: "Eye",
          color: "blue",
          isFinal: false,
          workspaceColumnId: created.id,
        });
      }
      await flush();
      expect(
        published
          .filter((e) => e.type === "project.updated")
          .map((e) => e.data.projectId)
          .sort(),
      ).toEqual([first.project.id, second.project.id].sort());
      expect(workspaceId).toBeTruthy();
    });

    it("propagates updates to every linked column", async () => {
      const { call, doing, first, second } = await enforced();

      const response = await call("PUT", `/${doing.id}`, {
        name: "In Flight",
        icon: "Play",
        color: "orange",
        isFinal: true,
      });
      expect(response.status).toBe(200);

      for (const { project } of [first, second]) {
        const column = (await projectColumns(project.id)).find(
          (c) => c.workspaceColumnId === doing.id,
        );
        expect(column).toMatchObject({
          name: "In Flight",
          slug: "doing",
          icon: "Play",
          color: "orange",
          isFinal: true,
        });
      }
      await flush();
      // The final flag changed: the subtask counters of parent boards refresh.
      expect(published.some((e) => e.type === "subtask-parents.refresh")).toBe(
        true,
      );
    });

    it("propagates a reorder to every project", async () => {
      const { call, backlog, doing, done, first, second } = await enforced();

      const response = await call("PUT", "/reorder", {
        columns: [
          { id: done.id, position: 0 },
          { id: backlog.id, position: 1 },
          { id: doing.id, position: 2 },
        ],
      });
      expect(response.status).toBe(200);

      for (const { project } of [first, second]) {
        expect((await projectColumns(project.id)).map((c) => c.slug)).toEqual([
          "done",
          "backlog",
          "doing",
        ]);
      }
    });

    it("refuses to delete a column that holds tasks unless they are moved", async () => {
      const { call, doing, first, second, backlog } = await enforced();
      const firstColumns = await projectColumns(first.project.id);
      const doingColumn = firstColumns.find(
        (c) => c.workspaceColumnId === doing.id,
      );
      if (!doingColumn) throw new Error("linked column missing");
      const task = await addTask(first.project.id, doingColumn, "busy");
      await addRule(first.project.id, doingColumn.id);

      const refused = await call("DELETE", `/${doing.id}`);
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({
        code: "WORKSPACE_COLUMN_NOT_EMPTY",
      });
      expect(
        (await projectColumns(first.project.id)).map((c) => c.slug),
      ).toEqual(["backlog", "doing", "done"]);
      expect(await taskRow(task.id)).toMatchObject({
        columnId: doingColumn.id,
      });
      expect(await db.select().from(schema.workflowRuleTable)).toHaveLength(1);

      const self = await call("DELETE", `/${doing.id}?moveTasksTo=${doing.id}`);
      expect(self.status).toBe(400);
      const foreign = await call("DELETE", `/${doing.id}?moveTasksTo=missing`);
      expect(foreign.status).toBe(404);

      const moved = await call(
        "DELETE",
        `/${doing.id}?moveTasksTo=${backlog.id}`,
      );
      expect(moved.status, await moved.clone().text()).toBe(200);
      expect(await moved.json()).toMatchObject({ id: doing.id, slug: "doing" });

      for (const { project } of [first, second]) {
        expect((await projectColumns(project.id)).map((c) => c.slug)).toEqual([
          "backlog",
          "done",
        ]);
      }
      const backlogColumn = (await projectColumns(first.project.id)).find(
        (c) => c.workspaceColumnId === backlog.id,
      );
      if (!backlogColumn) throw new Error("linked column missing");
      expect(await taskRow(task.id)).toMatchObject({
        columnId: backlogColumn.id,
        status: "backlog",
      });
      // The rule on the deleted column is gone with it.
      expect(await db.select().from(schema.workflowRuleTable)).toHaveLength(0);
      await flush();
      expect(published.some((e) => e.type === "project.updated")).toBe(true);
      expect(published.some((e) => e.type === "task.status_changed")).toBe(
        false,
      );
    });

    it("deletes an empty column without moveTasksTo", async () => {
      const { call, doing, first } = await enforced();
      const response = await call("DELETE", `/${doing.id}`);
      expect(response.status).toBe(200);
      expect(
        (await projectColumns(first.project.id)).map((c) => c.slug),
      ).toEqual(["backlog", "done"]);
    });

    it("never deletes the last workspace column", async () => {
      const { call, backlog, doing, done, first } = await enforced();
      await call("DELETE", `/${doing.id}`);
      await call("DELETE", `/${done.id}`);

      const response = await call("DELETE", `/${backlog.id}`);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "WORKSPACE_COLUMN_LAST",
      });
      expect(
        (await projectColumns(first.project.id)).map((c) => c.slug),
      ).toEqual(["backlog"]);
    });

    it("gives a new project the workspace columns, linked", async () => {
      const { app, workspaceId, backlog, doing, done } = await enforced();
      const response = await request(app, "POST", "/api/project", {
        workspaceId,
        name: "Fresh",
        icon: "Folder",
        slug: "fresh",
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const project = (await response.json()) as Json;
      const columns = await projectColumns(project.id);
      expect(columns.map((c) => [c.slug, c.workspaceColumnId])).toEqual([
        ["backlog", backlog.id],
        ["doing", doing.id],
        ["done", done.id],
      ]);
      expect(columns[2].isFinal).toBe(true);
    });
  });

  describe("moving a project between workspaces", () => {
    async function twoWorkspaces() {
      const owner = await createWorkspaceMember({ role: "owner" });
      mockAuthenticatedSession(owner.user);
      const { app } = createApp();
      const [target] = await db
        .insert(schema.workspaceTable)
        .values({
          id: `workspace-${randomUUID()}`,
          createdAt: new Date(),
          name: "Target",
          slug: `workspace-${randomUUID()}`,
        })
        .returning();
      await db.insert(schema.workspaceUserTable).values({
        workspaceId: target.id,
        userId: owner.user.id,
        role: "owner",
        joinedAt: new Date(),
      });
      const targetColumn = async (name: string, isFinal = false) => {
        const response = await request(
          app,
          "POST",
          `/api/workspace-column/${target.id}`,
          { name, isFinal },
        );
        expect(response.status).toBe(200);
        return (await response.json()) as Json;
      };
      return { owner, app, target, targetColumn };
    }

    it("matches the project to an enforcing target and unlinks the source columns", async () => {
      const { owner, app, target, targetColumn } = await twoWorkspaces();
      const sourceColumn = await request(
        app,
        "POST",
        `/api/workspace-column/${owner.workspace.id}`,
        { name: "Doing" },
      ).then((r) => r.json() as Promise<Json>);
      const { project, columns } = await createProjectFixture({
        workspaceId: owner.workspace.id,
      });
      // Linked to a column of the source workspace: the link must not survive.
      await db
        .update(schema.columnTable)
        .set({ workspaceColumnId: sourceColumn.id })
        .where(eq(schema.columnTable.id, columns.inProgress.id));
      const reviewTask = await addTask(
        project.id,
        columns.inReview,
        "review",
        1,
      );
      const doneTask = await addTask(project.id, columns.done, "done", 1);
      await addRule(project.id, columns.inReview.id);

      const inbox = await targetColumn("Inbox");
      const done = await targetColumn("Done", true);
      const enable = await request(
        app,
        "PUT",
        `/api/workspace-column/${target.id}/enforcement`,
        { enforced: true },
      );
      expect(enable.status).toBe(200);

      const response = await request(
        app,
        "PUT",
        `/api/project/${project.id}/move`,
        {
          workspaceId: target.id,
        },
      );
      expect(response.status, await response.clone().text()).toBe(200);

      const after = await projectColumns(project.id);
      expect(after.map((c) => [c.slug, c.workspaceColumnId])).toEqual([
        ["inbox", inbox.id],
        ["done", done.id],
      ]);
      expect(after[1].isFinal).toBe(true);
      // Tasks of the removed columns went to the first target column.
      expect(await taskRow(reviewTask.id)).toMatchObject({
        columnId: after[0].id,
        status: "inbox",
      });
      expect(await taskRow(doneTask.id)).toMatchObject({
        columnId: after[1].id,
        status: "done",
      });
      expect(await db.select().from(schema.workflowRuleTable)).toHaveLength(0);
    });

    it("only unlinks when the target does not enforce its columns", async () => {
      const { owner, app, target, targetColumn } = await twoWorkspaces();
      await targetColumn("Inbox");
      const { project } = await createProjectFixture({
        workspaceId: owner.workspace.id,
      });
      const link = await request(
        app,
        "POST",
        `/api/workspace-column/${owner.workspace.id}`,
        { name: "Linked" },
      ).then((r) => r.json() as Promise<Json>);
      const [first] = await projectColumns(project.id);
      await db
        .update(schema.columnTable)
        .set({ workspaceColumnId: link.id })
        .where(eq(schema.columnTable.id, first.id));

      const response = await request(
        app,
        "PUT",
        `/api/project/${project.id}/move`,
        {
          workspaceId: target.id,
        },
      );
      expect(response.status).toBe(200);

      const after = await projectColumns(project.id);
      expect(after.map((c) => c.slug)).toEqual([
        "to-do",
        "in-progress",
        "in-review",
        "done",
      ]);
      expect(after.every((c) => c.workspaceColumnId === null)).toBe(true);
    });
  });

  describe("project access", () => {
    it("lists every project of the workspace for a caller with full access", async () => {
      // `manage_settings` is a full-access permission: the preview lists every
      // project of the workspace for the people who may call it.
      const { call, createColumn, workspaceId } = await setup();
      await createColumn("Backlog");
      const a = await createProjectFixture({ workspaceId, members: "none" });
      const b = await createProjectFixture({ workspaceId, members: "none" });
      const response = await call("GET", "/enforcement-preview");
      const body = (await response.json()) as Json;
      expect(body.projects.map((p: Json) => p.projectId).sort()).toEqual(
        [a.project.id, b.project.id].sort(),
      );
    });

    it("lets a project member read the flag but not manage the columns", async () => {
      const { workspaceId, createColumn } = await setup();
      await createColumn("Backlog");
      const { project } = await createProjectFixture({
        workspaceId,
        members: "none",
      });
      const user = await addWorkspaceMember(workspaceId, "member");
      await addProjectMember(project.id, user.id, "admin");
      mockAuthenticatedSession(user);
      const { app } = createApp();
      const base = `/api/workspace-column/${workspaceId}`;

      expect((await request(app, "GET", base)).status).toBe(200);
      // Workspace-level permissions come from the workspace role, never from
      // the project role.
      expect((await request(app, "POST", base, { name: "Nope" })).status).toBe(
        403,
      );
      expect(
        (await request(app, "PUT", `${base}/enforcement`, { enforced: true }))
          .status,
      ).toBe(403);
    });
  });
});
