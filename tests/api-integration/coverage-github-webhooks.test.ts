import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import db, { getDatabasePool, schema } from "../../apps/api/src/database";
import {
  subscribeToEvent,
  waitForPendingEventHandlers,
} from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { setupWebhookHandlers } from "../../apps/api/src/plugins/github/webhook-handler";
import { handleIssueCommentCreated } from "../../apps/api/src/plugins/github/webhooks/issue-comment-created";
import { handleIssueOpened } from "../../apps/api/src/plugins/github/webhooks/issue-opened";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  configureGithubApp,
  GITHUB_PRIVATE_KEY_PEM,
  GITHUB_WEBHOOK_SECRET,
  sign,
  stubGithub,
} from "./support/github-coverage";

configureGithubApp();

const statusEvents: Array<Record<string, unknown>> = [];
beforeAll(async () => {
  setupWebhookHandlers();
  await subscribeToEvent<Record<string, unknown>>(
    "task.status_changed",
    async (data) => {
      statusEvents.push(data);
    },
  );
});
beforeEach(async () => {
  await resetTestDatabase();
  statusEvents.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // Never reach the public Internet: unlisted GitHub calls answer 404.
  stubGithub();
  vi.stubEnv("KANEO_CLIENT_URL", "https://kaneo.test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const { app } = createApp();
const URL_PATH = "/api/github-integration/webhook";

async function deliver(
  event: string,
  payload: unknown,
  headers: Record<string, string | null> = {},
  rawBody?: string,
) {
  const body = rawBody ?? JSON.stringify(payload);
  const all: Record<string, string | null> = {
    "content-type": "application/json",
    "x-hub-signature-256": sign(body),
    "x-github-event": event,
    "x-github-delivery": "delivery-1",
    ...headers,
  };
  const clean = Object.fromEntries(
    Object.entries(all).filter(([, v]) => v !== null),
  ) as Record<string, string>;
  const response = await app.request(URL_PATH, {
    method: "POST",
    headers: clean,
    body,
  });
  await waitForPendingEventHandlers();
  return { status: response.status, json: await response.json() };
}

type Setup = Awaited<ReturnType<typeof setup>>;
async function setup(
  options: {
    repositoryId?: number;
    installationId?: number;
    config?: Record<string, unknown>;
    isActive?: boolean;
    workspaceId?: string;
    slug?: string;
    rawConfig?: string;
  } = {},
) {
  const member = options.workspaceId
    ? null
    : await createWorkspaceMember({ role: "owner" });
  const workspaceId = options.workspaceId ?? (member?.workspace.id as string);
  const userId = member?.user.id ?? "user-x";
  const { project, columns } = await createProjectFixture({
    workspaceId,
    ...(options.slug ? { slug: options.slug } : {}),
  });
  const config = {
    repositoryOwner: "example",
    repositoryName: "repo",
    installationId: options.installationId ?? 10,
    repositoryId: options.repositoryId ?? 20,
    verifiedGithubAccountId: "30",
    verifiedByUserId: userId,
    ...options.config,
  };
  const [integration] = await db
    .insert(schema.integrationTable)
    .values({
      projectId: project.id,
      type: "github",
      config: options.rawConfig ?? JSON.stringify(config),
      isActive: options.isActive ?? true,
    })
    .returning();
  return { workspaceId, project, columns, integration, config };
}

async function addTask(
  s: Setup,
  values: Partial<typeof schema.taskTable.$inferInsert> = {},
) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: s.project.id,
      title: "Linked task",
      description: "Body",
      number: 7,
      ...values,
    })
    .returning();
  return task;
}
async function addLink(
  s: Setup,
  taskId: string,
  values: Partial<typeof schema.externalLinkTable.$inferInsert> = {},
) {
  const [link] = await db
    .insert(schema.externalLinkTable)
    .values({
      taskId,
      integrationId: s.integration.id,
      resourceType: "issue",
      externalId: "5",
      url: "https://github.com/example/repo/issues/5",
      ...values,
    })
    .returning();
  return link;
}
async function linkMeta(id: string) {
  const link = await db.query.externalLinkTable.findFirst({
    where: eq(schema.externalLinkTable.id, id),
  });
  return JSON.parse(link?.metadata ?? "null");
}
async function taskOf(id: string) {
  return db.query.taskTable.findFirst({ where: eq(schema.taskTable.id, id) });
}

const repo = (id = 20) => ({
  id,
  owner: { login: "example" },
  name: "repo",
  full_name: "example/repo",
  html_url: "https://github.com/example/repo",
});
const inst = { id: 10 };

