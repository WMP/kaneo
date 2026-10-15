import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { waitForPendingEventHandlers } from "../../apps/api/src/events";
import { handleGiteaWebhookRoute } from "../../apps/api/src/gitea-integration";
import { createApp } from "../../apps/api/src/index";
import { handleGiteaIssueClosed } from "../../apps/api/src/plugins/gitea/webhooks/issue-closed";
import { handleGiteaIssueReopened } from "../../apps/api/src/plugins/gitea/webhooks/issue-reopened";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const SECRET = "whsec-gitea-webhook-secret-value";
const TOKEN = "gitea-pat-token-value-123456";
const REPO = {
  owner: { login: "owner" },
  name: "repo",
  html_url: "https://gitea.example/owner/repo",
};

function sign(body: string, secret = SECRET) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

type SeededProject = Awaited<ReturnType<typeof seedProject>>;

async function seedProject(options?: {
  isActive?: boolean;
  config?: Record<string, unknown>;
  slug?: string;
  workspaceId?: string;
  repositoryName?: string;
}) {
  const workspaceId =
    options?.workspaceId ?? (await createWorkspaceMember()).workspace.id;
  const { project, columns } = await createProjectFixture({
    workspaceId,
    slug: options?.slug ?? "kan",
  });
  const [integration] = await db
    .insert(schema.integrationTable)
    .values({
      projectId: project.id,
      type: "gitea",
      isActive: options?.isActive ?? true,
      config: JSON.stringify({
        baseUrl: "https://gitea.example",
        accessToken: TOKEN,
        repositoryOwner: "owner",
        repositoryName: options?.repositoryName ?? "repo",
        webhookSecret: SECRET,
        ...options?.config,
      }),
    })
    .returning();
  return { workspaceId, project, columns, integration };
}

async function seedTask(
  ctx: SeededProject,
  overrides: Partial<typeof schema.taskTable.$inferInsert> = {},
  link?: {
    externalId?: string;
    metadata?: string | null;
    resourceType?: string;
    title?: string;
  },
) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: ctx.project.id,
      title: "Original title",
      description: "Original description",
      status: "to-do",
      columnId: ctx.columns.todo.id,
      priority: "low",
      number: 3,
      position: 1,
      ...overrides,
    })
    .returning();
  let linkRow: typeof schema.externalLinkTable.$inferSelect | undefined;
  if (link) {
    [linkRow] = await db
      .insert(schema.externalLinkTable)
      .values({
        taskId: task.id,
        integrationId: ctx.integration.id,
        resourceType: link.resourceType ?? "issue",
        externalId: link.externalId ?? "5",
        url: "https://gitea.example/owner/repo/issues/5",
        title: link.title ?? "Linked issue",
        metadata: link.metadata === undefined ? null : link.metadata,
      })
      .returning();
  }
  return { task, link: linkRow };
}

async function taskRow(id: string) {
  const row = await db.query.taskTable.findFirst({
    where: eq(schema.taskTable.id, id),
  });
  if (!row) throw new Error("task missing");
  return row;
}

async function linkRow(id: string) {
  const row = await db.query.externalLinkTable.findFirst({
    where: eq(schema.externalLinkTable.id, id),
  });
  if (!row) throw new Error("link missing");
  return row;
}

async function post(
  integrationId: string,
  event: string | null,
  payload: unknown,
  options?: {
    secret?: string;
    signature?: string | null;
    rawBody?: string;
    eventHeader?: "x-gitea-event" | "x-github-event";
  },
) {
  const { app } = createApp();
  const body = options?.rawBody ?? JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options?.signature !== null) {
    headers["x-gitea-signature"] =
      options?.signature ?? sign(body, options?.secret);
  }
  if (event) {
    headers[options?.eventHeader ?? "x-gitea-event"] = event;
  }
  const response = await app.request(
    `/api/gitea-integration/webhook/${integrationId}`,
    { method: "POST", headers, body },
  );
  const text = await response.text();
  // Neither the stored token nor the webhook secret may ever be echoed.
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(SECRET);
  return { status: response.status, text, json: JSON.parse(text) };
}

function issuePayload(
  action: string,
  issue: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    action,
    issue: {
      number: 5,
      title: "Issue title",
      body: "Issue body",
      html_url: "https://gitea.example/owner/repo/issues/5",
      state: "open",
      ...issue,
    },
    repository: REPO,
    ...extra,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
const originalAllowPrivate =
  process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;

beforeEach(async () => {
  await resetTestDatabase();
  // The SSRF guard resolves DNS; gitea.example does not exist.
  process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
  fetchMock = vi.fn(
    async () => new Response("{}", { status: 200 }),
  ) as unknown as ReturnType<typeof vi.fn>;
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  await waitForPendingEventHandlers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalAllowPrivate === undefined) {
    delete process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
  } else {
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = originalAllowPrivate;
  }
});

