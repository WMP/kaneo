import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { handleTaskCommentCreated } from "../../apps/api/src/plugins/gitlab/events/task-comment-created";
import { handleTaskCreated } from "../../apps/api/src/plugins/gitlab/events/task-created";
import { handleTaskDescriptionChanged } from "../../apps/api/src/plugins/gitlab/events/task-description-changed";
import { handleTaskPriorityChanged } from "../../apps/api/src/plugins/gitlab/events/task-priority-changed";
import { handleTaskStatusChanged } from "../../apps/api/src/plugins/gitlab/events/task-status-changed";
import { handleTaskTitleChanged } from "../../apps/api/src/plugins/gitlab/events/task-title-changed";
import {
  ensureLabelsExistGitlab,
  removeLabelGitlab,
} from "../../apps/api/src/plugins/gitlab/utils/labels";
import {
  removeLabelFromGitlab,
  syncLabelToGitlab,
} from "../../apps/api/src/plugins/gitlab/utils/sync-label-to-gitlab";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const BASE_URL = "https://203.0.113.10";
const TOKEN = "glpat-outbound-token";

type Call = { method: string; path: string; body: Record<string, unknown> };
type Responder = (call: Call) => Response | Promise<Response> | undefined;

const calls: Call[] = [];
let responders: Responder[] = [];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Every unmatched request gets a sensible default so a test only has to
// describe what differs: labels exist as listed, PUT returns the issue.
function stubGitlab(options: {
  labels?: string[];
  respond?: Responder[];
  issueLabels?: string[];
}) {
  calls.length = 0;
  responders = options.respond ?? [];
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
      calls.push(call);
      for (const responder of responders) {
        const response = responder(call);
        if (response) return response;
      }
      if (call.method === "GET" && call.path.includes("/labels?")) {
        return json((options.labels ?? []).map((name, id) => ({ id, name })));
      }
      if (call.method === "POST" && call.path.endsWith("/labels")) {
        return json({ id: 99, name: call.body.name });
      }
      if (call.method === "POST" && call.path.endsWith("/issues")) {
        return json({
          id: 500,
          iid: 41,
          title: call.body.title,
          description: call.body.description,
          web_url: `${BASE_URL}/group/project/-/issues/41`,
          state: "opened",
        });
      }
      if (call.method === "POST" && call.path.endsWith("/notes")) {
        return json({ id: 777, body: call.body.body });
      }
      if (call.method === "GET" && /\/issues\/\d+$/.test(call.path)) {
        return json({ iid: 3, labels: options.issueLabels ?? [] });
      }
      if (call.method === "PUT") {
        return json({ iid: 3 });
      }
      throw new Error(`Unexpected GitLab request ${call.method} ${call.path}`);
    }),
  );
}

const writes = () => calls.filter((c) => c.method !== "GET");