describe("GitHub webhook route authentication", () => {
  const opened = {
    action: "opened",
    issue: {
      number: 9,
      title: "Injected",
      body: "x",
      html_url: "https://github.com/example/repo/issues/9",
      user: { login: "octocat" },
    },
    installation: inst,
    repository: repo(),
  };

  it("rejects a request without a signature header", async () => {
    const r = await deliver("issues", opened, { "x-hub-signature-256": null });
    expect(r).toEqual({ status: 400, json: { error: "Missing signature" } });
  });

  it("rejects a request without an event header", async () => {
    const r = await deliver("issues", opened, { "x-github-event": null });
    expect(r).toEqual({ status: 400, json: { error: "Missing event name" } });
  });

  it("rejects a wrong-secret signature and a signature for another body without writing anything", async () => {
    await setup();
    const body = JSON.stringify(opened);
    const forged = await deliver("issues", opened, {
      "x-hub-signature-256": sign(body, "attacker-secret"),
    });
    const tampered = await deliver("issues", opened, {
      "x-hub-signature-256": sign(body.replace("Injected", "Original")),
    });
    const garbage = await deliver("issues", opened, {
      "x-hub-signature-256": "sha256=not-hex",
    });
    for (const r of [forged, tampered, garbage]) {
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.json)).not.toContain(GITHUB_WEBHOOK_SECRET);
      expect(JSON.stringify(r.json)).not.toContain("PRIVATE KEY");
      expect(JSON.stringify(r.json)).not.toContain(
        GITHUB_PRIVATE_KEY_PEM.slice(40, 120),
      );
    }
    expect(await db.query.taskTable.findMany()).toHaveLength(0);
    expect(await db.query.externalLinkTable.findMany()).toHaveLength(0);
  });

  it("rejects a correctly signed body that is not JSON", async () => {
    const r = await deliver("issues", null, {}, "{not json");
    expect(r.status).toBe(400);
    expect(typeof r.json.error).toBe("string");
  });

  it("accepts an event without handler (ping) and writes nothing", async () => {
    await setup();
    const r = await deliver("ping", { zen: "Keep it logically awesome." });
    expect(r).toEqual({ status: 200, json: { status: "success" } });
    expect(await db.query.taskTable.findMany()).toHaveLength(0);
  });

  it("accepts a signed delivery without a delivery id header", async () => {
    const r = await deliver("ping", { zen: "x" }, { "x-github-delivery": "" });
    expect(r.status).toBe(200);
  });
});

describe("GitHub webhook dispatch", () => {
  const events: Array<[string, string, Record<string, unknown>]> = [
    [
      "issues",
      "opened",
      {
        issue: { number: 1, title: "t", body: null, html_url: "u", user: null },
      },
    ],
    ["issues", "closed", { issue: { number: 1 } }],
    ["issues", "reopened", { issue: { number: 1 } }],
    [
      "issues",
      "labeled",
      { issue: { number: 1 }, label: { name: "x", color: "fff" } },
    ],
    [
      "issues",
      "unlabeled",
      { issue: { number: 1 }, label: { name: "x", color: "fff" } },
    ],
    [
      "issues",
      "edited",
      {
        issue: { number: 1, title: "t", body: "b" },
        changes: { title: { from: "a" } },
      },
    ],
    ["push", "", { ref: "refs/heads/feature-1" }],
    [
      "pull_request",
      "opened",
      {
        pull_request: { number: 1, title: "t", body: null, head: { ref: "f" } },
      },
    ],
    [
      "pull_request",
      "reopened",
      {
        pull_request: { number: 1, title: "t", body: null, head: { ref: "f" } },
      },
    ],
    ["pull_request", "closed", { pull_request: { number: 1 } }],
    ["label", "created", { label: { name: "x", color: "fff" } }],
    [
      "issue_comment",
      "created",
      { issue: { number: 1 }, comment: { body: "c", user: null } },
    ],
  ];

  it.each(events)(
    "%s.%s with a malformed payload (no repository) fails with 400 and no leak",
    async (event, action, extra) => {
      const r = await deliver(event, {
        ...(action ? { action } : {}),
        ...extra,
      });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.json)).not.toContain(GITHUB_WEBHOOK_SECRET);
      expect(await db.query.taskTable.findMany()).toHaveLength(0);
    },
  );

  it.each(events)(
    "%s.%s for a repository with no integration succeeds and writes nothing",
    async (event, action, extra) => {
      const s = await setup({ repositoryId: 20 });
      const task = await addTask(s);
      const r = await deliver(event, {
        ...(action ? { action } : {}),
        ...extra,
        installation: inst,
        repository: repo(999),
      });
      expect(r).toEqual({ status: 200, json: { status: "success" } });
      expect(await db.query.taskTable.findMany()).toEqual([task]);
      expect(await db.query.externalLinkTable.findMany()).toHaveLength(0);
      expect(await db.query.labelTable.findMany()).toHaveLength(0);
      expect(await db.query.activityTable.findMany()).toHaveLength(0);
    },
  );
});