describe("Gitea webhook: request authentication and routing", () => {
  it("rejects an unknown integration id and changes nothing", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    const result = await post(
      "does-not-exist",
      "issues",
      issuePayload("closed", {}),
    );
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ error: "Gitea integration not found" });
    expect((await taskRow(task.id)).status).toBe("to-do");
  });

  it("rejects an integration of another type even with a valid signature", async () => {
    const ctx = await seedProject();
    const [other] = await db
      .insert(schema.integrationTable)
      .values({
        projectId: ctx.project.id,
        type: "github",
        config: JSON.stringify({ webhookSecret: SECRET }),
      })
      .returning();
    const result = await post(other.id, "issues", issuePayload("closed", {}));
    expect(result.status).toBe(400);
    expect(result.json.error).toBe("Gitea integration not found");
  });

  it("rejects an integration whose stored config is not JSON", async () => {
    const ctx = await seedProject();
    await db
      .update(schema.integrationTable)
      .set({ config: "{broken" })
      .where(eq(schema.integrationTable.id, ctx.integration.id));
    const result = await post(
      ctx.integration.id,
      "issues",
      issuePayload("closed", {}),
    );
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ error: "Invalid integration config" });
  });

  it("rejects every request when no webhook secret is configured", async () => {
    const ctx = await seedProject({ config: { webhookSecret: "" } });
    const result = await post(
      ctx.integration.id,
      "issues",
      issuePayload("closed", {}),
      { signature: sign("anything", "") },
    );
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ error: "Webhook secret not configured" });
  });

  it("rejects a missing, tampered or foreign-secret signature without side effects", async () => {
    const ctx = await seedProject();
    const { task, link } = await seedTask(ctx, {}, {});
    const payload = issuePayload("closed", {});
    const body = JSON.stringify(payload);

    const missing = await post(ctx.integration.id, "issues", payload, {
      signature: null,
    });
    const wrongSecret = await post(ctx.integration.id, "issues", payload, {
      secret: "another-secret",
    });
    const tampered = await post(ctx.integration.id, "issues", payload, {
      rawBody: body.replace("closed", "closed "),
      signature: sign(body),
    });
    const garbage = await post(ctx.integration.id, "issues", payload, {
      signature: "not-a-hex-signature",
    });
    const truncated = await post(ctx.integration.id, "issues", payload, {
      signature: sign(body).slice(0, 20),
    });

    for (const result of [missing, wrongSecret, tampered, garbage, truncated]) {
      expect(result.status).toBe(400);
      expect(result.json).toEqual({ error: "Invalid webhook signature" });
    }
    expect((await taskRow(task.id)).status).toBe("to-do");
    expect((await linkRow(link?.id as string)).metadata).toBeNull();
  });

  it("accepts the signature with or without the sha256= prefix", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    const payload = issuePayload("closed", {});
    const body = JSON.stringify(payload);
    const prefixed = await post(ctx.integration.id, "issues", payload, {
      signature: `sha256=${sign(body)}`,
    });
    expect(prefixed.status).toBe(200);
    expect((await taskRow(task.id)).status).toBe("done");
  });

  it("requires an event header and a JSON body after authentication", async () => {
    const ctx = await seedProject();
    const noEvent = await post(ctx.integration.id, null, { a: 1 });
    expect(noEvent.status).toBe(400);
    expect(noEvent.json).toEqual({ error: "Missing event name" });

    const notJson = await post(ctx.integration.id, "issues", null, {
      rawBody: "{not json",
      signature: sign("{not json"),
    });
    expect(notJson.status).toBe(400);
    expect(notJson.json).toEqual({ error: "Invalid JSON payload" });
  });

  it("acknowledges unknown events and malformed payloads of known events without changes", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    for (const [event, payload] of [
      ["ping", { zen: "hello" }],
      ["issues", {}],
      ["issues", { action: "closed" }],
      ["issues", { action: "closed", repository: REPO }],
      ["issues", issuePayload("assigned", {})],
      ["issue_comment", { action: "created", repository: REPO }],
      [
        "issue_comment",
        { action: "edited", issue: {}, comment: {}, repository: REPO },
      ],
      ["pull_request", { action: "closed", repository: REPO }],
      [
        "pull_request",
        { action: "synchronize", pull_request: {}, repository: REPO },
      ],
      ["push", { ref: "refs/heads/kan-3", commits: [] }],
      ["push", { repository: REPO }],
      ["issue_label", {}],
    ] as const) {
      const result = await post(ctx.integration.id, event, payload);
      expect(result.status, `${event} ${JSON.stringify(payload)}`).toBe(200);
      expect(result.json).toEqual({ status: "success" });
    }
    expect((await taskRow(task.id)).status).toBe("to-do");
    expect(await db.query.labelTable.findMany()).toEqual([]);
    expect(await db.query.activityTable.findMany()).toEqual([]);
  });

  it("reports a handler failure as 400 without leaking secrets", async () => {
    const ctx = await seedProject();
    const result = await post(ctx.integration.id, "issues", {
      ...issuePayload("closed", {}),
      issue: { number: null },
    });
    expect(result.status).toBe(400);
    expect(typeof result.json.error).toBe("string");
  });

  it("reports a JSON null payload as 400 instead of crashing the route", async () => {
    const ctx = await seedProject();
    const result = await post(ctx.integration.id, "issues", null, {
      rawBody: "null",
    });
    expect(result.status).toBe(400);
  });

  it("reads the event name from x-github-event when x-gitea-event is absent", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    const result = await post(
      ctx.integration.id,
      "issues",
      issuePayload("closed", {}),
      { eventHeader: "x-github-event" },
    );
    expect(result.status).toBe(200);
    expect((await taskRow(task.id)).status).toBe("done");
  });

  it("ignores events for an inactive integration", async () => {
    const ctx = await seedProject({ isActive: false });
    const { task } = await seedTask(ctx, {}, {});
    const result = await post(
      ctx.integration.id,
      "issues",
      issuePayload("closed", {}),
    );
    expect(result.status).toBe(200);
    expect((await taskRow(task.id)).status).toBe("to-do");
  });

  it("ignores a signed payload that names another repository", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    const other = {
      ...issuePayload("closed", {}),
      repository: {
        owner: { login: "owner" },
        name: "other-repo",
        html_url: "https://gitea.example/owner/other-repo",
      },
    };
    expect((await post(ctx.integration.id, "issues", other)).status).toBe(200);
    const otherHost = {
      ...issuePayload("closed", {}),
      repository: { ...REPO, html_url: "https://evil.example/owner/repo" },
    };
    expect((await post(ctx.integration.id, "issues", otherHost)).status).toBe(
      200,
    );
    const noHost = {
      ...issuePayload("closed", {}),
      repository: { ...REPO, html_url: "not a url" },
    };
    expect((await post(ctx.integration.id, "issues", noHost)).status).toBe(200);
    expect((await taskRow(task.id)).status).toBe("to-do");
  });

  it("only touches the signed integration when two projects link the same repository", async () => {
    const a = await seedProject();
    const b = await seedProject();
    const { task: taskA } = await seedTask(a, {}, {});
    const { task: taskB } = await seedTask(b, {}, {});
    const result = await post(
      a.integration.id,
      "issues",
      issuePayload("closed", {}),
    );
    expect(result.status).toBe(200);
    expect((await taskRow(taskA.id)).status).toBe("done");
    expect((await taskRow(taskB.id)).status).toBe("to-do");
  });
});

