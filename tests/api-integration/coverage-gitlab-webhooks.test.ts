import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { handleGitlabWebhookRoute } from "../../apps/api/src/gitlab-integration";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const BASE_URL = "https://203.0.113.10";
const SECRET = "whsec-0123456789abcdef";
const ACCESS_TOKEN = "glpat-super-secret-access-token";

type Env = Awaited<ReturnType<typeof setup>>;

async function setup(options?: {
  projectPath?: string;
  webhookSecret?: string | null;
  config?: Record<string, unknown>;
}) {
  const member = await createWorkspaceMember();
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
    slug: "kan",
  });
  const projectPath = options?.projectPath ?? "group/project";
  const [integration] = await db
    .insert(schema.integrationTable)
    .values({
      projectId: project.id,
      type: "gitlab",
      isActive: true,
      config: JSON.stringify({
        baseUrl: BASE_URL,
        projectPath,
        accessToken: ACCESS_TOKEN,
        ...(options?.webhookSecret === null
          ? {}
          : { webhookSecret: options?.webhookSecret ?? SECRET }),
        ...options?.config,
      }),
    })
    .returning();
  const { app } = createApp();
  return { app, member, project, columns, integration, projectPath };
}

function post(
  env: { app: ReturnType<typeof createApp>["app"] },
  integrationId: string,
  body: unknown,
  token: string | null = SECRET,
) {
  return env.app.request(`/api/gitlab-integration/webhook/${integrationId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token === null ? {} : { "X-Gitlab-Token": token }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function projectPayload(projectPath = "group/project") {
  return {
    name: "project",
    web_url: `${BASE_URL}/${projectPath}`,
    path_with_namespace: projectPath,
  };
}

async function addTask(
  env: Env,
  number: number,
  overrides: Partial<typeof schema.taskTable.$inferInsert> = {},
) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: env.project.id,
      title: `Task ${number}`,
      number,
      status: "to-do",
      columnId: env.columns.todo.id,
      ...overrides,
    })
    .returning();
  return task;
}

async function taskById(id: string) {
  const task = await db.query.taskTable.findFirst({
    where: eq(schema.taskTable.id, id),
  });
  if (!task) throw new Error("task missing");
  return task;
}

async function linksOf(taskId: string) {
  return db.query.externalLinkTable.findMany({
    where: eq(schema.externalLinkTable.taskId, taskId),
  });
}

async function allLinks() {
  return db.select().from(schema.externalLinkTable);
}

function metadataOf(link: { metadata: string | null }) {
  return JSON.parse(link.metadata ?? "null");
}

beforeEach(async () => {
  await resetTestDatabase();
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GitLab webhook route: authentication and request validation", () => {
  it("rejects an unknown integration id without side effects", async () => {
    const env = await setup();
    const task = await addTask(env, 1);

    const response = await post(env, randomUUID(), {
      object_kind: "push",
      ref: "refs/heads/kan-1",
      project: projectPayload(),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "GitLab integration not found",
    });
    expect(await allLinks()).toEqual([]);
    expect((await taskById(task.id)).status).toBe("to-do");
  });

  it("does not treat an integration of another type as a GitLab one", async () => {
    const env = await setup();
    const [other] = await db
      .insert(schema.integrationTable)
      .values({
        projectId: (
          await createProjectFixture({ workspaceId: env.member.workspace.id })
        ).project.id,
        type: "gitea",
        isActive: true,
        config: JSON.stringify({ webhookSecret: SECRET }),
      })
      .returning();

    const response = await post(env, other.id, {
      object_kind: "push",
      ref: "refs/heads/kan-1",
      project: projectPayload(),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "GitLab integration not found",
    });
  });

  it("rejects an integration whose stored config is not JSON", async () => {
    const env = await setup();
    await db
      .update(schema.integrationTable)
      .set({ config: "{not json" })
      .where(eq(schema.integrationTable.id, env.integration.id));

    const response = await post(env, env.integration.id, {
      object_kind: "push",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid integration config",
    });
  });

  it("refuses every request while no webhook secret is configured", async () => {
    const env = await setup({ webhookSecret: null });

    for (const token of [null, "", "anything"]) {
      const response = await post(
        env,
        env.integration.id,
        { object_kind: "push" },
        token,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Webhook secret not configured",
      });
    }
  });

  it.each([
    { name: "a missing token", token: null },
    { name: "an empty token", token: "" },
    {
      name: "a wrong token of the same length",
      token: "x".repeat(SECRET.length),
    },
    { name: "a prefix of the secret", token: SECRET.slice(0, -1) },
    { name: "the secret with extra characters", token: `${SECRET}0` },
    { name: "the access token instead of the secret", token: ACCESS_TOKEN },
  ])("rejects $name and changes nothing", async ({ token }) => {
    const env = await setup();
    const task = await addTask(env, 1);

    const response = await post(
      env,
      env.integration.id,
      {
        object_kind: "push",
        ref: "refs/heads/kan-1",
        project: projectPayload(),
      },
      token,
    );

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "Invalid webhook token" });
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(ACCESS_TOKEN);
    expect(await allLinks()).toEqual([]);
    expect((await taskById(task.id)).status).toBe("to-do");
  });

  it("rejects a body that is not JSON after the token check", async () => {
    const env = await setup();

    const response = await post(env, env.integration.id, "{oops");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON payload" });
  });

  it.each([
    { name: "no object_kind", body: { ref: "refs/heads/x" } },
    { name: "a numeric object_kind", body: { object_kind: 5 } },
  ])("rejects a payload with $name", async ({ body }) => {
    const env = await setup();

    const response = await post(env, env.integration.id, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Missing object_kind" });
  });

  it("acknowledges an event kind it does not handle without changing data", async () => {
    const env = await setup();
    const task = await addTask(env, 1);

    const response = await post(env, env.integration.id, {
      object_kind: "pipeline",
      project: projectPayload(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "success" });
    expect(await allLinks()).toEqual([]);
    expect((await taskById(task.id)).status).toBe("to-do");
  });

  it("answers 500 with a generic message when a handler fails on a malformed payload", async () => {
    // characterization: a merge request payload without iid is the sender's
    // fault, yet it surfaces as a server error. The body must still not leak
    // the exception text or any secret.
    const env = await setup();

    const response = await post(env, env.integration.id, {
      object_kind: "merge_request",
      object_attributes: { action: "merge", title: "x", url: "u", state: "m" },
      project: projectPayload(),
    });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "Webhook handler failed" });
    expect(text).not.toContain("TypeError");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(ACCESS_TOKEN);
  });

  it("ignores payloads that lack the fields an event kind needs", async () => {
    const env = await setup();
    const task = await addTask(env, 1);

    for (const body of [
      { object_kind: "push", project: projectPayload() },
      { object_kind: "push", ref: "refs/heads/kan-1" },
      { object_kind: "issue", project: projectPayload() },
      { object_kind: "merge_request", object_attributes: { action: "merge" } },
      { object_kind: "note", project: projectPayload() },
    ]) {
      const response = await post(env, env.integration.id, body);
      expect(response.status).toBe(200);
    }

    expect(await allLinks()).toEqual([]);
    expect((await taskById(task.id)).status).toBe("to-do");
  });
});

describe("GitLab webhook route: project and workspace scope", () => {
  it("does not apply an event for another GitLab project to the signed integration", async () => {
    const env = await setup();
    const task = await addTask(env, 1);

    const response = await post(env, env.integration.id, {
      object_kind: "push",
      ref: "refs/heads/kan-1",
      project: projectPayload("someone/else"),
    });

    expect(response.status).toBe(200);
    expect(await allLinks()).toEqual([]);
    expect((await taskById(task.id)).status).toBe("to-do");
  });

  it("does not touch another workspace that links the same GitLab project", async () => {
    const env = await setup();
    const ownTask = await addTask(env, 1);
    const foreign = await setup({ webhookSecret: "foreign-secret" });
    const foreignTask = await addTask(foreign, 1);

    const response = await post(env, env.integration.id, {
      object_kind: "push",
      ref: "refs/heads/kan-1",
      project: projectPayload(),
    });

    expect(response.status).toBe(200);
    expect((await taskById(ownTask.id)).status).toBe("in-progress");
    expect(await linksOf(foreignTask.id)).toEqual([]);
    expect((await taskById(foreignTask.id)).status).toBe("to-do");
  });

  it("does not accept the secret of another integration", async () => {
    const env = await setup();
    const foreign = await setup({ webhookSecret: "foreign-secret" });
    const task = await addTask(env, 1);

    const response = await post(
      env,
      env.integration.id,
      {
        object_kind: "push",
        ref: "refs/heads/kan-1",
        project: projectPayload(),
      },
      "foreign-secret",
    );

    expect(response.status).toBe(400);
    expect(foreign.integration.id).not.toBe(env.integration.id);
    expect((await taskById(task.id)).status).toBe("to-do");
  });

  it("ignores an event for a disabled integration", async () => {
    const env = await setup();
    const task = await addTask(env, 1);
    await db
      .update(schema.integrationTable)
      .set({ isActive: false })
      .where(eq(schema.integrationTable.id, env.integration.id));

    const response = await post(env, env.integration.id, {
      object_kind: "push",
      ref: "refs/heads/kan-1",
      project: projectPayload(),
    });

    expect(response.status).toBe(200);
    expect(await allLinks()).toEqual([]);
    expect((await taskById(task.id)).status).toBe("to-do");
  });

  it("ignores a project whose web_url does not end with its path", async () => {
    const env = await setup();
    const task = await addTask(env, 1);

    for (const project of [
      {
        name: "p",
        web_url: `${BASE_URL}/other/place`,
        path_with_namespace: "group/project",
      },
      { name: "p", web_url: "not a url", path_with_namespace: "group/project" },
    ]) {
      const response = await post(env, env.integration.id, {
        object_kind: "push",
        ref: "refs/heads/kan-1",
        project,
      });
      expect(response.status).toBe(200);
    }

    expect(await allLinks()).toEqual([]);
    expect((await taskById(task.id)).status).toBe("to-do");
  });
});

describe("GitLab push webhook", () => {
  const push = (ref: string, extra: Record<string, unknown> = {}) => ({
    object_kind: "push",
    ref,
    project: projectPayload(),
    ...extra,
  });

  it("links the branch to the task, records the last commit and moves it to in-progress", async () => {
    const env = await setup();
    const task = await addTask(env, 7);

    const response = await post(
      env,
      env.integration.id,
      push("refs/heads/kan-7", {
        commits: [
          { id: "a1", message: "first", author: { name: "Ann" } },
          {
            id: "b2",
            message: "second",
            timestamp: "2026-01-02T03:04:05Z",
            author: { name: "Bob" },
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const [link] = await linksOf(task.id);
    expect(link).toMatchObject({
      resourceType: "branch",
      externalId: "kan-7",
      title: "kan-7",
      integrationId: env.integration.id,
      url: `${BASE_URL}/group/project/-/tree/kan-7`,
    });
    expect(metadataOf(link)).toEqual({
      lastCommit: {
        sha: "b2",
        message: "second",
        author: "Bob",
        timestamp: "2026-01-02T03:04:05Z",
      },
    });
    const moved = await taskById(task.id);
    expect(moved.status).toBe("in-progress");
    expect(moved.columnId).toBe(env.columns.inProgress.id);
  });

  it("encodes each branch path segment in the link URL and keeps the slashes", async () => {
    const env = await setup({
      config: { branchPattern: "feature/{slug}-{number}" },
    });
    const task = await addTask(env, 3);

    await post(env, env.integration.id, push("refs/heads/feature/kan-3-a b#"));

    const [link] = await linksOf(task.id);
    expect(link.externalId).toBe("feature/kan-3-a b#");
    expect(link.url).toBe(
      `${BASE_URL}/group/project/-/tree/feature/kan-3-a%20b%23`,
    );
  });

  it("updates the existing branch link on a second push instead of adding one", async () => {
    const env = await setup();
    const task = await addTask(env, 7);

    await post(
      env,
      env.integration.id,
      push("refs/heads/kan-7", { commits: [{ id: "c1", message: "one" }] }),
    );
    await post(
      env,
      env.integration.id,
      push("refs/heads/kan-7", { commits: [{ id: "c2", message: "two" }] }),
    );

    const links = await linksOf(task.id);
    expect(links).toHaveLength(1);
    expect(metadataOf(links[0]).lastCommit).toMatchObject({
      sha: "c2",
      message: "two",
    });
  });

  it("records a null last commit when the push carries no commits", async () => {
    const env = await setup();
    const task = await addTask(env, 7);

    await post(env, env.integration.id, push("refs/heads/kan-7"));

    expect(metadataOf((await linksOf(task.id))[0])).toEqual({
      lastCommit: null,
    });
  });

  it("uses the configured branch push status", async () => {
    const env = await setup({
      config: { statusTransitions: { onBranchPush: "in-review" } },
    });
    const task = await addTask(env, 7);

    await post(env, env.integration.id, push("refs/heads/kan-7"));

    expect((await taskById(task.id)).status).toBe("in-review");
  });

  it("prefers a workflow rule column over the configured status", async () => {
    const env = await setup();
    const task = await addTask(env, 7);
    await db.insert(schema.workflowRuleTable).values({
      projectId: env.project.id,
      integrationType: "gitlab",
      eventType: "branch_push",
      columnId: env.columns.inReview.id,
    });

    await post(env, env.integration.id, push("refs/heads/kan-7"));

    expect((await taskById(task.id)).status).toBe("in-review");
  });

  it("does not move a task that is already in a final column", async () => {
    const env = await setup();
    const task = await addTask(env, 7, {
      status: "done",
      columnId: env.columns.done.id,
    });

    await post(env, env.integration.id, push("refs/heads/kan-7"));

    expect((await taskById(task.id)).status).toBe("done");
    expect(await linksOf(task.id)).toHaveLength(1);
  });

  it.each([
    { name: "a tag", ref: "refs/tags/kan-7" },
    { name: "main", ref: "refs/heads/main" },
    { name: "master", ref: "refs/heads/master" },
    { name: "develop", ref: "refs/heads/develop" },
    { name: "staging", ref: "refs/heads/staging" },
    { name: "production", ref: "refs/heads/production" },
    { name: "a branch without a task number", ref: "refs/heads/chore-cleanup" },
    { name: "a branch for an unknown task number", ref: "refs/heads/kan-99" },
    { name: "a branch of another project key", ref: "refs/heads/other-7" },
  ])("ignores $name", async ({ ref }) => {
    const env = await setup();
    const task = await addTask(env, 7);

    const response = await post(env, env.integration.id, push(ref));

    expect(response.status).toBe(200);
    expect(await allLinks()).toEqual([]);
    expect((await taskById(task.id)).status).toBe("to-do");
  });

  it("does not link a task of another project with the same number", async () => {
    const env = await setup();
    const sibling = await createProjectFixture({
      workspaceId: env.member.workspace.id,
      slug: "kan",
    });
    const [siblingTask] = await db
      .insert(schema.taskTable)
      .values({ projectId: sibling.project.id, title: "Sibling", number: 7 })
      .returning();
    const task = await addTask(env, 7);

    await post(env, env.integration.id, push("refs/heads/kan-7"));

    expect(await linksOf(siblingTask.id)).toEqual([]);
    expect(await linksOf(task.id)).toHaveLength(1);
  });

  it("skips an integration whose stored config became invalid JSON", async () => {
    const env = await setup();
    const task = await addTask(env, 7);
    // Valid for the lookup (the integration matches), so break the config only
    // after the webhook secret check by using a custom regex that never matches.
    await db
      .update(schema.integrationTable)
      .set({
        config: JSON.stringify({
          baseUrl: BASE_URL,
          projectPath: "group/project",
          accessToken: ACCESS_TOKEN,
          webhookSecret: SECRET,
          customBranchRegex: "^never-([0-9]+)$",
        }),
      })
      .where(eq(schema.integrationTable.id, env.integration.id));

    await post(env, env.integration.id, push("refs/heads/kan-7"));

    expect(await allLinks()).toEqual([]);
    expect((await taskById(task.id)).status).toBe("to-do");
  });
});

describe("GitLab merge request webhooks", () => {
  const mr = (
    action: string,
    attributes: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ) => ({
    object_kind: "merge_request",
    user: { username: "ann", name: "Ann" },
    object_attributes: {
      iid: 5,
      title: "Do the thing",
      description: null,
      url: `${BASE_URL}/group/project/-/merge_requests/5`,
      state: "opened",
      action,
      source_branch: "kan-7",
      ...attributes,
    },
    project: projectPayload(),
    ...extra,
  });

  it("links an opened merge request and moves the task to in-review", async () => {
    const env = await setup();
    const task = await addTask(env, 7, {
      status: "in-progress",
      columnId: env.columns.inProgress.id,
    });

    const response = await post(env, env.integration.id, mr("open"));

    expect(response.status).toBe(200);
    const [link] = await linksOf(task.id);
    expect(link).toMatchObject({
      resourceType: "pull_request",
      externalId: "5",
      title: "Do the thing",
      url: `${BASE_URL}/group/project/-/merge_requests/5`,
    });
    expect(metadataOf(link)).toEqual({
      state: "opened",
      draft: false,
      merged: false,
      branch: "kan-7",
      author: "ann",
    });
    expect((await taskById(task.id)).status).toBe("in-review");
  });

  it("falls back to the display name when the user has no username", async () => {
    const env = await setup();
    const task = await addTask(env, 7);

    await post(
      env,
      env.integration.id,
      mr("open", {}, { user: { name: "Ann" } }),
    );

    expect(metadataOf((await linksOf(task.id))[0]).author).toBe("Ann");
  });

  it("finds the task from the merge request title when the branch has no number", async () => {
    const env = await setup();
    const task = await addTask(env, 9);

    await post(
      env,
      env.integration.id,
      mr("open", { source_branch: "topic", title: "KAN-9: fix it" }),
    );

    expect(await linksOf(task.id)).toHaveLength(1);
  });

  it("links a draft merge request but leaves the task where it is", async () => {
    const env = await setup();
    const task = await addTask(env, 7);

    await post(env, env.integration.id, mr("open", { draft: true }));

    expect(metadataOf((await linksOf(task.id))[0]).draft).toBe(true);
    expect((await taskById(task.id)).status).toBe("to-do");
  });

  it("moves the task when an update takes the merge request out of draft", async () => {
    const env = await setup();
    const task = await addTask(env, 7);
    await post(env, env.integration.id, mr("open", { draft: true }));

    await post(
      env,
      env.integration.id,
      mr(
        "update",
        { draft: false },
        { changes: { draft: { previous: true, current: false } } },
      ),
    );

    const links = await linksOf(task.id);
    expect(links).toHaveLength(1);
    expect(metadataOf(links[0]).draft).toBe(false);
    expect((await taskById(task.id)).status).toBe("in-review");
  });

  it("marks the link as draft without moving the task when an update puts it back to draft", async () => {
    const env = await setup();
    const task = await addTask(env, 7);
    await post(env, env.integration.id, mr("open"));
    await db
      .update(schema.taskTable)
      .set({ status: "in-progress", columnId: env.columns.inProgress.id })
      .where(eq(schema.taskTable.id, task.id));

    await post(
      env,
      env.integration.id,
      mr(
        "update",
        { draft: true },
        { changes: { draft: { previous: false, current: true } } },
      ),
    );

    expect(metadataOf((await linksOf(task.id))[0]).draft).toBe(true);
    expect((await taskById(task.id)).status).toBe("in-progress");
  });

  it.each([
    { name: "no changes", changes: undefined },
    {
      name: "an unchanged draft flag",
      changes: { draft: { previous: false, current: false } },
    },
    {
      name: "other changes only",
      changes: { title: { previous: "a", current: "b" } },
    },
  ])("ignores an update with $name", async ({ changes }) => {
    const env = await setup();
    const task = await addTask(env, 7);

    await post(
      env,
      env.integration.id,
      mr("update", {}, changes ? { changes } : {}),
    );

    expect(await allLinks()).toEqual([]);
    expect((await taskById(task.id)).status).toBe("to-do");
  });

  it("moves the task again when a closed merge request is reopened", async () => {
    const env = await setup();
    const task = await addTask(env, 7);
    await post(env, env.integration.id, mr("open"));
    await post(env, env.integration.id, mr("close", { state: "closed" }));
    await db
      .update(schema.taskTable)
      .set({ status: "to-do", columnId: env.columns.todo.id })
      .where(eq(schema.taskTable.id, task.id));

    await post(env, env.integration.id, mr("reopen"));

    const links = await linksOf(task.id);
    expect(links).toHaveLength(1);
    expect(metadataOf(links[0]).state).toBe("opened");
    expect((await taskById(task.id)).status).toBe("in-review");
  });

  it("does nothing for a merge request without a source branch", async () => {
    const env = await setup();
    const task = await addTask(env, 7);

    await post(
      env,
      env.integration.id,
      mr("open", { source_branch: undefined, title: "KAN-7" }),
    );

    expect(await allLinks()).toEqual([]);
    expect((await taskById(task.id)).status).toBe("to-do");
  });

  it("does nothing when the branch names no existing task", async () => {
    const env = await setup();
    const task = await addTask(env, 7);

    await post(
      env,
      env.integration.id,
      mr("open", { source_branch: "kan-404", title: "t" }),
    );
    await post(
      env,
      env.integration.id,
      mr("open", { source_branch: "nothing", title: "t" }),
    );

    expect(await allLinks()).toEqual([]);
    expect((await taskById(task.id)).status).toBe("to-do");
  });

  it("does not move a task that is already done", async () => {
    const env = await setup();
    const task = await addTask(env, 7, {
      status: "done",
      columnId: env.columns.done.id,
    });

    await post(env, env.integration.id, mr("open"));

    expect((await taskById(task.id)).status).toBe("done");
    expect(await linksOf(task.id)).toHaveLength(1);
  });

  it("honours the configured status for an opened merge request", async () => {
    const env = await setup({
      config: { statusTransitions: { onPROpen: "in-progress" } },
    });
    const task = await addTask(env, 7);

    await post(env, env.integration.id, mr("open"));

    expect((await taskById(task.id)).status).toBe("in-progress");
  });

  describe("merged or closed", () => {
    async function openedLinked(env: Env, iid = 5, number = 7) {
      const task = await addTask(env, number, {
        status: "in-review",
        columnId: env.columns.inReview.id,
      });
      await post(
        env,
        env.integration.id,
        mr("open", {
          iid,
          source_branch: `kan-${number}`,
          url: `${BASE_URL}/group/project/-/merge_requests/${iid}`,
        }),
      );
      return task;
    }

    it("marks the link merged and moves the task to done", async () => {
      const env = await setup();
      const task = await openedLinked(env);

      const response = await post(
        env,
        env.integration.id,
        mr("merge", { state: "merged" }),
      );

      expect(response.status).toBe(200);
      expect(metadataOf((await linksOf(task.id))[0])).toMatchObject({
        state: "merged",
        merged: true,
        draft: false,
        branch: "kan-7",
      });
      const done = await taskById(task.id);
      expect(done.status).toBe("done");
      expect(done.columnId).toBe(env.columns.done.id);
    });

    it("marks the link closed but keeps the task where it is when closed unmerged", async () => {
      const env = await setup();
      const task = await openedLinked(env);

      await post(env, env.integration.id, mr("close", { state: "closed" }));

      expect(metadataOf((await linksOf(task.id))[0])).toMatchObject({
        state: "closed",
        merged: false,
      });
      expect((await taskById(task.id)).status).toBe("in-review");
    });

    it("keeps the task open while another merge request of it is still opened", async () => {
      const env = await setup();
      const task = await openedLinked(env, 5);
      await post(
        env,
        env.integration.id,
        mr("open", {
          iid: 6,
          url: `${BASE_URL}/group/project/-/merge_requests/6`,
        }),
      );

      await post(env, env.integration.id, mr("merge", { state: "merged" }));

      expect((await taskById(task.id)).status).toBe("in-review");
      const links = await linksOf(task.id);
      expect(
        links.map((link) => [link.externalId, metadataOf(link).state]).sort(),
      ).toEqual([
        ["5", "merged"],
        ["6", "opened"],
      ]);
    });

    it("moves the task when the other merge request has unreadable metadata", async () => {
      const env = await setup();
      const task = await openedLinked(env, 5);
      await db.insert(schema.externalLinkTable).values({
        taskId: task.id,
        integrationId: env.integration.id,
        resourceType: "pull_request",
        externalId: "6",
        url: "u",
        metadata: "{broken",
      });

      await post(env, env.integration.id, mr("merge", { state: "merged" }));

      expect((await taskById(task.id)).status).toBe("done");
    });

    it("uses the configured and the workflow-rule target status on merge", async () => {
      const env = await setup({
        config: { statusTransitions: { onPRMerge: "in-progress" } },
      });
      const task = await openedLinked(env);

      await post(env, env.integration.id, mr("merge", { state: "merged" }));
      expect((await taskById(task.id)).status).toBe("in-progress");

      await db.insert(schema.workflowRuleTable).values({
        projectId: env.project.id,
        integrationType: "gitlab",
        eventType: "pr_merged",
        columnId: env.columns.todo.id,
      });
      await post(env, env.integration.id, mr("merge", { state: "merged" }));
      expect((await taskById(task.id)).status).toBe("to-do");
    });

    it("rebuilds metadata when the stored one is not JSON", async () => {
      const env = await setup();
      const task = await openedLinked(env);
      await db
        .update(schema.externalLinkTable)
        .set({ metadata: "{broken" })
        .where(eq(schema.externalLinkTable.taskId, task.id));

      await post(env, env.integration.id, mr("merge", { state: "merged" }));

      expect(metadataOf((await linksOf(task.id))[0])).toEqual({
        state: "merged",
        draft: false,
        merged: true,
      });
      expect((await taskById(task.id)).status).toBe("done");
    });

    it("works for a link that has no stored metadata", async () => {
      const env = await setup();
      const task = await openedLinked(env);
      await db
        .update(schema.externalLinkTable)
        .set({ metadata: null })
        .where(eq(schema.externalLinkTable.taskId, task.id));

      await post(env, env.integration.id, mr("close", { state: "closed" }));

      expect(metadataOf((await linksOf(task.id))[0]).state).toBe("closed");
    });

    it("ignores a merge request that was never linked", async () => {
      const env = await setup();
      const task = await openedLinked(env, 5);

      await post(
        env,
        env.integration.id,
        mr("merge", { iid: 77, state: "merged" }),
      );

      expect((await taskById(task.id)).status).toBe("in-review");
      expect(metadataOf((await linksOf(task.id))[0]).state).toBe("opened");
    });

    it("does not let a merge of the same iid in another integration change this task", async () => {
      const env = await setup();
      const task = await openedLinked(env);
      const foreign = await setup({
        projectPath: "other/repo",
        webhookSecret: "foreign-secret",
      });
      const foreignTask = await addTask(foreign, 7, {
        status: "in-review",
        columnId: foreign.columns.inReview.id,
      });

      const response = await post(
        foreign,
        foreign.integration.id,
        mr(
          "merge",
          { state: "merged" },
          { project: projectPayload("other/repo") },
        ),
        "foreign-secret",
      );

      expect(response.status).toBe(200);
      expect((await taskById(task.id)).status).toBe("in-review");
      expect((await taskById(foreignTask.id)).status).toBe("in-review");
    });
  });
});

describe("GitLab issue closed webhook", () => {
  const closeEvent = (attributes: Record<string, unknown> = {}) => ({
    object_kind: "issue",
    object_attributes: {
      iid: 12,
      title: "Bug",
      url: `${BASE_URL}/group/project/-/issues/12`,
      state: "closed",
      action: "close",
      ...attributes,
    },
    project: projectPayload(),
  });

  async function linkedIssue(
    env: Env,
    metadata: unknown = { state: "opened" },
  ) {
    const task = await addTask(env, 3, {
      status: "in-progress",
      columnId: env.columns.inProgress.id,
    });
    const [link] = await db
      .insert(schema.externalLinkTable)
      .values({
        taskId: task.id,
        integrationId: env.integration.id,
        resourceType: "issue",
        externalId: "12",
        url: `${BASE_URL}/group/project/-/issues/12`,
        metadata:
          typeof metadata === "string" ? metadata : JSON.stringify(metadata),
      })
      .returning();
    return { task, link };
  }

  async function currentLink(id: string) {
    const link = await db.query.externalLinkTable.findFirst({
      where: eq(schema.externalLinkTable.id, id),
    });
    if (!link) throw new Error("link missing");
    return link;
  }

  it("moves the linked task to done and records the closed state", async () => {
    const env = await setup();
    const { task, link } = await linkedIssue(env, {
      state: "opened",
      note: "keep",
    });

    const response = await post(env, env.integration.id, closeEvent());

    expect(response.status).toBe(200);
    const done = await taskById(task.id);
    expect(done.status).toBe("done");
    expect(done.columnId).toBe(env.columns.done.id);
    expect(metadataOf(await currentLink(link.id))).toEqual({
      state: "closed",
      note: "keep",
    });
  });

  it("uses the workflow rule column for closed issues", async () => {
    const env = await setup();
    const { task } = await linkedIssue(env);
    await db.insert(schema.workflowRuleTable).values({
      projectId: env.project.id,
      integrationType: "gitlab",
      eventType: "issue_closed",
      columnId: env.columns.inReview.id,
    });

    await post(env, env.integration.id, closeEvent());

    expect((await taskById(task.id)).status).toBe("in-review");
  });

  it("treats a close right after Kaneo closed the issue as an echo", async () => {
    const env = await setup();
    const now = Date.now();
    const { task, link } = await linkedIssue(env, {
      state: "closed",
      lastOutboundStateSyncAt: now,
    });

    await post(
      env,
      env.integration.id,
      closeEvent({ updated_at: new Date(now + 2000).toISOString() }),
    );

    expect((await taskById(task.id)).status).toBe("in-progress");
    expect(metadataOf(await currentLink(link.id))).toEqual({
      state: "closed",
      lastOutboundStateSyncAt: now,
    });
  });

  it("applies a close that is outside the echo window", async () => {
    const env = await setup();
    const now = Date.now();
    const { task } = await linkedIssue(env, {
      state: "closed",
      lastOutboundStateSyncAt: now,
    });

    await post(
      env,
      env.integration.id,
      closeEvent({ updated_at: new Date(now + 60_000).toISOString() }),
    );

    expect((await taskById(task.id)).status).toBe("done");
  });

  it.each([
    { name: "has no updated_at", attributes: {} },
    {
      name: "has an unparseable updated_at",
      attributes: { updated_at: "yesterday-ish" },
    },
  ])(
    "applies a close whose event $name even after an outbound close",
    async ({ attributes }) => {
      const env = await setup();
      const { task } = await linkedIssue(env, {
        state: "closed",
        lastOutboundStateSyncAt: Date.now(),
      });

      await post(env, env.integration.id, closeEvent(attributes));

      expect((await taskById(task.id)).status).toBe("done");
    },
  );

  it("applies the close when the last outbound sync was a reopen", async () => {
    const env = await setup();
    const now = Date.now();
    const { task } = await linkedIssue(env, {
      state: "opened",
      lastOutboundStateSyncAt: now,
    });

    await post(
      env,
      env.integration.id,
      closeEvent({ updated_at: new Date(now).toISOString() }),
    );

    expect((await taskById(task.id)).status).toBe("done");
  });

  it("recovers from unreadable link metadata", async () => {
    const env = await setup();
    const { task, link } = await linkedIssue(env, "{broken");

    await post(env, env.integration.id, closeEvent());

    expect((await taskById(task.id)).status).toBe("done");
    expect(metadataOf(await currentLink(link.id))).toEqual({ state: "closed" });
  });

  it("handles a link without metadata and a task already in done", async () => {
    const env = await setup();
    const task = await addTask(env, 3, {
      status: "done",
      columnId: env.columns.done.id,
    });
    const [link] = await db
      .insert(schema.externalLinkTable)
      .values({
        taskId: task.id,
        integrationId: env.integration.id,
        resourceType: "issue",
        externalId: "12",
        url: "u",
      })
      .returning();

    await post(env, env.integration.id, closeEvent());

    expect((await taskById(task.id)).status).toBe("done");
    expect(metadataOf(await currentLink(link.id))).toEqual({ state: "closed" });
  });

  it("ignores an issue that has no task", async () => {
    const env = await setup();
    const { task } = await linkedIssue(env);

    const response = await post(
      env,
      env.integration.id,
      closeEvent({ iid: 99 }),
    );

    expect(response.status).toBe(200);
    expect((await taskById(task.id)).status).toBe("in-progress");
  });

  it("ignores confidential issues and unknown actions", async () => {
    const env = await setup();
    const { task } = await linkedIssue(env);

    await post(env, env.integration.id, closeEvent({ confidential: true }));
    await post(env, env.integration.id, {
      ...closeEvent(),
      event_type: "confidential_issue",
    });
    await post(env, env.integration.id, closeEvent({ action: "delete" }));
    await post(env, env.integration.id, closeEvent({ action: undefined }));

    expect((await taskById(task.id)).status).toBe("in-progress");
  });

  it("does not close a task linked to the same iid through another integration", async () => {
    const env = await setup();
    const { task } = await linkedIssue(env);
    const foreign = await setup({
      projectPath: "other/repo",
      webhookSecret: "fs",
    });
    const foreignTask = await addTask(foreign, 3, {
      status: "in-progress",
      columnId: foreign.columns.inProgress.id,
    });
    await db.insert(schema.externalLinkTable).values({
      taskId: foreignTask.id,
      integrationId: foreign.integration.id,
      resourceType: "issue",
      externalId: "12",
      url: "u",
    });

    await post(env, env.integration.id, closeEvent());

    expect((await taskById(task.id)).status).toBe("done");
    expect((await taskById(foreignTask.id)).status).toBe("in-progress");
    expect(
      await db.query.externalLinkTable.findFirst({
        where: and(
          eq(schema.externalLinkTable.taskId, foreignTask.id),
          eq(schema.externalLinkTable.integrationId, foreign.integration.id),
        ),
      }),
    ).toMatchObject({ metadata: null });
  });
});

describe("GitLab webhook route handler", () => {
  it("answers 400 when the route carries no integration id", async () => {
    const context = {
      req: { param: () => undefined },
      json: (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status }),
    };

    const response = await handleGitlabWebhookRoute(context as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Missing integration id" });
  });

  it("reads the token header regardless of its letter case", async () => {
    const env = await setup();
    const task = await addTask(env, 7);

    const response = await env.app.request(
      `/api/gitlab-integration/webhook/${env.integration.id}`,
      {
        method: "POST",
        headers: { "x-gitlab-token": SECRET },
        body: JSON.stringify({
          object_kind: "push",
          ref: "refs/heads/kan-7",
          project: projectPayload(),
        }),
      },
    );

    expect(response.status).toBe(200);
    expect((await taskById(task.id)).status).toBe("in-progress");
  });
});

describe("GitLab webhook handlers: payload project that cannot be matched", () => {
  const garbage = {
    name: "p",
    web_url: "not a url",
    path_with_namespace: "group/project",
  };

  it.each([
    {
      name: "merge request opened",
      body: {
        object_kind: "merge_request",
        object_attributes: {
          iid: 5,
          title: "KAN-1",
          description: null,
          url: "u",
          state: "opened",
          action: "open",
          source_branch: "kan-1",
        },
      },
    },
    {
      name: "merge request merged",
      body: {
        object_kind: "merge_request",
        object_attributes: {
          iid: 5,
          title: "KAN-1",
          url: "u",
          state: "merged",
          action: "merge",
        },
      },
    },
    {
      name: "issue closed",
      body: {
        object_kind: "issue",
        object_attributes: {
          iid: 12,
          title: "t",
          url: "u",
          state: "closed",
          action: "close",
        },
      },
    },
    {
      name: "issue reopened",
      body: {
        object_kind: "issue",
        object_attributes: {
          iid: 12,
          title: "t",
          url: "u",
          state: "opened",
          action: "reopen",
        },
      },
    },
    {
      name: "issue updated",
      body: {
        object_kind: "issue",
        object_attributes: {
          iid: 12,
          title: "x",
          description: "d",
          url: "u",
          action: "update",
        },
        changes: { title: { previous: "a", current: "x" } },
      },
    },
  ])(
    "does nothing for $name with a project URL that is not a URL",
    async ({ body }) => {
      const env = await setup();
      const task = await addTask(env, 1, {
        status: "in-review",
        columnId: env.columns.inReview.id,
      });
      await db.insert(schema.externalLinkTable).values({
        taskId: task.id,
        integrationId: env.integration.id,
        resourceType: "issue",
        externalId: "12",
        url: "u",
        metadata: JSON.stringify({ state: "closed" }),
      });
      await db.insert(schema.externalLinkTable).values({
        taskId: task.id,
        integrationId: env.integration.id,
        resourceType: "pull_request",
        externalId: "5",
        url: "u",
        metadata: JSON.stringify({ state: "opened" }),
      });

      const response = await post(env, env.integration.id, {
        ...body,
        project: garbage,
      });

      expect(response.status).toBe(200);
      const after = await taskById(task.id);
      expect(after.status).toBe("in-review");
      expect(after.title).toBe("Task 1");
      const links = await db.select().from(schema.externalLinkTable);
      expect(links.map((l) => metadataOf(l).state).sort()).toEqual([
        "closed",
        "opened",
      ]);
    },
  );

  it("links a branch but leaves the task alone when the project has no columns", async () => {
    const env = await setup();
    const task = await addTask(env, 7, { columnId: null });
    await db
      .delete(schema.columnTable)
      .where(eq(schema.columnTable.projectId, env.project.id));

    const response = await post(env, env.integration.id, {
      object_kind: "push",
      ref: "refs/heads/kan-7",
      project: projectPayload(),
    });

    expect(response.status).toBe(200);
    expect(await linksOf(task.id)).toHaveLength(1);
    expect((await taskById(task.id)).status).toBe("to-do");
  });
});
