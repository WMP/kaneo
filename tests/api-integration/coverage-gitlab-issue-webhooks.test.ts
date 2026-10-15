import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const BASE_URL = "https://203.0.113.10";
const SECRET = "issue-hook-secret-0123456789";
const ACCESS_TOKEN = "glpat-issue-hook-access-token";

type Call = { method: string; path: string; body: Record<string, unknown> };
const gitlabCalls: Call[] = [];

function stubGitlab(respond?: (call: Call) => Response | undefined) {
  gitlabCalls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const call: Call = {
        method: (init.method ?? "GET").toUpperCase(),
        path: decodeURIComponent(url.pathname + url.search).replace(
          /^\/api\/v4/,
          "",
        ),
        body: init.body ? JSON.parse(String(init.body)) : {},
      };
      gitlabCalls.push(call);
      const custom = respond?.(call);
      if (custom) return custom;
      if (call.method === "POST" && call.path.endsWith("/notes")) {
        return new Response(JSON.stringify({ id: 555, body: call.body.body }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected GitLab request ${call.method} ${call.path}`);
    }),
  );
}

async function setup(config: Record<string, unknown> = {}) {
  const member = await createWorkspaceMember({ role: "owner" });
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
    slug: "kan",
  });
  const [integration] = await db
    .insert(schema.integrationTable)
    .values({
      projectId: project.id,
      type: "gitlab",
      isActive: true,
      config: JSON.stringify({
        baseUrl: BASE_URL,
        projectPath: "group/project",
        accessToken: ACCESS_TOKEN,
        webhookSecret: SECRET,
        ...config,
      }),
    })
    .returning();
  const { app } = createApp();
  return { app, member, project, columns, integration };
}

type Env = Awaited<ReturnType<typeof setup>>;

function post(env: Env, body: unknown) {
  return env.app.request(
    `/api/gitlab-integration/webhook/${env.integration.id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gitlab-Token": SECRET,
      },
      body: JSON.stringify(body),
    },
  );
}

const project = (path = "group/project") => ({
  name: "project",
  web_url: `${BASE_URL}/${path}`,
  path_with_namespace: path,
});

const issueEvent = (
  action: string,
  attributes: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) => ({
  object_kind: "issue",
  user: { username: "ann", name: "Ann" },
  object_attributes: {
    iid: 12,
    title: "Crash on start",
    description: "It crashes",
    url: `${BASE_URL}/group/project/-/issues/12`,
    state: action === "close" ? "closed" : "opened",
    action,
    ...attributes,
  },
  labels: [],
  project: project(),
  ...extra,
});

async function tasks(env: Env) {
  return db.query.taskTable.findMany({
    where: eq(schema.taskTable.projectId, env.project.id),
    orderBy: schema.taskTable.number,
  });
}

async function addLinkedTask(
  env: Env,
  overrides: Partial<typeof schema.taskTable.$inferInsert> = {},
  metadata: unknown = { state: "opened" },
) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: env.project.id,
      title: "Local title",
      description: "Local description",
      number: 1,
      status: "to-do",
      columnId: env.columns.todo.id,
      ...overrides,
    })
    .returning();
  const [link] = await db
    .insert(schema.externalLinkTable)
    .values({
      taskId: task.id,
      integrationId: env.integration.id,
      resourceType: "issue",
      externalId: "12",
      url: `${BASE_URL}/group/project/-/issues/12`,
      title: "Local title",
      metadata:
        typeof metadata === "string" ? metadata : JSON.stringify(metadata),
    })
    .returning();
  return { task, link };
}

async function taskById(id: string) {
  const task = await db.query.taskTable.findFirst({
    where: eq(schema.taskTable.id, id),
  });
  if (!task) throw new Error("task missing");
  return task;
}

async function linkById(id: string) {
  const link = await db.query.externalLinkTable.findFirst({
    where: eq(schema.externalLinkTable.id, id),
  });
  if (!link) throw new Error("link missing");
  return link;
}

const meta = (link: { metadata: string | null }) =>
  JSON.parse(link.metadata ?? "null");