describe("integration selection (workspace and binding scope)", () => {
  const payload = (installation: { id: number } | undefined, repoId = 20) => ({
    action: "labeled",
    issue: { number: 5, labels: [{ name: "priority:urgent" }] },
    label: { name: "priority:urgent", color: "fff" },
    ...(installation ? { installation } : {}),
    repository: repo(repoId),
  });

  it("applies a delivery only to the integration bound to that installation and repository", async () => {
    const a = await setup({ repositoryId: 20, installationId: 10 });
    const b = await setup({ repositoryId: 20, installationId: 11 });
    const c = await setup({ repositoryId: 21, installationId: 10 });
    const created = [];
    for (const s of [a, b, c]) {
      created.push(await addTask(s, { priority: "low" }));
    }
    // Only the mismatching integrations hold a link at first, so a handler that
    // ignores the installation or the repository would update them.
    await addLink(b, created[1].id);
    await addLink(c, created[2].id);
    expect((await deliver("issues", payload(inst))).status).toBe(200);
    expect((await taskOf(created[1].id))?.priority).toBe("low");
    expect((await taskOf(created[2].id))?.priority).toBe("low");
    // Positive control: the matching integration is updated.
    await addLink(a, created[0].id);
    await deliver("issues", payload(inst));
    expect((await taskOf(created[0].id))?.priority).toBe("urgent");
    expect((await taskOf(created[1].id))?.priority).toBe("low");
    expect((await taskOf(created[2].id))?.priority).toBe("low");
  });

  it.each([
    ["inactive", { isActive: false }],
    ["unverified legacy", { config: { verifiedByUserId: undefined } }],
    ["without repository id", { config: { repositoryId: undefined } }],
    ["with a corrupt config", { rawConfig: "{broken" }],
  ])("ignores a %s integration", async (_name, options) => {
    const s = await setup(options);
    const task = await addTask(s, { priority: "low" });
    await addLink(s, task.id);
    const r = await deliver("issues", payload(inst));
    expect(r.status).toBe(200);
    expect((await taskOf(task.id))?.priority).toBe("low");
  });

  it("ignores deliveries without an installation or with a non-integer repository id", async () => {
    const s = await setup();
    const task = await addTask(s, { priority: "low" });
    await addLink(s, task.id);
    const noInstallation = await deliver("issues", payload(undefined));
    const badRepo = await deliver("issues", {
      ...payload(inst),
      repository: { ...repo(), id: "20" },
    });
    expect(noInstallation.status).toBe(200);
    expect(badRepo.status).toBe(200);
    expect((await taskOf(task.id))?.priority).toBe("low");
  });
});

describe("issues.opened", () => {
  const issue = (over: Record<string, unknown> = {}) => ({
    number: 12,
    title: "Crash on save",
    body: "Steps\n\n---\n<sub>Task: other</sub>",
    html_url: "https://github.com/example/repo/issues/12",
    labels: [],
    user: { login: "octocat" },
    ...over,
  });
  const send = (over: Record<string, unknown> = {}) =>
    deliver("issues", {
      action: "opened",
      issue: issue(over),
      installation: inst,
      repository: repo(),
    });

  it("creates a task and a link, maps priority and status labels, and comments the task link", async () => {
    const s = await setup();
    const calls = stubGithub({
      "POST /repos/example/repo/issues/12/comments": { status: 201, body: {} },
    });
    const r = await send({
      labels: [
        { name: "priority:high" },
        "status:in-progress",
        { name: "bug" },
      ],
    });
    expect(r.status).toBe(200);
    const tasks = await db.query.taskTable.findMany();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      projectId: s.project.id,
      title: "Crash on save",
      priority: "high",
      status: "in-progress",
      number: 1,
      userId: null,
    });
    expect(tasks[0].columnId).toBe(s.columns.inProgress.id);
    const links = await db.query.externalLinkTable.findMany();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      taskId: tasks[0].id,
      integrationId: s.integration.id,
      resourceType: "issue",
      externalId: "12",
    });
    expect(JSON.parse(links[0].metadata ?? "")).toEqual({
      state: "open",
      createdFrom: "github",
      author: "octocat",
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /repos/example/repo/issues/12/comments",
    ]);
    expect(calls[0].body).toEqual({
      body: `[${s.project.slug.toUpperCase()}-1](https://kaneo.test/dashboard/workspace/${s.workspaceId}/project/${s.project.id}/task/${tasks[0].id})`,
    });
  });

  it("is idempotent for a redelivered issue", async () => {
    await setup();
    await send();
    await send();
    expect(await db.query.taskTable.findMany()).toHaveLength(1);
    expect(await db.query.externalLinkTable.findMany()).toHaveLength(1);
  });

  it("adds the missing priority and status labels to the GitHub issue and honours the no-comment setting", async () => {
    await setup({ config: { commentTaskLinkOnGitHubIssue: false } });
    const calls = stubGithub({
      "GET /repos/example/repo/labels/priority:high": { body: {} },
      "GET /repos/example/repo/labels/status:in-progress": { body: {} },
      "POST /repos/example/repo/issues/12/labels": { body: [] },
    });
    await send({ labels: [{ name: "priority:high" }, "status:in-progress"] });
    expect(calls.some((c) => c.path.endsWith("/comments"))).toBe(false);
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("does not create a task for an issue opened by the configured GitHub App", async () => {
    await setup();
    vi.stubEnv("GITHUB_APP_NAME", "kaneo-app");
    const calls = stubGithub();
    await send({ user: { login: "kaneo-app[bot]" } });
    expect(await db.query.taskTable.findMany()).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  it("keeps the created task when the GitHub comment call fails", async () => {
    await setup();
    stubGithub({
      "POST /repos/example/repo/issues/12/comments": { status: 403, body: {} },
    });
    const r = await send();
    expect(r.status).toBe(200);
    expect(await db.query.taskTable.findMany()).toHaveLength(1);
  });

  it("falls back to the default status when the status label names no column", async () => {
    await setup();
    stubGithub();
    await send({ labels: ["status:does-not-exist"] });
    const [task] = await db.query.taskTable.findMany();
    expect(task.status).toBe("to-do");
  });
});

describe("issues.closed and issues.reopened", () => {
  const closed = (number = 5) => ({
    action: "closed",
    issue: { number, title: "t", html_url: "u", state: "closed" },
    installation: inst,
    repository: repo(),
  });

  it("moves a GitHub-created task to done, records the state and publishes one status event", async () => {
    const s = await setup();
    const task = await addTask(s, { status: "to-do" });
    const link = await addLink(s, task.id, {
      metadata: JSON.stringify({ createdFrom: "github", state: "open" }),
    });
    const r = await deliver("issues", closed());
    expect(r.status).toBe(200);
    expect((await taskOf(task.id))?.status).toBe("done");
    expect(await linkMeta(link.id)).toEqual({
      createdFrom: "github",
      state: "closed",
    });
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]).toMatchObject({
      taskId: task.id,
      oldStatus: "to-do",
      newStatus: "done",
    });
  });

  it("uses a workflow rule for the close transition", async () => {
    const s = await setup();
    const task = await addTask(s);
    await addLink(s, task.id);
    const review = s.columns.inReview;
    await db.insert(schema.workflowRuleTable).values({
      projectId: s.project.id,
      integrationType: "github",
      eventType: "issue_closed",
      columnId: review.id,
    });
    await deliver("issues", closed());
    expect((await taskOf(task.id))?.status).toBe("in-review");
  });

  it("ignores issues that Kaneo created, unknown issue numbers and a task already in the target status", async () => {
    const s = await setup();
    const kaneoTask = await addTask(s, { number: 1 });
    await addLink(s, kaneoTask.id, {
      metadata: JSON.stringify({ createdFrom: "kaneo" }),
    });
    expect((await deliver("issues", closed())).status).toBe(200);
    expect((await taskOf(kaneoTask.id))?.status).toBe("to-do");

    expect((await deliver("issues", closed(404))).status).toBe(200);

    const doneTask = await addTask(s, { number: 2, status: "done" });
    await addLink(s, doneTask.id, { externalId: "6" });
    await deliver("issues", closed(6));
    expect(statusEvents).toHaveLength(0);
  });

  it("reopens a closed GitHub-created task to the default column and records the state", async () => {
    const s = await setup();
    const task = await addTask(s, { status: "done" });
    const link = await addLink(s, task.id, {
      metadata: JSON.stringify({ createdFrom: "github", state: "closed" }),
    });
    const r = await deliver("issues", { ...closed(), action: "reopened" });
    expect(r.status).toBe(200);
    expect((await taskOf(task.id))?.status).toBe("to-do");
    expect((await linkMeta(link.id)).state).toBe("open");
    expect(statusEvents).toHaveLength(1);
  });

  it("tolerates unparseable link metadata", async () => {
    const s = await setup();
    const task = await addTask(s);
    const link = await addLink(s, task.id, { metadata: "{broken" });
    expect((await deliver("issues", closed())).status).toBe(200);
    expect((await taskOf(task.id))?.status).toBe("done");
    expect(await linkMeta(link.id)).toEqual({ state: "closed" });
  });
});