describe("Gitea webhook: issue closed and reopened", () => {
  it("moves the linked task to the done column and records the state", async () => {
    const ctx = await seedProject();
    const { task, link } = await seedTask(
      ctx,
      {},
      { metadata: JSON.stringify({ createdFrom: "gitea" }) },
    );
    const result = await post(
      ctx.integration.id,
      "issues",
      issuePayload("closed", { state: "closed" }),
    );
    expect(result.status).toBe(200);
    const row = await taskRow(task.id);
    expect(row.status).toBe("done");
    expect(row.columnId).toBe(ctx.columns.done.id);
    expect(
      JSON.parse((await linkRow(link?.id as string)).metadata ?? ""),
    ).toEqual({ createdFrom: "gitea", state: "closed" });
  });

  it("does not touch tasks linked to other issues, other link types or other projects", async () => {
    const ctx = await seedProject();
    const other = await seedProject();
    const { task: differentIssue } = await seedTask(
      ctx,
      { number: 1 },
      { externalId: "6" },
    );
    const { task: pullRequest } = await seedTask(
      ctx,
      { number: 2 },
      { externalId: "5", resourceType: "pull_request" },
    );
    const { task: foreign } = await seedTask(other, { number: 1 }, {});
    await post(ctx.integration.id, "issues", issuePayload("closed", {}));
    for (const t of [differentIssue, pullRequest, foreign]) {
      expect((await taskRow(t.id)).status).toBe("to-do");
    }
  });

  it("does nothing when the issue has no linked task", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx);
    const result = await post(
      ctx.integration.id,
      "issues",
      issuePayload("closed", {}),
    );
    expect(result.status).toBe(200);
    expect((await taskRow(task.id)).status).toBe("to-do");
  });

  it("uses the project's workflow rule for closed issues and ignores a column of another project", async () => {
    const ctx = await seedProject();
    const other = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    await db.insert(schema.workflowRuleTable).values({
      projectId: ctx.project.id,
      integrationType: "gitea",
      eventType: "issue_closed",
      columnId: ctx.columns.inReview.id,
    });
    await post(ctx.integration.id, "issues", issuePayload("closed", {}));
    expect((await taskRow(task.id)).status).toBe("in-review");

    await db
      .update(schema.workflowRuleTable)
      .set({ columnId: other.columns.inProgress.id })
      .where(eq(schema.workflowRuleTable.projectId, ctx.project.id));
    await db
      .update(schema.taskTable)
      .set({ status: "to-do", columnId: ctx.columns.todo.id })
      .where(eq(schema.taskTable.id, task.id));
    await post(ctx.integration.id, "issues", issuePayload("closed", {}));
    expect((await taskRow(task.id)).status).toBe("done");
  });

  it("ignores a close event that echoes Kaneo's own outbound update", async () => {
    const ctx = await seedProject();
    const sentAt = Date.parse("2026-01-01T10:00:00.000Z");
    const { task, link } = await seedTask(
      ctx,
      {},
      { metadata: JSON.stringify({ lastOutboundStateSyncAt: sentAt }) },
    );
    await post(
      ctx.integration.id,
      "issues",
      issuePayload("closed", { updated_at: "2026-01-01T10:00:04.000Z" }),
    );
    expect((await taskRow(task.id)).status).toBe("to-do");
    expect(
      JSON.parse((await linkRow(link?.id as string)).metadata ?? ""),
    ).toEqual({ lastOutboundStateSyncAt: sentAt });

    // Just outside the 5 second window the event is a real change.
    await post(
      ctx.integration.id,
      "issues",
      issuePayload("closed", { updated_at: "2026-01-01T10:00:06.000Z" }),
    );
    expect((await taskRow(task.id)).status).toBe("done");
  });

  it("applies a close event whose echo markers are unusable", async () => {
    const ctx = await seedProject();
    const { task: a } = await seedTask(
      ctx,
      { number: 1 },
      {
        externalId: "5",
        metadata: JSON.stringify({ lastOutboundStateSyncAt: "yesterday" }),
      },
    );
    const { task: b } = await seedTask(
      ctx,
      { number: 2 },
      {
        externalId: "6",
        metadata: JSON.stringify({ lastOutboundStateSyncAt: 1000 }),
      },
    );
    await post(
      ctx.integration.id,
      "issues",
      issuePayload("closed", { updated_at: "2026-01-01T10:00:00.000Z" }),
    );
    await post(
      ctx.integration.id,
      "issues",
      issuePayload("closed", { number: 6, updated_at: "not a date" }),
    );
    expect((await taskRow(a.id)).status).toBe("done");
    expect((await taskRow(b.id)).status).toBe("done");
  });

  it("still closes the task when the link metadata is corrupt", async () => {
    const ctx = await seedProject();
    const { task, link } = await seedTask(ctx, {}, { metadata: "{corrupt" });
    const result = await post(
      ctx.integration.id,
      "issues",
      issuePayload("closed", {}),
    );
    expect(result.status).toBe(200);
    expect((await taskRow(task.id)).status).toBe("done");
    expect(
      JSON.parse((await linkRow(link?.id as string)).metadata ?? ""),
    ).toEqual({ state: "closed" });
  });

  it("reopens a done task into to-do and records the open state", async () => {
    const ctx = await seedProject();
    const { task, link } = await seedTask(
      ctx,
      { status: "done", columnId: ctx.columns.done.id },
      { metadata: JSON.stringify({ state: "closed" }) },
    );
    const result = await post(
      ctx.integration.id,
      "issues",
      issuePayload("reopened", {}),
    );
    expect(result.status).toBe(200);
    const row = await taskRow(task.id);
    expect(row.status).toBe("to-do");
    expect(row.columnId).toBe(ctx.columns.todo.id);
    expect(
      JSON.parse((await linkRow(link?.id as string)).metadata ?? ""),
    ).toEqual({ state: "open" });
  });

  it("reopens through the workflow rule and skips echoes, unknown issues and corrupt metadata", async () => {
    const ctx = await seedProject();
    await db.insert(schema.workflowRuleTable).values({
      projectId: ctx.project.id,
      integrationType: "gitea",
      eventType: "issue_reopened",
      columnId: ctx.columns.inProgress.id,
    });
    const done = { status: "done", columnId: ctx.columns.done.id };
    const sentAt = Date.parse("2026-01-01T10:00:00.000Z");
    const { task: echo } = await seedTask(
      ctx,
      { number: 1, ...done },
      {
        externalId: "5",
        metadata: JSON.stringify({ lastOutboundStateSyncAt: sentAt }),
      },
    );
    const { task: corrupt, link: corruptLink } = await seedTask(
      ctx,
      { number: 2, ...done },
      { externalId: "6", metadata: "{corrupt" },
    );
    const { task: unrelated } = await seedTask(ctx, { number: 3, ...done });

    await post(
      ctx.integration.id,
      "issues",
      issuePayload("reopened", { updated_at: "2026-01-01T10:00:02.000Z" }),
    );
    expect((await taskRow(echo.id)).status).toBe("done");

    await post(
      ctx.integration.id,
      "issues",
      issuePayload("reopened", { number: 6 }),
    );
    expect((await taskRow(corrupt.id)).status).toBe("in-progress");
    expect(
      JSON.parse((await linkRow(corruptLink?.id as string)).metadata ?? ""),
    ).toEqual({ state: "open" });

    await post(
      ctx.integration.id,
      "issues",
      issuePayload("reopened", { number: 99 }),
    );
    expect((await taskRow(unrelated.id)).status).toBe("done");
  });

  it("does not reopen tasks of another project that link the same repository", async () => {
    const a = await seedProject();
    const b = await seedProject();
    const done = { status: "done", columnId: undefined };
    const { task: taskA } = await seedTask(
      a,
      { ...done, columnId: a.columns.done.id },
      {},
    );
    const { task: taskB } = await seedTask(
      b,
      { ...done, columnId: b.columns.done.id },
      {},
    );
    await post(a.integration.id, "issues", issuePayload("reopened", {}));
    expect((await taskRow(taskA.id)).status).toBe("to-do");
    expect((await taskRow(taskB.id)).status).toBe("done");
  });

  it("swallows a per-integration failure when reopening and still answers 200", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(
      ctx,
      { status: "done", columnId: ctx.columns.done.id },
      {},
    );
    const result = await post(ctx.integration.id, "issues", {
      ...issuePayload("reopened", {}),
      issue: { number: null },
    });
    expect(result.status).toBe(200);
    expect((await taskRow(task.id)).status).toBe("done");
  });
});