beforeEach(async () => {
  await resetTestDatabase();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  gitlabCalls.length = 0;
  vi.stubEnv("KANEO_CLIENT_URL", "https://kaneo.example");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GitLab issue opened webhook", () => {
  it("creates a task from the issue, links it and comments the task link back", async () => {
    const env = await setup();
    stubGitlab();

    const response = await post(
      env,
      issueEvent(
        "open",
        {
          description: "Steps\n\n---\n<sub>Task: old-id</sub>",
        },
        {
          labels: [
            { title: "bug" },
            { title: "priority:urgent" },
            { title: "status:in-review" },
          ],
        },
      ),
    );

    expect(response.status).toBe(200);
    const [task] = await tasks(env);
    expect(task).toMatchObject({
      number: 1,
      title: "Crash on start",
      description: "Steps",
      priority: "urgent",
      status: "in-review",
      columnId: env.columns.inReview.id,
      userId: null,
      projectId: env.project.id,
    });
    const links = await db.query.externalLinkTable.findMany({
      where: eq(schema.externalLinkTable.taskId, task.id),
    });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      resourceType: "issue",
      externalId: "12",
      title: "Crash on start",
      url: `${BASE_URL}/group/project/-/issues/12`,
    });
    expect(meta(links[0])).toEqual({
      state: "opened",
      createdFrom: "gitlab",
      author: "ann",
      syncedNoteIds: [555],
    });
    expect(gitlabCalls).toEqual([
      {
        method: "POST",
        path: "/projects/group/project/issues/12/notes",
        body: {
          body: `[KAN-1](https://kaneo.example/dashboard/workspace/${env.member.workspace.id}/project/${env.project.id}/task/${task.id})`,
        },
      },
    ]);
  });

  it("falls back to the display name for the author and to defaults for an unlabeled issue", async () => {
    const env = await setup();
    stubGitlab();

    await post(
      env,
      issueEvent("open", { description: null }, { user: { name: "Ann" } }),
    );

    const [task] = await tasks(env);
    expect(task).toMatchObject({
      description: "",
      priority: "low",
      status: "to-do",
    });
    const [link] = await db.query.externalLinkTable.findMany({
      where: eq(schema.externalLinkTable.taskId, task.id),
    });
    expect(meta(link).author).toBe("Ann");
  });

  it("uses low priority and the first column for an unknown priority and an unknown status", async () => {
    const env = await setup();
    stubGitlab();

    await post(
      env,
      issueEvent(
        "open",
        {},
        {
          labels: [{ title: "priority:critical" }, { title: "status:blocked" }],
        },
      ),
    );

    expect(await tasks(env)).toMatchObject([
      { priority: "low", status: "to-do", columnId: env.columns.todo.id },
    ]);
  });

  it("puts the task in the column of an issue_opened workflow rule", async () => {
    const env = await setup();
    stubGitlab();
    await db.insert(schema.workflowRuleTable).values({
      projectId: env.project.id,
      integrationType: "gitlab",
      eventType: "issue_opened",
      columnId: env.columns.inProgress.id,
    });

    await post(env, issueEvent("open"));

    expect(await tasks(env)).toMatchObject([
      { status: "in-progress", columnId: env.columns.inProgress.id },
    ]);
  });

  it("does not comment when the integration turned the back-link comment off", async () => {
    const env = await setup({ commentTaskLinkOnGitlabIssue: false });
    stubGitlab();

    await post(env, issueEvent("open"));

    expect(await tasks(env)).toHaveLength(1);
    expect(gitlabCalls).toEqual([]);
  });

  it("keeps the task when GitLab refuses the back-link comment", async () => {
    const env = await setup();
    stubGitlab(() => new Response("{}", { status: 500 }));

    const response = await post(env, issueEvent("open"));

    expect(response.status).toBe(200);
    const [task] = await tasks(env);
    const [link] = await db.query.externalLinkTable.findMany({
      where: eq(schema.externalLinkTable.taskId, task.id),
    });
    expect(meta(link)).toEqual({
      state: "opened",
      createdFrom: "gitlab",
      author: "ann",
    });
  });

  it("creates the task only once when GitLab delivers the same event twice", async () => {
    const env = await setup();
    stubGitlab();

    await post(env, issueEvent("open"));
    await post(env, issueEvent("open"));

    expect(await tasks(env)).toHaveLength(1);
    expect(gitlabCalls).toHaveLength(1);
  });

  it("numbers consecutive issues one after the other", async () => {
    const env = await setup();
    stubGitlab();

    await post(env, issueEvent("open", { iid: 1, title: "One" }));
    await post(env, issueEvent("open", { iid: 2, title: "Two" }));

    expect((await tasks(env)).map((t) => [t.number, t.title])).toEqual([
      [1, "One"],
      [2, "Two"],
    ]);
  });

  it("ignores confidential issues and issues of another GitLab project", async () => {
    const env = await setup();
    stubGitlab();

    await post(env, issueEvent("open", { confidential: true }));
    await post(env, {
      ...issueEvent("open"),
      event_type: "confidential_issue",
    });
    await post(
      env,
      issueEvent("open", {}, { project: project("someone/else") }),
    );
    await post(
      env,
      issueEvent("open", {}, { project: { ...project(), web_url: "garbage" } }),
    );

    expect(await tasks(env)).toEqual([]);
    expect(gitlabCalls).toEqual([]);
  });

  it("does not match an integration whose stored base URL is not a URL", async () => {
    const env = await setup({ baseUrl: "not a url" });
    stubGitlab();

    const response = await post(env, issueEvent("open"));

    expect(response.status).toBe(200);
    expect(await tasks(env)).toEqual([]);
  });
});