describe("issues.labeled and issues.unlabeled", () => {
  const labeled = (
    action: "labeled" | "unlabeled",
    label: { name: string; color: string } | undefined,
    labels: Array<string | { name: string }> = [],
    number = 5,
  ) => ({
    action,
    issue: { number, labels },
    ...(label ? { label } : {}),
    installation: inst,
    repository: repo(),
  });

  it("applies priority and an existing status column from the issue labels", async () => {
    const s = await setup();
    const task = await addTask(s, { priority: "low" });
    await addLink(s, task.id);
    await deliver(
      "issues",
      labeled("labeled", { name: "status:in-review", color: "fff" }, [
        "priority:medium",
        { name: "status:in-review" },
      ]),
    );
    const stored = await taskOf(task.id);
    expect(stored?.priority).toBe("medium");
    expect(stored?.status).toBe("in-review");
    expect(stored?.columnId).toBe(s.columns.inReview.id);
    expect(statusEvents).toHaveLength(1);
    expect(await db.query.labelTable.findMany()).toHaveLength(0);
  });

  it("ignores an unknown status column and an invalid priority", async () => {
    const s = await setup();
    const task = await addTask(s, { priority: "low", status: "to-do" });
    await addLink(s, task.id);
    await deliver(
      "issues",
      labeled("labeled", { name: "status:nowhere", color: "fff" }, [
        "priority:extreme",
        "status:nowhere",
      ]),
    );
    const stored = await taskOf(task.id);
    expect(stored?.priority).toBe("low");
    expect(stored?.status).toBe("to-do");
    expect(statusEvents).toHaveLength(0);
  });

  it("creates a task label once with the GitHub color and ignores a repeated delivery", async () => {
    const s = await setup();
    const task = await addTask(s);
    await addLink(s, task.id);
    const body = labeled("labeled", { name: "bug", color: "d73a4a" }, ["bug"]);
    await deliver("issues", body);
    await deliver("issues", body);
    const labels = await db.query.labelTable.findMany();
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      name: "bug",
      color: "#d73a4a",
      taskId: task.id,
      workspaceId: s.workspaceId,
    });
  });

  it("falls back to the default color when GitHub sends none", async () => {
    const s = await setup();
    const task = await addTask(s);
    await addLink(s, task.id);
    await deliver("issues", labeled("labeled", { name: "bug", color: "" }));
    expect((await db.query.labelTable.findMany())[0].color).toBe("#6B7280");
  });

  it("does not create labels for priority: or status: labels", async () => {
    const s = await setup();
    const task = await addTask(s);
    await addLink(s, task.id);
    await deliver(
      "issues",
      labeled("labeled", { name: "priority:high", color: "fff" }),
    );
    await deliver(
      "issues",
      labeled("unlabeled", { name: "status:done", color: "fff" }),
    );
    expect(await db.query.labelTable.findMany()).toHaveLength(0);
  });

  it("returns after priority and status when the payload has no label", async () => {
    const s = await setup();
    const task = await addTask(s, { priority: "low" });
    await addLink(s, task.id);
    await deliver("issues", labeled("labeled", undefined, ["priority:high"]));
    expect((await taskOf(task.id))?.priority).toBe("high");
    expect(await db.query.labelTable.findMany()).toHaveLength(0);
  });

  it("removes only the named label of the linked task on unlabeled", async () => {
    const s = await setup();
    const task = await addTask(s);
    const other = await addTask(s, { number: 8 });
    await addLink(s, task.id);
    const insert = (taskId: string, name: string) =>
      db.insert(schema.labelTable).values({
        name,
        color: "#fff",
        taskId,
        workspaceId: s.workspaceId,
      });
    await insert(task.id, "bug");
    await insert(task.id, "keep");
    await insert(other.id, "bug");
    await deliver(
      "issues",
      labeled("unlabeled", { name: "bug", color: "fff" }),
    );
    const left = (await db.query.labelTable.findMany())
      .map((l) => `${l.taskId === task.id ? "task" : "other"}:${l.name}`)
      .sort();
    expect(left).toEqual(["other:bug", "task:keep"]);
  });

  it("does nothing for an issue that is not linked", async () => {
    const s = await setup();
    await addTask(s);
    await deliver(
      "issues",
      labeled("labeled", { name: "bug", color: "fff" }, ["bug"], 404),
    );
    expect(await db.query.labelTable.findMany()).toHaveLength(0);
  });
});