describe("Gitea webhook: issue edited", () => {
  it("copies a changed title and body to the task and records the sync source", async () => {
    const ctx = await seedProject();
    const { task, link } = await seedTask(
      ctx,
      {},
      { metadata: JSON.stringify({ state: "open" }) },
    );
    const result = await post(
      ctx.integration.id,
      "issues",
      issuePayload(
        "edited",
        { title: "New title", body: "New body" },
        { changes: { title: { from: "Old" }, body: { from: "Old body" } } },
      ),
    );
    expect(result.status).toBe(200);
    const row = await taskRow(task.id);
    expect(row.title).toBe("New title");
    expect(row.description).toBe("New body");
    const stored = await linkRow(link?.id as string);
    expect(stored.title).toBe("New title");
    const metadata = JSON.parse(stored.metadata ?? "");
    expect(metadata.state).toBe("open");
    expect(metadata.lastSync.title).toMatchObject({
      source: "gitea",
      value: "New title",
    });
    expect(metadata.lastSync.description).toMatchObject({
      source: "gitea",
      value: "New body",
    });
  });

  it("stores an empty description when the issue body was cleared", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    await post(
      ctx.integration.id,
      "issues",
      issuePayload(
        "edited",
        { body: null },
        { changes: { body: { from: "x" } } },
      ),
    );
    const row = await taskRow(task.id);
    expect(row.description).toBe("");
    expect(row.title).toBe("Original title");
  });

  it("ignores edits that change neither title nor body, or have no linked task", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    const { task: unlinked } = await seedTask(ctx, { number: 4 });
    await post(
      ctx.integration.id,
      "issues",
      issuePayload("edited", { title: "Changed" }),
    );
    await post(
      ctx.integration.id,
      "issues",
      issuePayload("edited", { title: "Changed" }, { changes: {} }),
    );
    await post(
      ctx.integration.id,
      "issues",
      issuePayload(
        "edited",
        { number: 77, title: "Changed" },
        { changes: { title: { from: "a" } } },
      ),
    );
    expect((await taskRow(task.id)).title).toBe("Original title");
    expect((await taskRow(unlinked.id)).title).toBe("Original title");
  });

  it("skips the title that Kaneo itself just pushed, but still applies the body", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(
      ctx,
      {},
      {
        metadata: JSON.stringify({
          lastSync: {
            title: {
              timestamp: "2020-01-01T00:00:00.000Z",
              source: "kaneo",
              value: "Pushed title",
            },
          },
        }),
      },
    );
    await post(
      ctx.integration.id,
      "issues",
      issuePayload(
        "edited",
        { title: "Pushed title", body: "Edited in Gitea" },
        { changes: { title: { from: "a" }, body: { from: "b" } } },
      ),
    );
    const row = await taskRow(task.id);
    expect(row.title).toBe("Original title");
    expect(row.description).toBe("Edited in Gitea");
  });

  it("skips a title or body change that arrives within two seconds of the last sync", async () => {
    const ctx = await seedProject();
    const recent = {
      timestamp: new Date().toISOString(),
      source: "kaneo",
      value: "something else",
    };
    const { task } = await seedTask(
      ctx,
      {},
      {
        metadata: JSON.stringify({
          lastSync: { title: recent, description: recent },
        }),
      },
    );
    await post(
      ctx.integration.id,
      "issues",
      issuePayload(
        "edited",
        { title: "Racing title", body: "Racing body" },
        { changes: { title: { from: "a" }, body: { from: "b" } } },
      ),
    );
    const row = await taskRow(task.id);
    expect(row.title).toBe("Original title");
    expect(row.description).toBe("Original description");
  });

  it("applies a title that differs from an old Kaneo sync", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(
      ctx,
      {},
      {
        metadata: JSON.stringify({
          lastSync: {
            title: {
              timestamp: "2020-01-01T00:00:00.000Z",
              source: "kaneo",
              value: "Older",
            },
          },
        }),
      },
    );
    await post(
      ctx.integration.id,
      "issues",
      issuePayload(
        "edited",
        { title: "Fresh" },
        { changes: { title: { from: "Older" } } },
      ),
    );
    expect((await taskRow(task.id)).title).toBe("Fresh");
  });

  it("does not edit tasks of another project that link the same repository", async () => {
    const a = await seedProject();
    const b = await seedProject();
    const { task: taskA } = await seedTask(a, {}, {});
    const { task: taskB } = await seedTask(b, {}, {});
    await post(
      a.integration.id,
      "issues",
      issuePayload(
        "edited",
        { title: "Only A" },
        { changes: { title: { from: "x" } } },
      ),
    );
    expect((await taskRow(taskA.id)).title).toBe("Only A");
    expect((await taskRow(taskB.id)).title).toBe("Original title");
  });

  it("characterization: corrupt link metadata makes the edit webhook fail with 400", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, { metadata: "{corrupt" });
    const result = await post(
      ctx.integration.id,
      "issues",
      issuePayload(
        "edited",
        { title: "New" },
        { changes: { title: { from: "a" } } },
      ),
    );
    // The close/reopen handlers tolerate corrupt metadata; this one rejects it.
    expect(result.status).toBe(400);
    expect((await taskRow(task.id)).title).toBe("Original title");
  });
});