describe("GitLab issue reopened webhook", () => {
  const reopen = (attributes: Record<string, unknown> = {}) =>
    issueEvent("reopen", attributes);

  it("moves a done task back to to-do and records the opened state", async () => {
    const env = await setup();
    const { task, link } = await addLinkedTask(
      env,
      { status: "done", columnId: env.columns.done.id },
      { state: "closed", keep: true },
    );

    const response = await post(env, reopen());

    expect(response.status).toBe(200);
    expect(await taskById(task.id)).toMatchObject({
      status: "to-do",
      columnId: env.columns.todo.id,
    });
    expect(meta(await linkById(link.id))).toEqual({
      state: "opened",
      keep: true,
    });
  });

  it("uses the issue_reopened workflow rule column", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(env, {
      status: "done",
      columnId: env.columns.done.id,
    });
    await db.insert(schema.workflowRuleTable).values({
      projectId: env.project.id,
      integrationType: "gitlab",
      eventType: "issue_reopened",
      columnId: env.columns.inProgress.id,
    });

    await post(env, reopen());

    expect((await taskById(task.id)).status).toBe("in-progress");
  });

  it("treats a reopen right after Kaneo reopened the issue as an echo", async () => {
    const env = await setup();
    const now = Date.now();
    const { task, link } = await addLinkedTask(
      env,
      { status: "in-progress", columnId: env.columns.inProgress.id },
      { state: "opened", lastOutboundStateSyncAt: now },
    );

    await post(env, reopen({ updated_at: new Date(now + 1000).toISOString() }));

    expect((await taskById(task.id)).status).toBe("in-progress");
    expect(meta(await linkById(link.id)).lastOutboundStateSyncAt).toBe(now);
  });

  it.each([
    {
      name: "outside the echo window",
      attributes: (now: number) => ({
        updated_at: new Date(now + 60_000).toISOString(),
      }),
    },
    { name: "without updated_at", attributes: () => ({}) },
  ])("applies a reopen $name", async ({ attributes }) => {
    const env = await setup();
    const now = Date.now();
    const { task } = await addLinkedTask(
      env,
      { status: "done", columnId: env.columns.done.id },
      { state: "opened", lastOutboundStateSyncAt: now },
    );

    await post(env, reopen(attributes(now)));

    expect((await taskById(task.id)).status).toBe("to-do");
  });

  it("recovers from unreadable link metadata", async () => {
    const env = await setup();
    const { task, link } = await addLinkedTask(
      env,
      { status: "done", columnId: env.columns.done.id },
      "{broken",
    );

    await post(env, reopen());

    expect((await taskById(task.id)).status).toBe("to-do");
    expect(meta(await linkById(link.id))).toEqual({ state: "opened" });
  });

  it("ignores an unlinked issue and an unknown action", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(env, {
      status: "done",
      columnId: env.columns.done.id,
    });

    await post(env, reopen({ iid: 999 }));
    await post(env, issueEvent("approved"));
    await post(env, issueEvent("reopen", { action: undefined }));

    expect((await taskById(task.id)).status).toBe("done");
  });
});