describe("issues.edited", () => {
  const edited = (
    issue: { title?: string; body?: string | null },
    changes: Record<string, { from: string }> | undefined,
  ) => ({
    action: "edited",
    issue: {
      number: 5,
      title: "Linked task",
      body: "Body",
      html_url: "u",
      ...issue,
    },
    ...(changes ? { changes } : {}),
    installation: inst,
    repository: repo(),
  });
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it("updates the task title and records a github-sourced stamp", async () => {
    const s = await setup();
    const task = await addTask(s);
    const link = await addLink(s, task.id, {
      metadata: JSON.stringify({ createdFrom: "kaneo" }),
    });
    const r = await deliver(
      "issues",
      edited(
        { title: "Renamed on GitHub" },
        { title: { from: "Linked task" } },
      ),
    );
    expect(r.status).toBe(200);
    expect((await taskOf(task.id))?.title).toBe("Renamed on GitHub");
    const meta = await linkMeta(link.id);
    expect(meta.createdFrom).toBe("kaneo");
    expect(meta.lastSync.title).toMatchObject({
      source: "github",
      value: "Renamed on GitHub",
    });
  });

  it("stores an empty description for a GitHub issue emptied of text", async () => {
    const s = await setup();
    const task = await addTask(s, { description: "Old" });
    await addLink(s, task.id);
    await deliver("issues", edited({ body: null }, { body: { from: "Old" } }));
    expect((await taskOf(task.id))?.description).toBe("");
  });

  it("does nothing when neither title nor body changed", async () => {
    const s = await setup();
    const task = await addTask(s);
    const link = await addLink(s, task.id);
    await deliver("issues", edited({ title: "Other" }, undefined));
    await deliver("issues", edited({ title: "Other" }, {} as never));
    expect((await taskOf(task.id))?.title).toBe("Linked task");
    expect(await linkMeta(link.id)).toBeNull();
  });

  it("ignores the echo of a title Kaneo just pushed and any change within two seconds", async () => {
    const s = await setup();
    const task = await addTask(s);
    const link = await addLink(s, task.id, {
      metadata: JSON.stringify({
        lastSync: {
          title: { source: "kaneo", value: "Pushed", timestamp: ago(60_000) },
        },
      }),
    });
    await deliver(
      "issues",
      edited({ title: "Pushed" }, { title: { from: "x" } }),
    );
    expect((await taskOf(task.id))?.title).toBe("Linked task");

    await db
      .update(schema.externalLinkTable)
      .set({
        metadata: JSON.stringify({
          lastSync: {
            title: { source: "kaneo", value: "Earlier", timestamp: ago(200) },
          },
        }),
      })
      .where(eq(schema.externalLinkTable.id, link.id));
    await deliver(
      "issues",
      edited({ title: "Fresh" }, { title: { from: "x" } }),
    );
    expect((await taskOf(task.id))?.title).toBe("Linked task");
  });

  it("accepts a title edit after the two-second window from another value", async () => {
    const s = await setup();
    const task = await addTask(s);
    await addLink(s, task.id, {
      metadata: JSON.stringify({
        lastSync: {
          title: { source: "kaneo", value: "Earlier", timestamp: ago(10_000) },
        },
      }),
    });
    await deliver(
      "issues",
      edited({ title: "Fresh" }, { title: { from: "x" } }),
    );
    expect((await taskOf(task.id))?.title).toBe("Fresh");
  });

  it("skips a description edit within two seconds of the previous sync", async () => {
    const s = await setup();
    const task = await addTask(s, { description: "Old" });
    await addLink(s, task.id, {
      metadata: JSON.stringify({
        lastSync: {
          description: { source: "kaneo", value: "Z", timestamp: ago(100) },
        },
      }),
    });
    await deliver("issues", edited({ body: "New" }, { body: { from: "Old" } }));
    expect((await taskOf(task.id))?.description).toBe("Old");
  });

  it("does nothing for an issue that is not linked", async () => {
    const s = await setup();
    const task = await addTask(s);
    const r = await deliver("issues", {
      ...edited({ title: "x" }, { title: { from: "y" } }),
      issue: { number: 404, title: "x", body: "b", html_url: "u" },
    });
    expect(r.status).toBe(200);
    expect((await taskOf(task.id))?.title).toBe("Linked task");
  });
});