describe("Gitea webhook: issue labels", () => {
  async function labelsOf(taskId: string) {
    const rows = await db.query.labelTable.findMany({
      where: eq(schema.labelTable.taskId, taskId),
    });
    return rows
      .map((r) => ({
        name: r.name,
        color: r.color,
        workspaceId: r.workspaceId,
      }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }

  it("adds a label once, normalising the colour and scoping it to the task's workspace", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    const payload = issuePayload(
      "labeled",
      {},
      { label: { name: "bug", color: "ff0000" } },
    );
    await post(ctx.integration.id, "issues", payload);
    await post(ctx.integration.id, "issues", payload);
    await post(
      ctx.integration.id,
      "issues",
      issuePayload("labeled", {}, { label: { name: "plain", color: "" } }),
    );
    expect(await labelsOf(task.id)).toEqual([
      { name: "bug", color: "#ff0000", workspaceId: ctx.workspaceId },
      { name: "plain", color: "#6B7280", workspaceId: ctx.workspaceId },
    ]);
  });

  it("never stores priority:/status: labels as task labels, but applies them to the task", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    await post(
      ctx.integration.id,
      "issues",
      issuePayload(
        "labeled",
        { labels: [{ name: "priority:urgent" }, "status:in-progress"] },
        { label: { name: "priority:urgent", color: "ef4444" } },
      ),
    );
    const row = await taskRow(task.id);
    expect(row.priority).toBe("urgent");
    expect(row.status).toBe("in-progress");
    expect(row.columnId).toBe(ctx.columns.inProgress.id);
    expect(await labelsOf(task.id)).toEqual([]);
  });

  it("ignores an invalid priority label and a status without a column", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    await post(
      ctx.integration.id,
      "issues",
      issuePayload(
        "labeled",
        { labels: ["priority:asap", "status:does-not-exist"] },
        { label: { name: "x", color: "000000" } },
      ),
    );
    const row = await taskRow(task.id);
    expect(row.priority).toBe("low");
    expect(row.status).toBe("to-do");
  });

  it("does nothing for a labeled event without label, or for an unlinked issue", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    await post(ctx.integration.id, "issues", issuePayload("labeled", {}));
    await post(
      ctx.integration.id,
      "issues",
      issuePayload(
        "labeled",
        { number: 404 },
        { label: { name: "bug", color: "fff" } },
      ),
    );
    expect(await labelsOf(task.id)).toEqual([]);
  });

  it("removes only the named label of the linked task on unlabeled", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    const { task: sibling } = await seedTask(ctx, { number: 4 });
    await db.insert(schema.labelTable).values([
      {
        name: "bug",
        color: "#111111",
        taskId: task.id,
        workspaceId: ctx.workspaceId,
      },
      {
        name: "docs",
        color: "#222222",
        taskId: task.id,
        workspaceId: ctx.workspaceId,
      },
      {
        name: "bug",
        color: "#111111",
        taskId: sibling.id,
        workspaceId: ctx.workspaceId,
      },
    ]);
    await post(
      ctx.integration.id,
      "issues",
      issuePayload(
        "unlabeled",
        {},
        { label: { name: "bug", color: "111111" } },
      ),
    );
    expect((await labelsOf(task.id)).map((l) => l.name)).toEqual(["docs"]);
    expect((await labelsOf(sibling.id)).map((l) => l.name)).toEqual(["bug"]);
  });

  it("label_updated replaces the task labels with the issue's labels", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    await db.insert(schema.labelTable).values([
      {
        name: "bug",
        color: "#111111",
        taskId: task.id,
        workspaceId: ctx.workspaceId,
      },
      {
        name: "keep",
        color: "#abcdef",
        taskId: task.id,
        workspaceId: ctx.workspaceId,
      },
      {
        name: "obsolete",
        color: "#333333",
        taskId: task.id,
        workspaceId: ctx.workspaceId,
      },
      {
        name: "priority:high",
        color: "#444444",
        taskId: task.id,
        workspaceId: ctx.workspaceId,
      },
    ]);
    const result = await post(
      ctx.integration.id,
      "issues",
      issuePayload("label_updated", {
        labels: [
          { name: "bug", color: "ff0000" },
          { name: "keep", color: "#ABCDEF" },
          "docs",
          { name: "status:done" },
          { color: "ffffff" },
        ],
      }),
    );
    expect(result.status).toBe(200);
    expect(await labelsOf(task.id)).toEqual([
      { name: "bug", color: "#ff0000", workspaceId: ctx.workspaceId },
      { name: "docs", color: "#6B7280", workspaceId: ctx.workspaceId },
      // the payload colour is taken as sent (comparison is case-sensitive)
      { name: "keep", color: "#ABCDEF", workspaceId: ctx.workspaceId },
      { name: "priority:high", color: "#444444", workspaceId: ctx.workspaceId },
    ]);
    // the status label of the payload was applied to the task as a status
    expect((await taskRow(task.id)).status).toBe("done");
  });

  it("label_updated without a labels array keeps existing labels", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    await db.insert(schema.labelTable).values({
      name: "bug",
      color: "#111111",
      taskId: task.id,
      workspaceId: ctx.workspaceId,
    });
    await post(ctx.integration.id, "issues", issuePayload("label_updated", {}));
    expect((await labelsOf(task.id)).map((l) => l.name)).toEqual(["bug"]);
  });

  it("label_updated with an empty array clears non-system labels", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    await db.insert(schema.labelTable).values({
      name: "bug",
      color: "#111111",
      taskId: task.id,
      workspaceId: ctx.workspaceId,
    });
    await post(
      ctx.integration.id,
      "issues",
      issuePayload("label_updated", { labels: [] }),
    );
    expect(await labelsOf(task.id)).toEqual([]);
  });

  it("swallows a per-integration failure for labels and answers 200", async () => {
    const ctx = await seedProject();
    const result = await post(ctx.integration.id, "issues", {
      ...issuePayload("labeled", {}, { label: { name: "bug", color: "fff" } }),
      issue: { number: null },
    });
    expect(result.status).toBe(200);
    expect(await db.query.labelTable.findMany()).toEqual([]);
  });

  it("creates a workspace label from an issue_label event, once, in the integration's workspace only", async () => {
    const ctx = await seedProject();
    const other = await seedProject();
    const payload = {
      repository: REPO,
      label: { name: "feature", color: "00ff00" },
    };
    await post(ctx.integration.id, "issue_label", payload);
    await post(ctx.integration.id, "issue_label", payload);
    await post(ctx.integration.id, "issue_label", {
      repository: REPO,
      label: { name: "nocolor", color: "" },
    });
    const rows = await db.query.labelTable.findMany();
    expect(
      rows
        .map((r) => [r.name, r.color, r.workspaceId, r.taskId])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    ).toEqual([
      ["feature", "#00ff00", ctx.workspaceId, null],
      ["nocolor", "#6B7280", ctx.workspaceId, null],
    ]);
    expect(rows.some((r) => r.workspaceId === other.workspaceId)).toBe(false);
  });

  it("ignores issue_label events of another ref type or without label", async () => {
    const ctx = await seedProject();
    await post(ctx.integration.id, "issue_label", {
      repository: REPO,
      ref_type: "branch",
      label: { name: "x", color: "fff" },
    });
    await post(ctx.integration.id, "issue_label", { repository: REPO });
    const withType = await post(ctx.integration.id, "issue_label", {
      repository: REPO,
      ref_type: "label",
      label: { name: "typed", color: "fff" },
    });
    expect(withType.status).toBe(200);
    expect((await db.query.labelTable.findMany()).map((r) => r.name)).toEqual([
      "typed",
    ]);
  });
});