describe("GitLab issue updated webhook", () => {
  const update = (
    attributes: Record<string, unknown>,
    changes: Record<string, unknown> | undefined,
    extra: Record<string, unknown> = {},
  ) =>
    issueEvent(
      "update",
      attributes,
      changes === undefined ? extra : { changes, ...extra },
    );

  it("applies a title and description edit, stripping the Kaneo footer, and records the sync", async () => {
    const env = await setup();
    const { task, link } = await addLinkedTask(env);

    const response = await post(
      env,
      update(
        {
          title: "New title",
          description: "New body\n\n---\n<sub>Task: abc</sub>",
        },
        {
          title: { previous: "Local title", current: "New title" },
          description: { previous: "a", current: "b" },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(await taskById(task.id)).toMatchObject({
      title: "New title",
      description: "New body",
    });
    const stored = await linkById(link.id);
    expect(stored.title).toBe("New title");
    expect(meta(stored)).toMatchObject({
      state: "opened",
      lastSync: {
        title: { source: "gitlab", value: "New title" },
        description: { source: "gitlab", value: "New body" },
      },
    });
  });

  it("does not write back a title that Kaneo itself just sent, but still applies the description", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(
      env,
      {},
      {
        lastSync: {
          title: {
            source: "kaneo",
            value: "Kaneo title",
            timestamp: new Date().toISOString(),
          },
        },
      },
    );

    await post(
      env,
      update(
        { title: "Kaneo title", description: "GitLab body" },
        {
          title: { previous: "x", current: "Kaneo title" },
          description: { previous: "a", current: "GitLab body" },
        },
      ),
    );

    expect(await taskById(task.id)).toMatchObject({
      title: "Local title",
      description: "GitLab body",
    });
  });

  it("treats an echoed description as already applied, comparing the raw body with its footer", async () => {
    const env = await setup();
    const body = "Kaneo text\n\n---\n<sub>Task: abc</sub>";
    const { task, link } = await addLinkedTask(
      env,
      {},
      {
        lastSync: {
          description: {
            source: "kaneo",
            value: body,
            timestamp: new Date().toISOString(),
          },
        },
      },
    );

    await post(
      env,
      update(
        { description: body },
        { description: { previous: "a", current: body } },
      ),
    );

    expect((await taskById(task.id)).description).toBe("Local description");
    expect((await linkById(link.id)).title).toBe("Local title");
  });

  it("clears the description when the issue body becomes empty", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(env);

    await post(
      env,
      update(
        { description: null },
        { description: { previous: "a", current: null } },
      ),
    );

    expect((await taskById(task.id)).description).toBe("");
  });

  it("ignores updates that change neither text nor labels, and unlinked issues", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(env);

    await post(env, update({ title: "Sneaky" }, undefined));
    await post(env, update({ title: "Sneaky" }, { assignees: [] }));
    await post(
      env,
      update(
        { iid: 404, title: "Sneaky" },
        { title: { previous: "a", current: "Sneaky" } },
      ),
    );

    expect((await taskById(task.id)).title).toBe("Local title");
  });

  it("changes priority and status from label changes", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(env);

    await post(
      env,
      update(
        {},
        {
          labels: {
            previous: [{ title: "status:to-do" }],
            current: [
              { title: "priority:high" },
              { title: "status:in-progress" },
            ],
          },
        },
      ),
    );

    expect(await taskById(task.id)).toMatchObject({
      priority: "high",
      status: "in-progress",
      columnId: env.columns.inProgress.id,
    });
  });

  it("does not move the task when the status label did not change or names no column", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(env, {
      status: "in-review",
      columnId: env.columns.inReview.id,
    });

    await post(
      env,
      update(
        {},
        {
          labels: {
            previous: [{ title: "status:to-do" }],
            current: [{ title: "status:to-do" }, { title: "bug" }],
          },
        },
      ),
    );
    await post(
      env,
      update(
        {},
        {
          labels: {
            previous: [],
            current: [{ title: "status:no-such-column" }],
          },
        },
      ),
    );

    expect(await taskById(task.id)).toMatchObject({
      status: "in-review",
      priority: "low",
    });
  });

  it("falls back to the payload label snapshot when the change carries no current labels", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(env);

    await post(
      env,
      update(
        {},
        { labels: { previous: [] } },
        { labels: [{ title: "priority:medium" }] },
      ),
    );

    expect((await taskById(task.id)).priority).toBe("medium");
  });

  it("syncs plain labels: adds new ones, recolors changed ones, removes only the ones the event removed", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(env);
    const label = (name: string, color: string) => ({
      name,
      color,
      taskId: task.id,
      workspaceId: env.member.workspace.id,
    });
    await db
      .insert(schema.labelTable)
      .values([
        label("keep-local", "#111111"),
        label("recolor", "#222222"),
        label("same", "#333333"),
        label("removed-in-gitlab", "#444444"),
      ]);

    await post(
      env,
      update(
        {},
        {
          labels: {
            previous: [
              { title: "removed-in-gitlab" },
              { title: "same", color: "#333333" },
              { title: "priority:low" },
            ],
            current: [
              { title: "recolor", color: "#abcdef" },
              { title: "same", color: "333333" },
              { title: "brand-new", color: "#00ff00" },
              { title: "status:done", color: "#000000" },
              { title: "no-color" },
              { color: "#123456" },
            ],
          },
        },
      ),
    );

    const rows = await db.query.labelTable.findMany({
      where: eq(schema.labelTable.taskId, task.id),
    });
    expect(Object.fromEntries(rows.map((r) => [r.name, r.color]))).toEqual({
      "keep-local": "#111111",
      recolor: "#abcdef",
      same: "#333333",
      "brand-new": "#00ff00",
      "no-color": "#6B7280",
    });
    expect(rows.some((r) => r.name.startsWith("status:"))).toBe(false);
  });

  it("ignores a label change that carries no label list at all", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(env);

    const response = await post(
      env,
      update(
        {},
        { labels: { previous: [{ title: "bug" }] } },
        { labels: undefined },
      ),
    );

    expect(response.status).toBe(200);
    expect(await taskById(task.id)).toMatchObject({
      priority: "low",
      status: "to-do",
    });
  });

  it("keeps going with a 200 when the payload is malformed, and changes nothing", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(env);

    const response = await post(
      env,
      update(
        { iid: undefined, title: "Broken" },
        { title: { previous: "a", current: "Broken" } },
      ),
    );

    expect(response.status).toBe(200);
    expect((await taskById(task.id)).title).toBe("Local title");
  });
});