describe("issue_comment.created", () => {
  const comment = (over: Record<string, unknown> = {}, action = "created") => ({
    action,
    issue: { number: 5 },
    comment: {
      id: 1,
      body: "Thanks!",
      html_url: "https://github.com/example/repo/issues/5#issuecomment-1",
      user: { login: "octocat", avatar_url: "https://avatars/octocat" },
      created_at: "2025-01-01T00:00:00Z",
      ...over,
    },
    installation: inst,
    repository: repo(),
  });

  it("stores the comment as external activity once per URL", async () => {
    const s = await setup();
    const task = await addTask(s);
    await addLink(s, task.id);
    await deliver("issue_comment", comment());
    await deliver("issue_comment", comment());
    const rows = await db.query.activityTable.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskId: task.id,
      type: "comment",
      content: "Thanks!",
      externalUserName: "octocat",
      externalUserAvatar: "https://avatars/octocat",
      externalSource: "github",
      externalUrl: "https://github.com/example/repo/issues/5#issuecomment-1",
    });
  });

  it("labels a comment without user as Unknown", async () => {
    const s = await setup();
    const task = await addTask(s);
    await addLink(s, task.id);
    await deliver("issue_comment", comment({ user: null }));
    const [row] = await db.query.activityTable.findMany();
    expect(row.externalUserName).toBe("Unknown");
    expect(row.externalUserAvatar).toBeNull();
  });

  it("ignores bot comments, edited comments and unlinked issues", async () => {
    const s = await setup();
    const task = await addTask(s);
    await addLink(s, task.id);
    await deliver(
      "issue_comment",
      comment({ user: { login: "kaneo[bot]", avatar_url: "a" } }),
    );
    await deliver("issue_comment", comment({}, "edited"));
    await deliver("issue_comment", { ...comment(), issue: { number: 404 } });
    expect(await db.query.activityTable.findMany()).toHaveLength(0);
  });
});

describe("label.created", () => {
  const created = (name: string, color: string) => ({
    action: "created",
    label: { name, color },
    installation: inst,
    repository: repo(),
  });

  it("creates a workspace label with the GitHub color, only in the integration's workspace", async () => {
    const s = await setup();
    const other = await setup({ repositoryId: 77 });
    await deliver("label", created("bug", "d73a4a"));
    const labels = await db.query.labelTable.findMany();
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      name: "bug",
      color: "#d73a4a",
      workspaceId: s.workspaceId,
      taskId: null,
    });
    expect(labels[0].workspaceId).not.toBe(other.workspaceId);
  });

  it("does not duplicate an existing label and defaults the color", async () => {
    const s = await setup();
    await db.insert(schema.labelTable).values({
      name: "bug",
      color: "#000000",
      workspaceId: s.workspaceId,
    });
    await deliver("label", created("bug", "d73a4a"));
    await deliver("label", created("docs", ""));
    const labels = await db.query.labelTable.findMany();
    expect(labels.map((l) => [l.name, l.color]).sort()).toEqual([
      ["bug", "#000000"],
      ["docs", "#6B7280"],
    ]);
  });
});