describe("Gitea webhook: issue comments", () => {
  const comment = (over: Record<string, unknown> = {}) => ({
    id: 11,
    body: "Hello from Gitea",
    html_url: "https://gitea.example/owner/repo/issues/5#issuecomment-11",
    user: { login: "alice", avatar_url: "https://gitea.example/a.png" },
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  });

  it("stores an external comment activity once on the linked task", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    const payload = {
      action: "created",
      issue: { number: 5 },
      comment: comment(),
      repository: REPO,
    };
    await post(ctx.integration.id, "issue_comment", payload);
    await post(ctx.integration.id, "issue_comment", payload);
    const rows = await db.query.activityTable.findMany({
      where: eq(schema.activityTable.taskId, task.id),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "comment",
      content: "Hello from Gitea",
      externalUserName: "alice",
      externalUserAvatar: "https://gitea.example/a.png",
      externalSource: "gitea",
      externalUrl: "https://gitea.example/owner/repo/issues/5#issuecomment-11",
      eventData: { externalCommentId: 11 },
    });
  });

  it("falls back to username, then to Unknown, for the author", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    await post(ctx.integration.id, "issue_comment", {
      action: "created",
      issue: { number: 5 },
      comment: comment({
        id: 1,
        html_url: "https://gitea.example/c1",
        user: { username: "bob" },
      }),
      repository: REPO,
    });
    await post(ctx.integration.id, "issue_comment", {
      action: "created",
      issue: { number: 5 },
      comment: comment({
        id: 2,
        html_url: "https://gitea.example/c2",
        user: null,
      }),
      repository: REPO,
    });
    const rows = await db.query.activityTable.findMany({
      where: eq(schema.activityTable.taskId, task.id),
    });
    expect(
      rows.map((r) => [r.externalUserName, r.externalUserAvatar]).sort(),
    ).toEqual([
      ["Unknown", null],
      ["bob", null],
    ]);
  });

  it("ignores bot comments and comments on unlinked issues", async () => {
    const ctx = await seedProject();
    await seedTask(ctx, {}, {});
    await post(ctx.integration.id, "issue_comment", {
      action: "created",
      issue: { number: 5 },
      comment: comment({ user: { login: "kaneo[bot]", avatar_url: "" } }),
      repository: REPO,
    });
    await post(ctx.integration.id, "issue_comment", {
      action: "created",
      issue: { number: 404 },
      comment: comment(),
      repository: REPO,
    });
    expect(await db.query.activityTable.findMany()).toEqual([]);
  });
});

describe("Gitea webhook: push", () => {
  const push = (ref: string, extra: Record<string, unknown> = {}) => ({
    ref,
    repository: REPO,
    ...extra,
  });

  async function branchLinks(taskId: string) {
    return db.query.externalLinkTable.findMany({
      where: and(
        eq(schema.externalLinkTable.taskId, taskId),
        eq(schema.externalLinkTable.resourceType, "branch"),
      ),
    });
  }

  it("links the branch to the task, records the head commit and starts the task", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx);
    const payload = push("refs/heads/kan-3-fix-login", {
      head_commit: {
        id: "abc123",
        message: "Fix login",
        author: { name: "Alice" },
        timestamp: "2026-01-01T00:00:00Z",
      },
    });
    const result = await post(ctx.integration.id, "push", payload);
    expect(result.status).toBe(200);
    const row = await taskRow(task.id);
    expect(row.status).toBe("in-progress");
    expect(row.columnId).toBe(ctx.columns.inProgress.id);
    const links = await branchLinks(task.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      externalId: "kan-3-fix-login",
      url: "https://gitea.example/owner/repo/src/branch/kan-3-fix-login",
      title: "kan-3-fix-login",
      integrationId: ctx.integration.id,
    });
    expect(JSON.parse(links[0].metadata ?? "")).toEqual({
      lastCommit: {
        sha: "abc123",
        message: "Fix login",
        author: "Alice",
        timestamp: "2026-01-01T00:00:00Z",
      },
    });

    // a second push to the same branch updates the link instead of duplicating it
    await post(
      ctx.integration.id,
      "push",
      push("refs/heads/kan-3-fix-login", {
        commits: [
          { id: "old", message: "first" },
          {
            id: "new",
            message: "second",
            author: { name: "Bob" },
            timestamp: "2026-02-02T00:00:00Z",
          },
        ],
      }),
    );
    const again = await branchLinks(task.id);
    expect(again).toHaveLength(1);
    expect(JSON.parse(again[0].metadata ?? "").lastCommit).toMatchObject({
      sha: "new",
      message: "second",
      author: "Bob",
    });
  });

  it("stores a null last commit when the push carries no commits", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx);
    await post(ctx.integration.id, "push", push("refs/heads/kan-3"));
    const links = await branchLinks(task.id);
    expect(JSON.parse(links[0].metadata ?? "")).toEqual({ lastCommit: null });
  });

  it("uses the configured branch-push status", async () => {
    const ctx = await seedProject({
      config: { statusTransitions: { onBranchPush: "in-review" } },
    });
    const { task } = await seedTask(ctx);
    await post(ctx.integration.id, "push", push("refs/heads/kan-3"));
    expect((await taskRow(task.id)).status).toBe("in-review");
  });

  it("honours a custom branch regex", async () => {
    const ctx = await seedProject({
      config: { customBranchRegex: "^feature/(\\d+)" },
    });
    const { task } = await seedTask(ctx);
    await post(ctx.integration.id, "push", push("refs/heads/feature/3-x"));
    expect((await taskRow(task.id)).status).toBe("in-progress");
  });

  it("ignores tags, protected branches, other prefixes and unknown task numbers", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx);
    for (const ref of [
      "refs/tags/kan-3",
      "refs/heads/main",
      "refs/heads/master",
      "refs/heads/develop",
      "refs/heads/staging",
      "refs/heads/production",
      "refs/heads/other-3",
      "refs/heads/kan-99",
      "refs/heads/kan-no-number",
    ]) {
      const result = await post(ctx.integration.id, "push", push(ref));
      expect(result.status, ref).toBe(200);
    }
    expect((await taskRow(task.id)).status).toBe("to-do");
    expect(await branchLinks(task.id)).toEqual([]);
  });

  it("links the branch but keeps a task that is already in a final column", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {
      status: "done",
      columnId: ctx.columns.done.id,
    });
    await post(ctx.integration.id, "push", push("refs/heads/kan-3"));
    expect((await taskRow(task.id)).status).toBe("done");
    expect(await branchLinks(task.id)).toHaveLength(1);
  });

  it("does not move a task that already has the target status", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {
      status: "in-progress",
      columnId: ctx.columns.inProgress.id,
    });
    await post(ctx.integration.id, "push", push("refs/heads/kan-3"));
    expect((await taskRow(task.id)).status).toBe("in-progress");
  });

  it("only updates the task of the signed integration's project", async () => {
    const a = await seedProject();
    const b = await seedProject();
    const { task: taskA } = await seedTask(a);
    const { task: taskB } = await seedTask(b);
    await post(a.integration.id, "push", push("refs/heads/kan-3"));
    expect((await taskRow(taskA.id)).status).toBe("in-progress");
    expect((await taskRow(taskB.id)).status).toBe("to-do");
    expect(await branchLinks(taskB.id)).toEqual([]);
  });

  it("ignores a push from another repository", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx);
    await post(ctx.integration.id, "push", {
      ref: "refs/heads/kan-3",
      repository: {
        ...REPO,
        name: "other",
        html_url: "https://gitea.example/owner/other",
      },
    });
    expect((await taskRow(task.id)).status).toBe("to-do");
  });
});