describe("GitLab note webhook", () => {
  const note = (
    attributes: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ) => ({
    object_kind: "note",
    user: {
      username: "bob",
      name: "Bob",
      avatar_url: "https://a.example/bob.png",
    },
    object_attributes: {
      id: 301,
      note: "Works for me",
      noteable_type: "Issue",
      url: `${BASE_URL}/group/project/-/issues/12#note_301`,
      ...attributes,
    },
    issue: { iid: 12 },
    project: project(),
    ...extra,
  });

  async function comments(taskId: string) {
    return db.query.activityTable.findMany({
      where: and(
        eq(schema.activityTable.taskId, taskId),
        eq(schema.activityTable.type, "comment"),
      ),
    });
  }

  it("stores a GitLab comment on the linked task with its author and source", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(env);

    const response = await post(env, note());

    expect(response.status).toBe(200);
    const [comment] = await comments(task.id);
    expect(comment).toMatchObject({
      content: "Works for me",
      externalUserName: "bob",
      externalUserAvatar: "https://a.example/bob.png",
      externalSource: "gitlab",
      externalUrl: `${BASE_URL}/group/project/-/issues/12#note_301`,
    });
    expect(comment.eventData).toEqual({ externalCommentId: 301 });
  });

  it("names the author from the display name, or Unknown", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(env);

    await post(env, note({ id: 1, url: "u1" }, { user: { name: "Bob" } }));
    await post(env, note({ id: 2, url: "u2" }, { user: null }));

    const stored = await comments(task.id);
    expect(
      stored
        .map((c) => [c.externalUrl, c.externalUserName, c.externalUserAvatar])
        .sort(),
    ).toEqual([
      ["u1", "Bob", null],
      ["u2", "Unknown", null],
    ]);
  });

  it("stores a delivered note only once", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(env);

    await post(env, note());
    await post(env, note());

    expect(await comments(task.id)).toHaveLength(1);
  });

  it.each([
    { name: "unreadable metadata", metadata: "{broken" },
    {
      name: "metadata with a non-list note id field",
      metadata: { syncedNoteIds: "301" },
    },
    { name: "no metadata", metadata: null },
  ])("stores the comment of a link with $name", async ({ metadata }) => {
    const env = await setup();
    const { task, link } = await addLinkedTask(env);
    await db
      .update(schema.externalLinkTable)
      .set({
        metadata:
          metadata === null
            ? null
            : typeof metadata === "string"
              ? metadata
              : JSON.stringify(metadata),
      })
      .where(eq(schema.externalLinkTable.id, link.id));

    await post(env, note());

    expect(await comments(task.id)).toHaveLength(1);
  });

  it("skips notes that Kaneo posted itself", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(
      env,
      {},
      { syncedNoteIds: [301, "x"] },
    );

    await post(env, note());

    expect(await comments(task.id)).toEqual([]);
  });

  it("keeps system, internal, confidential and non-issue notes out of the task", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(env);

    await post(env, note({ system: true }));
    await post(env, note({ internal: true }));
    await post(env, { ...note(), event_type: "confidential_note" });
    await post(env, note({ noteable_type: "MergeRequest" }));
    await post(env, note({}, { issue: undefined }));

    expect(await comments(task.id)).toEqual([]);
  });

  it("ignores a note on an issue that has no task and one for another GitLab project", async () => {
    const env = await setup();
    const { task } = await addLinkedTask(env);

    await post(env, note({}, { issue: { iid: 999 } }));
    await post(env, note({}, { project: project("someone/else") }));
    await post(
      env,
      note({}, { project: { ...project(), web_url: "garbage" } }),
    );

    expect(await comments(task.id)).toEqual([]);
  });
});