describe("push", () => {
  const push = (ref: string, over: Record<string, unknown> = {}) => ({
    ref,
    head_commit: {
      id: "abc123",
      message: "wip",
      author: { name: "Dev" },
      timestamp: "2025-01-01T00:00:00Z",
    },
    installation: inst,
    repository: repo(),
    ...over,
  });
  const branchFor = (s: Setup, n = 7, suffix = "") =>
    `${s.project.slug}-${n}${suffix}`;

  it("links the branch to the task and moves it to in-progress", async () => {
    const s = await setup();
    const task = await addTask(s);
    const branch = branchFor(s, 7, "-part-1");
    const r = await deliver("push", push(`refs/heads/${branch}`));
    expect(r.status).toBe(200);
    const [link] = await db.query.externalLinkTable.findMany();
    expect(link).toMatchObject({
      taskId: task.id,
      integrationId: s.integration.id,
      resourceType: "branch",
      externalId: branch,
      url: `https://github.com/example/repo/tree/${branch}`,
      title: branch,
    });
    expect(JSON.parse(link.metadata ?? "")).toEqual({
      lastCommit: {
        sha: "abc123",
        message: "wip",
        author: "Dev",
        timestamp: "2025-01-01T00:00:00Z",
      },
    });
    const stored = await taskOf(task.id);
    expect(stored?.status).toBe("in-progress");
    expect(stored?.columnId).toBe(s.columns.inProgress.id);
    expect(statusEvents).toHaveLength(1);
  });

  it("updates the existing branch link on a second push and stores a null last commit when absent", async () => {
    const s = await setup();
    const task = await addTask(s, { status: "in-progress" });
    const branch = branchFor(s);
    await deliver("push", push(`refs/heads/${branch}`));
    await deliver(
      "push",
      push(`refs/heads/${branch}`, { head_commit: undefined }),
    );
    const links = await db.query.externalLinkTable.findMany();
    expect(links).toHaveLength(1);
    expect(JSON.parse(links[0].metadata ?? "")).toEqual({ lastCommit: null });
    expect(statusEvents).toHaveLength(0);
    expect((await taskOf(task.id))?.status).toBe("in-progress");
  });

  it("keeps a task in a final column but still links the branch", async () => {
    const s = await setup();
    const task = await addTask(s, { status: "done" });
    await deliver("push", push(`refs/heads/${branchFor(s)}`));
    expect((await taskOf(task.id))?.status).toBe("done");
    expect(await db.query.externalLinkTable.findMany()).toHaveLength(1);
  });

  it("uses a workflow rule and the configured onBranchPush status", async () => {
    const s = await setup({
      config: { statusTransitions: { onBranchPush: "in-review" } },
    });
    const task = await addTask(s);
    await deliver("push", push(`refs/heads/${branchFor(s)}`));
    expect((await taskOf(task.id))?.status).toBe("in-review");
  });

  it.each(["main", "master", "develop", "staging", "production"])(
    "ignores pushes to protected branch %s",
    async (name) => {
      const s = await setup({ config: { branchPattern: "{number}" } });
      await addTask(s, { number: 7 });
      await deliver("push", push(`refs/heads/${name}`));
      await deliver("push", push("refs/heads/7"));
      expect(await db.query.externalLinkTable.findMany()).toHaveLength(1);
    },
  );

  it("ignores branches that match no pattern or name an unknown task", async () => {
    const s = await setup();
    const task = await addTask(s);
    await deliver("push", push("refs/heads/random-branch"));
    await deliver("push", push(`refs/heads/${branchFor(s, 99)}`));
    expect(await db.query.externalLinkTable.findMany()).toHaveLength(0);
    expect((await taskOf(task.id))?.status).toBe("to-do");
  });

  it("does not touch tasks of another project that shares the task number", async () => {
    const a = await setup({ repositoryId: 20 });
    const b = await setup({ repositoryId: 55 });
    const taskA = await addTask(a);
    const taskB = await addTask(b);
    await deliver("push", push(`refs/heads/${branchFor(a)}`));
    expect((await taskOf(taskA.id))?.status).toBe("in-progress");
    expect((await taskOf(taskB.id))?.status).toBe("to-do");
  });

  it("resolves each project by its own slug prefix", async () => {
    const first = await setup();
    const second = await setup({ slug: "other-slug" });
    const t1 = await addTask(first);
    const t2 = await addTask(second);
    await deliver("push", push(`refs/heads/${branchFor(first)}`));
    await deliver("push", push("refs/heads/other-slug-7"));
    expect((await taskOf(t1.id))?.status).toBe("in-progress");
    expect((await taskOf(t2.id))?.status).toBe("in-progress");
  });
});