describe("Gitea webhook: issue opened", () => {
  const opened = (
    issue: Record<string, unknown> = {},
    action: "opened" | "created" = "created",
  ) => issuePayload(action, { user: { login: "octocat" }, ...issue });

  beforeEach(() => {
    process.env.KANEO_CLIENT_URL = "https://app.example";
  });
  afterEach(() => {
    delete process.env.KANEO_CLIENT_URL;
  });

  async function tasksIn(projectId: string) {
    return db.query.taskTable.findMany({
      where: eq(schema.taskTable.projectId, projectId),
    });
  }

  it("creates a linked task from priority/status labels and posts the task link back", async () => {
    const ctx = await seedProject();
    const result = await post(
      ctx.integration.id,
      "issues",
      opened({ labels: [{ name: "priority:high" }, "status:in-progress"] }),
    );
    expect(result.status).toBe(200);
    const [task] = await tasksIn(ctx.project.id);
    expect(task).toMatchObject({
      title: "Issue title",
      description: "Issue body",
      status: "in-progress",
      columnId: ctx.columns.inProgress.id,
      priority: "high",
      number: 1,
      userId: null,
    });
    const links = await db.query.externalLinkTable.findMany();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      taskId: task.id,
      integrationId: ctx.integration.id,
      resourceType: "issue",
      externalId: "5",
      url: "https://gitea.example/owner/repo/issues/5",
    });
    expect(JSON.parse(links[0].metadata ?? "")).toEqual({
      state: "open",
      createdFrom: "gitea",
      author: "octocat",
    });
    const comments = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/issues/5/comments"),
    );
    expect(comments).toHaveLength(1);
    expect(String(comments[0][0])).toBe(
      "https://gitea.example/api/v1/repos/owner/repo/issues/5/comments",
    );
    expect(JSON.parse(String(comments[0][1].body))).toEqual({
      body: `[KAN-1](https://app.example/dashboard/workspace/${ctx.workspaceId}/project/${ctx.project.id}/task/${task.id})`,
    });
    expect(comments[0][1].headers.Authorization).toBe(`token ${TOKEN}`);
    // Labels already on the issue are not added again.
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/labels")),
    ).toEqual([]);
  });

  it("handles the opened action, redelivery and defaults without duplicating tasks", async () => {
    const ctx = await seedProject();
    await post(ctx.integration.id, "issues", opened({ user: null }, "opened"));
    await post(ctx.integration.id, "issues", opened({}, "created"));
    const tasks = await tasksIn(ctx.project.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      status: "to-do",
      priority: "low",
      columnId: ctx.columns.todo.id,
    });
    const [link] = await db.query.externalLinkTable.findMany();
    expect(JSON.parse(link.metadata ?? "")).toEqual({
      state: "open",
      createdFrom: "gitea",
    });
  });

  it("uses the username when there is no login, an empty body and the workflow rule for new issues", async () => {
    const ctx = await seedProject();
    await db.insert(schema.workflowRuleTable).values({
      projectId: ctx.project.id,
      integrationType: "gitea",
      eventType: "issue_opened",
      columnId: ctx.columns.inReview.id,
    });
    await post(
      ctx.integration.id,
      "issues",
      opened({ body: null, user: { username: "legacy" } }),
    );
    const [task] = await tasksIn(ctx.project.id);
    expect(task).toMatchObject({ status: "in-review", description: "" });
    const [link] = await db.query.externalLinkTable.findMany();
    expect(JSON.parse(link.metadata ?? "").author).toBe("legacy");
  });

  it("does not comment when the project disabled comment links, and survives a failing comment", async () => {
    const off = await seedProject({
      config: { commentTaskLinkOnGiteaIssue: false },
    });
    await post(off.integration.id, "issues", opened());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await tasksIn(off.project.id)).toHaveLength(1);

    fetchMock.mockResolvedValue(new Response("down", { status: 500 }));
    const on = await seedProject();
    const result = await post(on.integration.id, "issues", opened());
    expect(result.status).toBe(200);
    expect(await tasksIn(on.project.id)).toHaveLength(1);
  });

  it("creates the task only in the signed integration's project", async () => {
    const a = await seedProject();
    const b = await seedProject();
    await post(a.integration.id, "issues", opened());
    expect(await tasksIn(a.project.id)).toHaveLength(1);
    expect(await tasksIn(b.project.id)).toEqual([]);
  });

  it("falls back to to-do without a column when the project has none", async () => {
    const ctx = await seedProject();
    await db
      .delete(schema.columnTable)
      .where(eq(schema.columnTable.projectId, ctx.project.id));
    await post(ctx.integration.id, "issues", opened());
    const [task] = await tasksIn(ctx.project.id);
    expect(task).toMatchObject({ status: "to-do", columnId: null });
  });
});

describe("Gitea webhook: workflow fallbacks without the default column", () => {
  it("never writes a status that has no column", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    await db
      .delete(schema.columnTable)
      .where(eq(schema.columnTable.projectId, ctx.project.id));
    await post(ctx.integration.id, "issues", issuePayload("closed", {}));
    expect((await taskRow(task.id)).status).toBe("to-do");
  });

  it("uses the first column when the default target column does not exist", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(
      ctx,
      { status: "in-progress", columnId: ctx.columns.inProgress.id },
      {},
    );
    await db
      .delete(schema.columnTable)
      .where(eq(schema.columnTable.id, ctx.columns.done.id));
    await post(ctx.integration.id, "issues", issuePayload("closed", {}));
    const row = await taskRow(task.id);
    expect(row.status).toBe("to-do");
    expect(row.columnId).toBe(ctx.columns.todo.id);
  });
});