async function setup(options?: {
  linkMetadata?: unknown;
  externalId?: string;
}) {
  const member = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: member.workspace.id,
    slug: "kan",
  });
  const config = {
    baseUrl: BASE_URL,
    projectPath: "group/project",
    accessToken: TOKEN,
  };
  const [integration] = await db
    .insert(schema.integrationTable)
    .values({
      projectId: project.id,
      type: "gitlab",
      isActive: true,
      config: JSON.stringify(config),
    })
    .returning();
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId: project.id, title: "Task", number: 1 })
    .returning();
  const [link] = await db
    .insert(schema.externalLinkTable)
    .values({
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: options?.externalId ?? "3",
      url: `${BASE_URL}/group/project/-/issues/3`,
      title: "Task",
      metadata:
        options?.linkMetadata === undefined
          ? null
          : typeof options.linkMetadata === "string"
            ? options.linkMetadata
            : JSON.stringify(options.linkMetadata),
    })
    .returning();
  const context = {
    integrationId: integration.id,
    projectId: project.id,
    config: config as Record<string, unknown>,
  };
  return { member, project, integration, task, link, config, context };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function linkRow(id: string) {
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
  calls.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const failing500: Responder = (call) =>
  call.method === "PUT" ||
  (call.method === "POST" && !call.path.endsWith("/labels"))
    ? json({ message: "boom" }, 500)
    : undefined;

describe("task created in Kaneo", () => {
  const event = (env: Env, extra: Record<string, unknown> = {}) => ({
    taskId: env.task.id,
    projectId: env.project.id,
    userId: env.member.user.id,
    title: "Fix login",
    description: "Steps to reproduce",
    priority: "high",
    status: "to-do",
    ...extra,
  });

  async function unlinkedEnv() {
    const env = await setup();
    await db
      .delete(schema.externalLinkTable)
      .where(eq(schema.externalLinkTable.id, env.link.id));
    return env;
  }

  it("creates the issue, stores the link and applies the missing priority and status labels", async () => {
    const env = await unlinkedEnv();
    stubGitlab({ labels: ["status:to-do"] });

    await handleTaskCreated(event(env) as never, env.context);

    expect(calls.map((c) => `${c.method} ${c.path.split("?")[0]}`)).toEqual([
      "POST /projects/group/project/issues",
      "GET /projects/group/project/labels",
      "POST /projects/group/project/labels",
      "PUT /projects/group/project/issues/41",
    ]);
    expect(calls[0].body).toEqual({
      title: "Fix login",
      description: `Steps to reproduce\n\n---\n<sub>Task: ${env.task.id}</sub>`,
    });
    // status:to-do already exists, so only priority:high is created.
    expect(calls[2].body).toEqual({ name: "priority:high", color: "#F97316" });
    expect(calls[3].body).toEqual({
      add_labels: "priority:high,status:to-do",
    });
    const [link] = await db.query.externalLinkTable.findMany({
      where: eq(schema.externalLinkTable.taskId, env.task.id),
    });
    expect(link).toMatchObject({
      resourceType: "issue",
      externalId: "41",
      url: `${BASE_URL}/group/project/-/issues/41`,
      title: "Fix login",
      integrationId: env.integration.id,
    });
    expect(meta(link)).toMatchObject({ state: "opened", createdFrom: "kaneo" });
    expect(typeof meta(link).lastOutboundStateSyncAt).toBe("number");
  });

  it("writes only a status label and a footer-only body for a task without priority or description", async () => {
    const env = await unlinkedEnv();
    stubGitlab({});

    await handleTaskCreated(
      event(env, { priority: "no-priority", description: null }) as never,
      env.context,
    );

    expect(calls[0].body.description).toBe(`<sub>Task: ${env.task.id}</sub>`);
    expect(writes().at(-1)?.body).toEqual({ add_labels: "status:to-do" });
  });

  it("does not create a second issue when the task is already linked", async () => {
    const env = await setup();
    stubGitlab({});

    await handleTaskCreated(event(env) as never, env.context);

    expect(calls).toEqual([]);
  });

  it("does nothing without a token or base URL in the config", async () => {
    const env = await unlinkedEnv();
    stubGitlab({});

    await handleTaskCreated(event(env) as never, {
      ...env.context,
      config: { ...env.config, accessToken: "" },
    });
    await handleTaskCreated(event(env) as never, {
      ...env.context,
      config: { ...env.config, baseUrl: "" },
    });

    expect(calls).toEqual([]);
  });

  it("stores no link when GitLab refuses to create the issue", async () => {
    const env = await unlinkedEnv();
    stubGitlab({ respond: [failing500] });

    await expect(
      handleTaskCreated(event(env) as never, env.context),
    ).resolves.toBeUndefined();

    expect(
      await db.query.externalLinkTable.findMany({
        where: eq(schema.externalLinkTable.taskId, env.task.id),
      }),
    ).toEqual([]);
  });
});

describe("task status changed in Kaneo", () => {
  const event = (
    env: Env,
    oldStatus: string,
    newStatus: string,
    extra: Record<string, unknown> = {},
  ) => ({
    taskId: env.task.id,
    projectId: env.project.id,
    userId: null,
    oldStatus,
    newStatus,
    title: "Task",
    assigneeId: null,
    type: "status_changed",
    ...extra,
  });

  it("swaps the status label in a single update and leaves the issue open", async () => {
    const env = await setup();
    stubGitlab({ labels: ["status:to-do", "status:in-progress"] });

    await handleTaskStatusChanged(
      event(env, "to-do", "in-progress") as never,
      env.context,
    );

    expect(writes()).toEqual([
      {
        method: "PUT",
        path: "/projects/group/project/issues/3",
        body: {
          add_labels: "status:in-progress",
          remove_labels: "status:to-do",
        },
      },
    ]);
    expect(await linkRow(env.link.id)).toMatchObject({ metadata: null });
  });

  it("closes the issue when the task moves to done and records the outbound sync", async () => {
    const env = await setup({ linkMetadata: { state: "opened", keep: 1 } });
    stubGitlab({ labels: ["status:done"] });
    const before = Date.now();

    await handleTaskStatusChanged(
      event(env, "in-review", "done") as never,
      env.context,
    );

    expect(writes().map((c) => c.body)).toEqual([
      { add_labels: "status:done", remove_labels: "status:in-review" },
      { state_event: "close" },
    ]);
    const stored = meta(await linkRow(env.link.id));
    expect(stored).toMatchObject({ state: "closed", keep: 1 });
    expect(stored.lastOutboundStateSyncAt).toBeGreaterThanOrEqual(before);
  });

  it("reopens the issue when the task leaves done", async () => {
    const env = await setup({ linkMetadata: "{broken" });
    stubGitlab({ labels: ["status:to-do"] });

    await handleTaskStatusChanged(
      event(env, "done", "to-do") as never,
      env.context,
    );

    expect(
      writes()
        .map((c) => c.body)
        .at(-1),
    ).toEqual({ state_event: "reopen" });
    expect(meta(await linkRow(env.link.id))).toMatchObject({ state: "opened" });
  });

  it("ignores a status change that came from this very GitLab project", async () => {
    const env = await setup();
    stubGitlab({});

    await handleTaskStatusChanged(
      event(env, "to-do", "done", {
        sourceIntegrationId: env.integration.id,
      }) as never,
      env.context,
    );

    expect(calls).toEqual([]);
  });

  it("still syncs when the change came from another integration", async () => {
    const env = await setup();
    stubGitlab({ labels: ["status:in-progress"] });

    await handleTaskStatusChanged(
      event(env, "to-do", "in-progress", {
        sourceIntegrationId: "other-integration",
      }) as never,
      env.context,
    );

    expect(writes()).toHaveLength(1);
  });

  it("does nothing for a task without an issue link of this integration, for a bad iid or without credentials", async () => {
    const env = await setup({ externalId: "abc" });
    stubGitlab({});

    await handleTaskStatusChanged(
      event(env, "to-do", "done") as never,
      env.context,
    );
    await handleTaskStatusChanged(event(env, "to-do", "done") as never, {
      ...env.context,
      integrationId: "someone-else",
    });
    await handleTaskStatusChanged(event(env, "to-do", "done") as never, {
      ...env.context,
      config: { ...env.config, accessToken: "" },
    });

    expect(calls).toEqual([]);
  });

  it("keeps the link untouched when GitLab rejects the state change", async () => {
    const env = await setup({ linkMetadata: { state: "opened" } });
    stubGitlab({
      labels: ["status:done"],
      respond: [
        (call) =>
          call.body.state_event ? json({ message: "no" }, 403) : undefined,
      ],
    });

    await handleTaskStatusChanged(
      event(env, "to-do", "done") as never,
      env.context,
    );

    expect(meta(await linkRow(env.link.id))).toEqual({ state: "opened" });
  });
});

describe("task priority changed in Kaneo", () => {
  const event = (
    env: Env,
    oldPriority: string | null,
    newPriority: string | null,
  ) => ({
    taskId: env.task.id,
    projectId: env.project.id,
    userId: null,
    oldPriority,
    newPriority,
  });

  it.each([
    {
      from: "low",
      to: "urgent",
      body: { add_labels: "priority:urgent", remove_labels: "priority:low" },
    },
    { from: "no-priority", to: "high", body: { add_labels: "priority:high" } },
    { from: null, to: "medium", body: { add_labels: "priority:medium" } },
    {
      from: "high",
      to: "no-priority",
      body: { remove_labels: "priority:high" },
    },
    { from: "high", to: null, body: { remove_labels: "priority:high" } },
    { from: "high", to: "high", body: { add_labels: "priority:high" } },
  ])("sends $body for $from -> $to", async ({ from, to, body }) => {
    const env = await setup();
    stubGitlab({
      labels: ["priority:urgent", "priority:high", "priority:medium"],
    });

    await handleTaskPriorityChanged(event(env, from, to) as never, env.context);

    expect(writes()).toEqual([
      { method: "PUT", path: "/projects/group/project/issues/3", body },
    ]);
  });

  it("creates the new priority label in GitLab with its color when it is missing", async () => {
    const env = await setup();
    stubGitlab({ labels: [] });

    await handleTaskPriorityChanged(
      event(env, "low", "urgent") as never,
      env.context,
    );

    expect(writes()[0]).toMatchObject({
      method: "POST",
      path: "/projects/group/project/labels",
      body: { name: "priority:urgent", color: "#EF4444" },
    });
  });

  it("sends nothing when neither side has a priority", async () => {
    const env = await setup();
    stubGitlab({});

    await handleTaskPriorityChanged(
      event(env, "no-priority", null) as never,
      env.context,
    );

    expect(calls).toEqual([]);
  });

  it("does nothing for an unlinked task, a bad iid or missing credentials", async () => {
    const bad = await setup({ externalId: "x1" });
    stubGitlab({});

    await handleTaskPriorityChanged(
      event(bad, "low", "high") as never,
      bad.context,
    );
    await handleTaskPriorityChanged(event(bad, "low", "high") as never, {
      ...bad.context,
      integrationId: "someone-else",
    });
    await handleTaskPriorityChanged(event(bad, "low", "high") as never, {
      ...bad.context,
      config: { ...bad.config, baseUrl: "" },
    });

    expect(calls).toEqual([]);
  });

  it("swallows a GitLab failure when updating labels", async () => {
    const env = await setup();
    stubGitlab({ labels: ["priority:high"], respond: [failing500] });

    await expect(
      handleTaskPriorityChanged(
        event(env, "low", "high") as never,
        env.context,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("task title changed in Kaneo", () => {
  const event = (env: Env, newTitle: string) => ({
    taskId: env.task.id,
    projectId: env.project.id,
    userId: null,
    oldTitle: "Task",
    newTitle,
  });

  it("updates the issue title, the link title and the last-sync marker", async () => {
    const env = await setup({ linkMetadata: { state: "opened" } });
    stubGitlab({});

    await handleTaskTitleChanged(
      event(env, "Better title") as never,
      env.context,
    );

    expect(writes()).toEqual([
      {
        method: "PUT",
        path: "/projects/group/project/issues/3",
        body: { title: "Better title" },
      },
    ]);
    const link = await linkRow(env.link.id);
    expect(link.title).toBe("Better title");
    expect(meta(link)).toMatchObject({
      state: "opened",
      lastSync: { title: { source: "kaneo", value: "Better title" } },
    });
  });

  it("does not echo a title that GitLab itself just wrote", async () => {
    const env = await setup({
      linkMetadata: {
        lastSync: {
          title: {
            source: "gitlab",
            value: "From GitLab",
            timestamp: new Date().toISOString(),
          },
        },
      },
    });
    stubGitlab({});

    await handleTaskTitleChanged(
      event(env, "From GitLab") as never,
      env.context,
    );

    expect(calls).toEqual([]);
    expect((await linkRow(env.link.id)).title).toBe("Task");
  });

  it("sends the title again once the echo window has passed", async () => {
    const env = await setup({
      linkMetadata: {
        lastSync: {
          title: {
            source: "gitlab",
            value: "From GitLab",
            timestamp: new Date(Date.now() - 5 * 60_000).toISOString(),
          },
        },
      },
    });
    stubGitlab({});

    await handleTaskTitleChanged(
      event(env, "From GitLab") as never,
      env.context,
    );

    expect(writes()).toHaveLength(1);
  });

  it("does nothing for an unlinked task, a bad iid or missing credentials", async () => {
    const env = await setup({ externalId: "nope" });
    stubGitlab({});

    await handleTaskTitleChanged(event(env, "x") as never, env.context);
    await handleTaskTitleChanged(event(env, "x") as never, {
      ...env.context,
      integrationId: "someone-else",
    });
    await handleTaskTitleChanged(event(env, "x") as never, {
      ...env.context,
      config: { ...env.config, accessToken: "" },
    });

    expect(calls).toEqual([]);
  });

  it("leaves the link alone when GitLab rejects the update", async () => {
    const env = await setup();
    stubGitlab({ respond: [failing500] });

    await handleTaskTitleChanged(event(env, "New") as never, env.context);

    const link = await linkRow(env.link.id);
    expect(link.title).toBe("Task");
    expect(link.metadata).toBeNull();
  });
});

describe("task description changed in Kaneo", () => {
  const event = (env: Env, newDescription: string | null) => ({
    taskId: env.task.id,
    projectId: env.project.id,
    userId: null,
    oldDescription: "old",
    newDescription,
  });

  it("writes the description with the task footer and remembers it as the last sync", async () => {
    const env = await setup();
    stubGitlab({});

    await handleTaskDescriptionChanged(
      event(env, "New text") as never,
      env.context,
    );

    const expected = `New text\n\n---\n<sub>Task: ${env.task.id}</sub>`;
    expect(writes()).toEqual([
      {
        method: "PUT",
        path: "/projects/group/project/issues/3",
        body: { description: expected },
      },
    ]);
    expect(meta(await linkRow(env.link.id)).lastSync.description).toMatchObject(
      {
        source: "kaneo",
        value: expected,
      },
    );
  });

  it("sends a footer-only body for a cleared description", async () => {
    const env = await setup();
    stubGitlab({});

    await handleTaskDescriptionChanged(event(env, null) as never, env.context);

    expect(writes()[0].body).toEqual({
      description: `<sub>Task: ${env.task.id}</sub>`,
    });
  });

  it("does not echo a description that GitLab itself just wrote", async () => {
    const env = await setup({
      linkMetadata: {
        lastSync: {
          description: {
            source: "gitlab",
            value: "same",
            timestamp: new Date().toISOString(),
          },
        },
      },
    });
    stubGitlab({});

    await handleTaskDescriptionChanged(
      event(env, "same") as never,
      env.context,
    );

    expect(calls).toEqual([]);
  });

  it("does nothing for an unlinked task, a bad iid or missing credentials", async () => {
    const env = await setup({ externalId: "nope" });
    stubGitlab({});

    await handleTaskDescriptionChanged(event(env, "x") as never, env.context);
    await handleTaskDescriptionChanged(event(env, "x") as never, {
      ...env.context,
      integrationId: "someone-else",
    });
    await handleTaskDescriptionChanged(event(env, "x") as never, {
      ...env.context,
      config: { ...env.config, baseUrl: "" },
    });

    expect(calls).toEqual([]);
  });

  it("leaves the link alone when GitLab rejects the update", async () => {
    const env = await setup();
    stubGitlab({ respond: [failing500] });

    await handleTaskDescriptionChanged(event(env, "New") as never, env.context);

    expect((await linkRow(env.link.id)).metadata).toBeNull();
  });
});

describe("comment created in Kaneo", () => {
  const event = (env: Env, comment = "Looks good") => ({
    taskId: env.task.id,
    projectId: env.project.id,
    userId: env.member.user.id,
    comment,
  });

  it("posts the note and remembers its id so the webhook echo can be skipped", async () => {
    const env = await setup({
      linkMetadata: { syncedNoteIds: [5], other: true },
    });
    stubGitlab({});

    await handleTaskCommentCreated(event(env) as never, env.context);

    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/projects/group/project/issues/3/notes",
        body: { body: "Looks good" },
      },
    ]);
    expect(meta(await linkRow(env.link.id))).toEqual({
      syncedNoteIds: [5, 777],
      other: true,
    });
  });

  it("tracks at most 50 note ids, dropping the oldest", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    const env = await setup({ linkMetadata: { syncedNoteIds: ids } });
    stubGitlab({});

    await handleTaskCommentCreated(event(env) as never, env.context);

    const stored = meta(await linkRow(env.link.id)).syncedNoteIds as number[];
    expect(stored).toHaveLength(50);
    expect(stored[0]).toBe(2);
    expect(stored.at(-1)).toBe(777);
  });

  it.each(["abc", "12abc", "0", "-3", ""])(
    "refuses to post to a link with external id %j",
    async (externalId) => {
      const env = await setup({ externalId });
      stubGitlab({});

      await handleTaskCommentCreated(event(env) as never, env.context);

      expect(calls).toEqual([]);
    },
  );

  it("does nothing without a link of this integration or without credentials", async () => {
    const env = await setup();
    stubGitlab({});

    await handleTaskCommentCreated(event(env) as never, {
      ...env.context,
      integrationId: "someone-else",
    });
    await handleTaskCommentCreated(event(env) as never, {
      ...env.context,
      config: { ...env.config, accessToken: "" },
    });

    expect(calls).toEqual([]);
  });

  it("keeps the stored metadata when GitLab refuses the note", async () => {
    const env = await setup({ linkMetadata: { syncedNoteIds: [5] } });
    stubGitlab({ respond: [failing500] });

    await handleTaskCommentCreated(event(env) as never, env.context);

    expect(meta(await linkRow(env.link.id))).toEqual({ syncedNoteIds: [5] });
  });
});

describe("label sync from Kaneo labels", () => {
  it("creates a missing label with a hex color and adds it to the issue", async () => {
    const env = await setup();
    stubGitlab({ labels: [], issueLabels: [] });

    await syncLabelToGitlab(env.task.id, "backend", "red");

    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/projects/group/project/labels",
        body: { name: "backend", color: "#EF4444" },
      },
      {
        method: "PUT",
        path: "/projects/group/project/issues/3",
        body: { add_labels: "backend" },
      },
    ]);
  });

  it.each([
    { input: "#abc", color: "#aabbcc" },
    { input: "#12ab34", color: "#12ab34" },
    { input: "Teal", color: "#14B8A6" },
    { input: "not-a-color", color: "#6B7280" },
  ])("converts the color $input to $color", async ({ input, color }) => {
    const env = await setup();
    stubGitlab({ labels: [] });

    await syncLabelToGitlab(env.task.id, "l", input);

    expect(writes()[0].body.color).toBe(color);
  });

  it("does not recreate an existing label or re-add one the issue already has", async () => {
    const env = await setup();
    stubGitlab({ labels: ["backend"], issueLabels: ["backend"] });

    await syncLabelToGitlab(env.task.id, "backend", "red");

    expect(writes()).toEqual([]);
  });

  it("stops when the label cannot be created", async () => {
    const env = await setup();
    stubGitlab({
      labels: [],
      respond: [
        (c) => (c.method === "POST" ? json({ message: "no" }, 403) : undefined),
      ],
    });

    await syncLabelToGitlab(env.task.id, "backend", "red");

    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("swallows a failure while adding the label to the issue", async () => {
    const env = await setup();
    stubGitlab({ labels: ["backend"], respond: [failing500] });

    await expect(
      syncLabelToGitlab(env.task.id, "backend", "red"),
    ).resolves.toBeUndefined();
  });

  it("removes a label from the issue and swallows a failure", async () => {
    const env = await setup();
    stubGitlab({});

    await removeLabelFromGitlab(env.task.id, "backend");
    expect(writes()).toEqual([
      {
        method: "PUT",
        path: "/projects/group/project/issues/3",
        body: { remove_labels: "backend" },
      },
    ]);

    stubGitlab({ respond: [failing500] });
    await expect(
      removeLabelFromGitlab(env.task.id, "backend"),
    ).resolves.toBeUndefined();
  });

  it("does nothing for a task without a GitLab issue, an unreadable config or a bad iid", async () => {
    const env = await setup();
    stubGitlab({});

    await syncLabelToGitlab("no-such-task", "x", "red");

    await db
      .update(schema.integrationTable)
      .set({ config: "{broken" })
      .where(eq(schema.integrationTable.id, env.integration.id));
    await syncLabelToGitlab(env.task.id, "x", "red");
    await removeLabelFromGitlab(env.task.id, "x");

    await db
      .update(schema.integrationTable)
      .set({ config: JSON.stringify({ projectPath: "group/project" }) })
      .where(eq(schema.integrationTable.id, env.integration.id));
    await syncLabelToGitlab(env.task.id, "x", "red");

    await db
      .update(schema.integrationTable)
      .set({ config: JSON.stringify(env.config) })
      .where(eq(schema.integrationTable.id, env.integration.id));
    await db
      .update(schema.externalLinkTable)
      .set({ externalId: "abc" })
      .where(eq(schema.externalLinkTable.id, env.link.id));
    await syncLabelToGitlab(env.task.id, "x", "red");

    expect(calls).toEqual([]);
  });
});

describe("label helpers", () => {
  it("ensureLabelsExistGitlab skips an empty list and a failing label listing", async () => {
    const env = await setup();
    stubGitlab({});

    await ensureLabelsExistGitlab(env.config as never, []);
    expect(calls).toEqual([]);

    stubGitlab({
      respond: [(c) => (c.method === "GET" ? json({}, 500) : undefined)],
    });
    await ensureLabelsExistGitlab(env.config as never, ["a"]);
    expect(writes()).toEqual([]);
  });

  it("ensureLabelsExistGitlab keeps creating the others when one label fails", async () => {
    const env = await setup();
    stubGitlab({
      labels: [],
      respond: [
        (c) => (c.body.name === "status:done" ? json({}, 500) : undefined),
      ],
    });

    await ensureLabelsExistGitlab(env.config as never, [
      "status:done",
      "status:planned",
      "custom",
    ]);

    expect(writes().map((c) => c.body)).toEqual([
      { name: "status:done", color: "#10B981" },
      { name: "status:planned", color: "#8B5CF6" },
      { name: "custom", color: "#6B7280" },
    ]);
  });

  it("removeLabelGitlab only removes", async () => {
    const env = await setup();
    stubGitlab({});

    await removeLabelGitlab(env.config as never, 3, "status:to-do");

    expect(writes().map((c) => c.body)).toEqual([
      { remove_labels: "status:to-do" },
    ]);
  });
});