describe("pull_request events", () => {
  const pr = (over: Record<string, unknown> = {}) => ({
    number: 31,
    title: "Fix",
    body: null,
    html_url: "https://github.com/example/repo/pull/31",
    state: "open",
    draft: false,
    merged: false,
    merged_at: null,
    head: { ref: "feature" },
    user: { login: "octocat" },
    ...over,
  });
  const send = (
    action: string,
    _s: Setup,
    over: Record<string, unknown> = {},
  ) =>
    deliver("pull_request", {
      action,
      pull_request: pr(over),
      installation: inst,
      repository: repo(),
    });

  it("links an opened PR by branch name and moves the task to in-review; reopened is idempotent", async () => {
    const s = await setup();
    const task = await addTask(s);
    const head = { ref: `${s.project.slug}-7` };
    await send("opened", s, { head });
    await send("reopened", s, { head });
    const links = await db.query.externalLinkTable.findMany();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      resourceType: "pull_request",
      externalId: "31",
      taskId: task.id,
    });
    expect((await taskOf(task.id))?.status).toBe("in-review");
  });

  it("marks the link closed on merge and moves the task to done", async () => {
    const s = await setup();
    const task = await addTask(s, { status: "in-review" });
    const link = await addLink(s, task.id, {
      resourceType: "pull_request",
      externalId: "31",
      metadata: JSON.stringify({ state: "open" }),
    });
    await send("closed", s, {
      merged: true,
      merged_at: "2025-02-02T00:00:00Z",
      state: "closed",
    });
    expect(await linkMeta(link.id)).toEqual({
      state: "closed",
      merged: true,
      mergedAt: "2025-02-02T00:00:00Z",
    });
    expect((await taskOf(task.id))?.status).toBe("done");
  });

  it("keeps the task open while another PR for it is still open", async () => {
    const s = await setup();
    const task = await addTask(s, { status: "in-review" });
    await addLink(s, task.id, {
      resourceType: "pull_request",
      externalId: "31",
      metadata: JSON.stringify({ state: "open" }),
    });
    await addLink(s, task.id, {
      resourceType: "pull_request",
      externalId: "32",
      metadata: JSON.stringify({ state: "open" }),
    });
    await send("closed", s, { merged: true, merged_at: "x", state: "closed" });
    expect((await taskOf(task.id))?.status).toBe("in-review");
  });

  it("closing without merge only records the state", async () => {
    const s = await setup();
    const task = await addTask(s, { status: "in-review" });
    const link = await addLink(s, task.id, {
      resourceType: "pull_request",
      externalId: "31",
    });
    await send("closed", s, { merged: false, state: "closed" });
    expect((await linkMeta(link.id)).merged).toBe(false);
    expect((await taskOf(task.id))?.status).toBe("in-review");
  });

  it("ignores a closed PR that was never linked", async () => {
    const s = await setup();
    const task = await addTask(s, { status: "in-review" });
    await send("closed", s, { merged: true, state: "closed" });
    expect((await taskOf(task.id))?.status).toBe("in-review");
  });
});

describe("remaining webhook guards", () => {
  it("ignores a reopened issue that is not linked", async () => {
    const s = await setup();
    const task = await addTask(s, { status: "done" });
    await addLink(s, task.id);
    const r = await deliver("issues", {
      action: "reopened",
      issue: { number: 404, title: "t", html_url: "u", state: "open" },
      installation: inst,
      repository: repo(),
    });
    expect(r.status).toBe(200);
    expect((await taskOf(task.id))?.status).toBe("done");
    expect(statusEvents).toHaveLength(0);
  });

  it("stores nothing for a comment event whose action is not created", async () => {
    const s = await setup();
    const task = await addTask(s);
    await addLink(s, task.id);
    await handleIssueCommentCreated({
      action: "edited",
      issue: { number: 5 },
      comment: {
        id: 1,
        body: "edited text",
        html_url: "https://github.com/example/repo/issues/5#issuecomment-1",
        user: { login: "octocat", avatar_url: "a" },
        created_at: "2025-01-01T00:00:00Z",
      },
      installation: inst,
      repository: repo(),
    });
    expect(await db.query.activityTable.findMany()).toHaveLength(0);
  });

  it("adds the normalized status label to a new issue whose own status label was spelled differently", async () => {
    const s = await setup({ config: { commentTaskLinkOnGitHubIssue: false } });
    const calls = stubGithub({
      "GET /repos/example/repo/labels/status:in-progress": { body: {} },
      "POST /repos/example/repo/issues/12/labels": { body: [] },
    });
    await deliver("issues", {
      action: "opened",
      issue: {
        number: 12,
        title: "Spelled",
        body: null,
        html_url: "https://github.com/example/repo/issues/12",
        labels: [{ name: "status: In-Progress" }],
        user: { login: "octocat" },
      },
      installation: inst,
      repository: repo(),
    });
    const [task] = await db.query.taskTable.findMany();
    expect(task.status).toBe("in-progress");
    expect(task.projectId).toBe(s.project.id);
    expect(
      calls.find((c) => c.path === "/repos/example/repo/issues/12/labels")
        ?.body,
    ).toEqual({ labels: ["status:in-progress"] });
  });

  it.each([
    [
      "is deactivated",
      "UPDATE integration SET is_active = false WHERE id = $1",
    ],
    [
      "has its binding changed",
      "UPDATE integration SET config = config || ' ' WHERE id = $1",
    ],
  ])(
    "creates no task when the integration %s after the webhook looked it up",
    async (_name, statement) => {
      const s = await setup();
      const pool = getDatabasePool();
      const holder = await pool.connect();
      try {
        await holder.query("BEGIN");
        await holder.query(statement, [s.integration.id]);
        const pending = handleIssueOpened({
          action: "opened",
          issue: {
            number: 12,
            title: "Racy",
            body: null,
            html_url: "https://github.com/example/repo/issues/12",
            labels: [],
            user: { login: "octocat" },
          },
          installation: inst,
          repository: repo(),
        });
        // The handler has read the integration and now waits for its row lock.
        await vi.waitFor(async () => {
          const { rows } = await pool.query(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()",
          );
          expect(rows[0].n).toBeGreaterThan(0);
        });
        await holder.query("COMMIT");
        await pending;
      } finally {
        holder.release();
      }
      expect(await db.query.taskTable.findMany()).toHaveLength(0);
      expect(await db.query.externalLinkTable.findMany()).toHaveLength(0);
    },
  );
});