describe("Gitea webhook: pull requests", () => {
  const pr = (action: string, extra: Record<string, unknown> = {}) => ({
    action,
    pull_request: {
      number: 9,
      title: "Work",
      body: null,
      html_url: "https://gitea.example/owner/repo/pulls/9",
      state: "open",
      draft: false,
      merged: false,
      merged_at: null,
      head: { ref: "kan-3-work" },
      user: { login: "dave" },
      ...extra,
    },
    repository: REPO,
  });

  it("links an opened or reopened PR by branch name, moves the task to review, and ignores redelivery", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx);
    await post(ctx.integration.id, "pull_request", pr("opened"));
    await post(ctx.integration.id, "pull_request", pr("reopened"));
    expect((await taskRow(task.id)).status).toBe("in-review");
    const links = await db.query.externalLinkTable.findMany({
      where: eq(schema.externalLinkTable.resourceType, "pull_request"),
    });
    expect(links).toHaveLength(1);
    expect(JSON.parse(links[0].metadata ?? "")).toEqual({
      state: "open",
      draft: false,
      merged: false,
      branch: "kan-3-work",
      author: "dave",
    });
  });

  it("does not link a PR whose number belongs to a task of another project", async () => {
    const a = await seedProject();
    const b = await seedProject();
    const { task: taskB } = await seedTask(b);
    await post(a.integration.id, "pull_request", pr("opened"));
    expect(await db.query.externalLinkTable.findMany()).toEqual([]);
    expect((await taskRow(taskB.id)).status).toBe("to-do");
  });

  it("marks a merged PR closed and completes the task unless another PR is still open", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(
      ctx,
      { status: "in-review", columnId: ctx.columns.inReview.id },
      {
        externalId: "9",
        resourceType: "pull_request",
        metadata: JSON.stringify({ state: "open", branch: "kan-3-work" }),
      },
    );
    await db.insert(schema.externalLinkTable).values({
      taskId: task.id,
      integrationId: ctx.integration.id,
      resourceType: "pull_request",
      externalId: "10",
      url: "u",
      metadata: JSON.stringify({ state: "open" }),
    });
    await post(
      ctx.integration.id,
      "pull_request",
      pr("closed", {
        state: "closed",
        merged: true,
        merged_at: "2026-01-01T00:00:00Z",
      }),
    );
    expect((await taskRow(task.id)).status).toBe("in-review");
    const merged = await db.query.externalLinkTable.findFirst({
      where: eq(schema.externalLinkTable.externalId, "9"),
    });
    expect(JSON.parse(merged?.metadata ?? "")).toEqual({
      state: "closed",
      branch: "kan-3-work",
      merged: true,
      mergedAt: "2026-01-01T00:00:00Z",
    });

    await db
      .update(schema.externalLinkTable)
      .set({ metadata: JSON.stringify({ state: "closed" }) })
      .where(eq(schema.externalLinkTable.externalId, "10"));
    await post(
      ctx.integration.id,
      "pull_request",
      pr("closed", {
        state: "closed",
        merged: true,
        merged_at: "2026-01-01T00:00:00Z",
      }),
    );
    expect((await taskRow(task.id)).status).toBe("done");
  });

  it("keeps the task when a PR is closed without merging, and ignores unknown PRs", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(
      ctx,
      { status: "in-review", columnId: ctx.columns.inReview.id },
      { externalId: "9", resourceType: "pull_request", metadata: null },
    );
    await post(
      ctx.integration.id,
      "pull_request",
      pr("closed", { number: 404, state: "closed", merged: true }),
    );
    await post(
      ctx.integration.id,
      "pull_request",
      pr("closed", { state: "closed" }),
    );
    expect((await taskRow(task.id)).status).toBe("in-review");
    const link = await db.query.externalLinkTable.findFirst({
      where: eq(schema.externalLinkTable.externalId, "9"),
    });
    expect(JSON.parse(link?.metadata ?? "")).toMatchObject({
      state: "closed",
      merged: false,
    });
  });
});

describe("Gitea webhook: remaining guards", () => {
  it("answers 400 when the route has no integration id", async () => {
    const reply = await handleGiteaWebhookRoute({
      req: { param: () => undefined },
      json: (body: unknown, status: number) => ({ body, status }),
    } as never);
    expect(reply).toEqual({
      body: { error: "Missing integration id" },
      status: 400,
    });
  });

  it("does not act on close/reopen handlers called with a different action", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    const payload = issuePayload("edited", {}) as never;
    await handleGiteaIssueClosed(payload, ctx.integration.id);
    await handleGiteaIssueReopened(payload, ctx.integration.id);
    expect((await taskRow(task.id)).status).toBe("to-do");
  });

  it("ignores an integration whose stored base URL is unusable", async () => {
    const ctx = await seedProject({ config: { baseUrl: "not-a-url" } });
    const { task } = await seedTask(ctx, {}, {});
    const result = await post(
      ctx.integration.id,
      "issues",
      issuePayload("closed", {}),
    );
    expect(result.status).toBe(200);
    expect((await taskRow(task.id)).status).toBe("to-do");
  });

  it("ignores comment and push events whose repository URL is unusable", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(ctx, {}, {});
    const badRepo = { ...REPO, html_url: "nonsense" };
    await post(ctx.integration.id, "issue_comment", {
      action: "created",
      issue: { number: 5 },
      comment: { id: 1, body: "x", html_url: "u", user: null, created_at: "" },
      repository: badRepo,
    });
    await post(ctx.integration.id, "push", {
      ref: "refs/heads/kan-3",
      repository: badRepo,
    });
    expect(await db.query.activityTable.findMany()).toEqual([]);
    expect((await taskRow(task.id)).status).toBe("to-do");
  });

  it("skips a description edit that echoes Kaneo's own push", async () => {
    const ctx = await seedProject();
    const { task } = await seedTask(
      ctx,
      {},
      {
        metadata: JSON.stringify({
          lastSync: {
            description: {
              timestamp: "2020-01-01T00:00:00.000Z",
              source: "kaneo",
              value: "Pushed body",
            },
          },
        }),
      },
    );
    await post(
      ctx.integration.id,
      "issues",
      issuePayload(
        "edited",
        { body: "Pushed body" },
        { changes: { body: { from: "x" } } },
      ),
    );
    expect((await taskRow(task.id)).description).toBe("Original description");
  });
});
