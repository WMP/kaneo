import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { handleTaskCommentCreated } from "../../apps/api/src/plugins/gitea/events/task-comment-created";
import { handleTaskCreated } from "../../apps/api/src/plugins/gitea/events/task-created";
import { handleTaskDescriptionChanged } from "../../apps/api/src/plugins/gitea/events/task-description-changed";
import { handleTaskPriorityChanged } from "../../apps/api/src/plugins/gitea/events/task-priority-changed";
import { handleTaskStatusChanged } from "../../apps/api/src/plugins/gitea/events/task-status-changed";
import { handleTaskTitleChanged } from "../../apps/api/src/plugins/gitea/events/task-title-changed";
import {
  addLabelsToIssueGitea,
  ensureLabelsExistGitea,
  removeLabelGitea,
} from "../../apps/api/src/plugins/gitea/utils/labels";
import {
  removeLabelFromGitea,
  syncLabelToGitea,
} from "../../apps/api/src/plugins/gitea/utils/sync-label-to-gitea";
import type { PluginContext } from "../../apps/api/src/plugins/types";
import { createFakeGitea } from "./coverage-gitea-fake";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const TOKEN = "gitea-pat-events-secret-token";
const baseConfig = {
  baseUrl: "https://gitea.example",
  accessToken: TOKEN,
  repositoryOwner: "owner",
  repositoryName: "repo",
};

async function seed(configOverride: Record<string, unknown> = {}) {
  const { workspace } = await createWorkspaceMember();
  const { project, columns } = await createProjectFixture({
    workspaceId: workspace.id,
    slug: "kan",
  });
  const config = { ...baseConfig, ...configOverride };
  const [integration] = await db
    .insert(schema.integrationTable)
    .values({
      projectId: project.id,
      type: "gitea",
      config: JSON.stringify(config),
    })
    .returning();
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Task title",
      status: "to-do",
      columnId: columns.todo.id,
      priority: "medium",
      number: 1,
      position: 1,
    })
    .returning();
  const context: PluginContext = {
    integrationId: integration.id,
    projectId: project.id,
    config,
  };
  return { workspace, project, integration, task, context, columns };
}

async function addIssueLink(
  taskId: string,
  integrationId: string,
  externalId = "7",
  metadata?: Record<string, unknown> | string,
) {
  const [link] = await db
    .insert(schema.externalLinkTable)
    .values({
      taskId,
      integrationId,
      resourceType: "issue",
      externalId,
      url: `https://gitea.example/owner/repo/issues/${externalId}`,
      title: "Linked",
      metadata:
        typeof metadata === "string"
          ? metadata
          : metadata
            ? JSON.stringify(metadata)
            : null,
    })
    .returning();
  return link;
}

async function linksOf(taskId: string) {
  return db.query.externalLinkTable.findMany({
    where: eq(schema.externalLinkTable.taskId, taskId),
  });
}

let fake: ReturnType<typeof createFakeGitea>;
const originalAllowPrivate =
  process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;

function useFake(options?: Parameters<typeof createFakeGitea>[0]) {
  fake = createFakeGitea(options);
  vi.stubGlobal("fetch", fake.fetch);
}

beforeEach(async () => {
  await resetTestDatabase();
  process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
  useFake();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalAllowPrivate === undefined) {
    delete process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
  } else {
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = originalAllowPrivate;
  }
});

const createdEvent = (
  s: Awaited<ReturnType<typeof seed>>,
  over: Record<string, unknown> = {},
) => ({
  taskId: s.task.id,
  projectId: s.project.id,
  userId: "u1",
  title: "Task title",
  description: "Some description",
  priority: "high",
  status: "to-do",
  number: 1,
  ...over,
});

describe("Gitea plugin: task created", () => {
  it("creates the issue with the task body, links it and adds priority/status labels", async () => {
    const s = await seed();
    await handleTaskCreated(createdEvent(s), s.context);

    const posted = fake.callsTo("POST", /^\/repos\/owner\/repo\/issues$/);
    expect(posted).toHaveLength(1);
    expect(posted[0].authorization).toBe(`token ${TOKEN}`);
    expect(posted[0].body).toEqual({
      title: "Task title",
      body: `Some description\n\n---\n<sub>Task: ${s.task.id}</sub>`,
    });

    const links = await linksOf(s.task.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      integrationId: s.integration.id,
      resourceType: "issue",
      externalId: "500",
      url: "https://gitea.example/owner/repo/issues/500",
    });
    const metadata = JSON.parse(links[0].metadata ?? "");
    expect(metadata).toMatchObject({ state: "open", createdFrom: "kaneo" });
    expect(typeof metadata.lastOutboundStateSyncAt).toBe("number");

    expect(fake.labels.map((l) => [l.name, l.color]).sort()).toEqual([
      ["priority:high", "F97316"],
      ["status:to-do", "6B7280"],
    ]);
    expect(
      fake.issues
        .get(500)
        ?.labels.map((l) => l.name)
        .sort(),
    ).toEqual(["priority:high", "status:to-do"]);
  });

  it("does not create a second issue for a task that is already linked", async () => {
    const s = await seed();
    await addIssueLink(s.task.id, s.integration.id);
    await handleTaskCreated(createdEvent(s), s.context);
    expect(fake.calls).toEqual([]);
    expect(await linksOf(s.task.id)).toHaveLength(1);
  });

  it("does nothing without a token or base URL", async () => {
    const s = await seed();
    await handleTaskCreated(createdEvent(s), {
      ...s.context,
      config: { ...baseConfig, accessToken: "" },
    });
    await handleTaskCreated(createdEvent(s), {
      ...s.context,
      config: { ...baseConfig, baseUrl: "" },
    });
    expect(fake.calls).toEqual([]);
    expect(await linksOf(s.task.id)).toEqual([]);
  });

  it("creates no link when Gitea rejects the issue", async () => {
    const s = await seed();
    fake.setOverride((call) =>
      call.method === "POST" && /\/issues$/.test(call.path)
        ? new Response("denied", { status: 403 })
        : undefined,
    );
    await expect(handleTaskCreated(createdEvent(s), s.context)).resolves.toBe(
      undefined,
    );
    expect(await linksOf(s.task.id)).toEqual([]);
  });
});

describe("Gitea plugin: status and priority sync", () => {
  it("swaps the status label and closes the issue when the task is done", async () => {
    const s = await seed();
    const link = await addIssueLink(s.task.id, s.integration.id, "7", {
      createdFrom: "kaneo",
    });
    useFake({
      labels: [{ id: 1, name: "status:in-review", color: "8B5CF6" }],
      issues: [
        {
          number: 7,
          state: "open",
          labels: [{ id: 1, name: "status:in-review", color: "8B5CF6" }],
        },
      ],
    });
    await handleTaskStatusChanged(
      {
        taskId: s.task.id,
        projectId: s.project.id,
        userId: null,
        oldStatus: "in-review",
        newStatus: "done",
        title: "Task title",
      },
      s.context,
    );
    expect(fake.issues.get(7)?.labels.map((l) => l.name)).toEqual([
      "status:done",
    ]);
    const patch = fake.callsTo("PATCH", /^\/repos\/owner\/repo\/issues\/7$/);
    expect(patch.map((c) => c.body)).toEqual([{ state: "closed" }]);
    const stored = await db.query.externalLinkTable.findFirst({
      where: eq(schema.externalLinkTable.id, link.id),
    });
    const metadata = JSON.parse(stored?.metadata ?? "");
    expect(metadata).toMatchObject({ createdFrom: "kaneo", state: "closed" });
    expect(
      Math.abs(metadata.lastOutboundStateSyncAt - Date.now()),
    ).toBeLessThan(60_000);
  });

  it("reopens the issue when a done task moves back", async () => {
    const s = await seed();
    const link = await addIssueLink(s.task.id, s.integration.id, "7");
    useFake({ issues: [{ number: 7, state: "closed", labels: [] }] });
    await handleTaskStatusChanged(
      {
        taskId: s.task.id,
        projectId: s.project.id,
        userId: null,
        oldStatus: "done",
        newStatus: "in-progress",
        title: "t",
      },
      s.context,
    );
    expect(fake.callsTo("PATCH", /issues\/7$/).map((c) => c.body)).toEqual([
      { state: "open" },
    ]);
    const stored = await db.query.externalLinkTable.findFirst({
      where: eq(schema.externalLinkTable.id, link.id),
    });
    expect(JSON.parse(stored?.metadata ?? "").state).toBe("open");
  });

  it("only relabels for a non-final transition and never closes", async () => {
    const s = await seed();
    await addIssueLink(s.task.id, s.integration.id, "7");
    useFake({ issues: [{ number: 7, state: "open", labels: [] }] });
    await handleTaskStatusChanged(
      {
        taskId: s.task.id,
        projectId: s.project.id,
        userId: null,
        oldStatus: "to-do",
        newStatus: "in-progress",
        title: "t",
      },
      s.context,
    );
    expect(fake.callsTo("PATCH", /issues/)).toEqual([]);
    expect(fake.issues.get(7)?.labels.map((l) => l.name)).toEqual([
      "status:in-progress",
    ]);
  });

  it("ignores tasks without an issue link of this integration and missing credentials", async () => {
    const s = await seed();
    const other = await seed();
    await addIssueLink(s.task.id, other.integration.id, "7");
    const event = {
      taskId: s.task.id,
      projectId: s.project.id,
      userId: null,
      oldStatus: "to-do",
      newStatus: "done",
      title: "t",
    };
    await handleTaskStatusChanged(event, s.context);
    await handleTaskStatusChanged(event, {
      ...s.context,
      config: { ...baseConfig, accessToken: "" },
    });
    expect(fake.calls).toEqual([]);
  });

  it("swallows Gitea failures while syncing the status", async () => {
    const s = await seed();
    const link = await addIssueLink(s.task.id, s.integration.id, "7", {
      state: "open",
    });
    useFake({ issues: [{ number: 7, state: "open", labels: [] }] });
    fake.setOverride((call) =>
      call.method === "PATCH"
        ? new Response("boom", { status: 500 })
        : undefined,
    );
    await expect(
      handleTaskStatusChanged(
        {
          taskId: s.task.id,
          projectId: s.project.id,
          userId: null,
          oldStatus: "to-do",
          newStatus: "done",
          title: "t",
        },
        s.context,
      ),
    ).resolves.toBe(undefined);
    const stored = await db.query.externalLinkTable.findFirst({
      where: eq(schema.externalLinkTable.id, link.id),
    });
    expect(JSON.parse(stored?.metadata ?? "")).toEqual({ state: "open" });
  });

  it("replaces the priority label and skips no-priority on either side", async () => {
    const s = await seed();
    await addIssueLink(s.task.id, s.integration.id, "7");
    useFake({
      labels: [{ id: 1, name: "priority:low", color: "0EA5E9" }],
      issues: [
        {
          number: 7,
          state: "open",
          labels: [{ id: 1, name: "priority:low", color: "0EA5E9" }],
        },
      ],
    });
    const base = {
      taskId: s.task.id,
      projectId: s.project.id,
      userId: null,
      title: "t",
    };
    await handleTaskPriorityChanged(
      { ...base, oldPriority: "low", newPriority: "urgent" },
      s.context,
    );
    expect(fake.issues.get(7)?.labels.map((l) => l.name)).toEqual([
      "priority:urgent",
    ]);
    expect(fake.labels.find((l) => l.name === "priority:urgent")?.color).toBe(
      "EF4444",
    );

    const before = fake.calls.length;
    await handleTaskPriorityChanged(
      { ...base, oldPriority: "no-priority", newPriority: "no-priority" },
      s.context,
    );
    expect(fake.calls.length).toBe(before);

    await handleTaskPriorityChanged(
      { ...base, oldPriority: "urgent", newPriority: "no-priority" },
      s.context,
    );
    expect(fake.issues.get(7)?.labels).toEqual([]);
  });

  it("does nothing for priority changes without a link or credentials", async () => {
    const s = await seed();
    const event = {
      taskId: s.task.id,
      projectId: s.project.id,
      userId: null,
      oldPriority: "low",
      newPriority: "high",
      title: "t",
    };
    await handleTaskPriorityChanged(event, s.context);
    await handleTaskPriorityChanged(event, {
      ...s.context,
      config: { ...baseConfig, baseUrl: "" },
    });
    expect(fake.calls).toEqual([]);
  });

  it("swallows a failure while syncing the priority", async () => {
    const s = await seed();
    await addIssueLink(s.task.id, s.integration.id, "7");
    useFake({ issues: [{ number: 7, state: "open", labels: [] }] });
    fake.setOverride(() => new Response("down", { status: 502 }));
    await expect(
      handleTaskPriorityChanged(
        {
          taskId: s.task.id,
          projectId: s.project.id,
          userId: null,
          oldPriority: "low",
          newPriority: "high",
          title: "t",
        },
        s.context,
      ),
    ).resolves.toBe(undefined);
  });
});

describe("Gitea plugin: title, description and comment sync", () => {
  const titleEvent = (
    s: Awaited<ReturnType<typeof seed>>,
    newTitle: string,
  ) => ({
    taskId: s.task.id,
    projectId: s.project.id,
    userId: null,
    oldTitle: "Task title",
    newTitle,
  });
  const descEvent = (
    s: Awaited<ReturnType<typeof seed>>,
    newDescription: string | null,
  ) => ({
    taskId: s.task.id,
    projectId: s.project.id,
    userId: null,
    oldDescription: null,
    newDescription,
  });

  it("pushes a new title to the linked issue and records the sync", async () => {
    const s = await seed();
    const link = await addIssueLink(s.task.id, s.integration.id, "7", {
      state: "open",
    });
    await handleTaskTitleChanged(titleEvent(s, "Renamed"), s.context);
    expect(fake.callsTo("PATCH", /issues\/7$/).map((c) => c.body)).toEqual([
      { title: "Renamed" },
    ]);
    const stored = await db.query.externalLinkTable.findFirst({
      where: eq(schema.externalLinkTable.id, link.id),
    });
    expect(stored?.title).toBe("Renamed");
    const metadata = JSON.parse(stored?.metadata ?? "");
    expect(metadata.state).toBe("open");
    expect(metadata.lastSync.title).toMatchObject({
      source: "kaneo",
      value: "Renamed",
    });
  });

  it("does not echo a title that just came from Gitea", async () => {
    const s = await seed();
    await addIssueLink(s.task.id, s.integration.id, "7", {
      lastSync: {
        title: {
          timestamp: "2020-01-01T00:00:00.000Z",
          source: "gitea",
          value: "From Gitea",
        },
      },
    });
    await handleTaskTitleChanged(titleEvent(s, "From Gitea"), s.context);
    expect(fake.calls).toEqual([]);

    // a different value within two seconds of a Gitea sync is also treated as an echo
    await db
      .update(schema.externalLinkTable)
      .set({
        metadata: JSON.stringify({
          lastSync: {
            title: {
              timestamp: new Date().toISOString(),
              source: "gitea",
              value: "Other",
            },
          },
        }),
      })
      .where(eq(schema.externalLinkTable.taskId, s.task.id));
    await handleTaskTitleChanged(titleEvent(s, "Racing"), s.context);
    expect(fake.calls).toEqual([]);

    // an old Gitea sync with another value does not block a real change
    await db
      .update(schema.externalLinkTable)
      .set({
        metadata: JSON.stringify({
          lastSync: {
            title: {
              timestamp: "2020-01-01T00:00:00.000Z",
              source: "gitea",
              value: "Other",
            },
          },
        }),
      })
      .where(eq(schema.externalLinkTable.taskId, s.task.id));
    await handleTaskTitleChanged(titleEvent(s, "Real change"), s.context);
    expect(fake.callsTo("PATCH", /issues\/7$/)).toHaveLength(1);
  });

  it("recovers from corrupt link metadata and still pushes the title", async () => {
    const s = await seed();
    await addIssueLink(s.task.id, s.integration.id, "7", "{corrupt");
    await handleTaskTitleChanged(titleEvent(s, "Renamed"), s.context);
    expect(fake.callsTo("PATCH", /issues\/7$/)).toHaveLength(1);
  });

  it("skips title sync for a non-numeric issue id, a missing link and missing credentials", async () => {
    const s = await seed();
    await addIssueLink(s.task.id, s.integration.id, "abc");
    await handleTaskTitleChanged(titleEvent(s, "x"), s.context);
    await handleTaskTitleChanged(titleEvent(s, "x"), {
      ...s.context,
      config: { ...baseConfig, accessToken: "" },
    });
    const lonely = await seed();
    await handleTaskTitleChanged(titleEvent(lonely, "x"), lonely.context);
    expect(fake.calls).toEqual([]);
  });

  it("keeps the link untouched when Gitea refuses the title update", async () => {
    const s = await seed();
    const link = await addIssueLink(s.task.id, s.integration.id, "7", {
      state: "open",
    });
    fake.setOverride(() => new Response("nope", { status: 500 }));
    await handleTaskTitleChanged(titleEvent(s, "Renamed"), s.context);
    const stored = await db.query.externalLinkTable.findFirst({
      where: eq(schema.externalLinkTable.id, link.id),
    });
    expect(stored?.title).toBe("Linked");
    expect(JSON.parse(stored?.metadata ?? "")).toEqual({ state: "open" });
  });

  it("pushes a new description with the task footer and records the sync", async () => {
    const s = await seed();
    const link = await addIssueLink(s.task.id, s.integration.id, "7");
    await handleTaskDescriptionChanged(descEvent(s, "New text"), s.context);
    expect(fake.callsTo("PATCH", /issues\/7$/).map((c) => c.body)).toEqual([
      { body: `New text\n\n---\n<sub>Task: ${s.task.id}</sub>` },
    ]);
    const stored = await db.query.externalLinkTable.findFirst({
      where: eq(schema.externalLinkTable.id, link.id),
    });
    expect(
      JSON.parse(stored?.metadata ?? "").lastSync.description,
    ).toMatchObject({
      source: "kaneo",
      value: "New text",
    });

    await handleTaskDescriptionChanged(descEvent(s, null), s.context);
    expect(fake.callsTo("PATCH", /issues\/7$/).pop()?.body).toEqual({
      body: `<sub>Task: ${s.task.id}</sub>`,
    });
  });

  it("does not echo a description that just came from Gitea", async () => {
    const s = await seed();
    await addIssueLink(s.task.id, s.integration.id, "7", {
      lastSync: {
        description: {
          timestamp: "2020-01-01T00:00:00.000Z",
          source: "gitea",
          value: "From Gitea",
        },
      },
    });
    await handleTaskDescriptionChanged(descEvent(s, "From Gitea"), s.context);
    expect(fake.calls).toEqual([]);

    await db
      .update(schema.externalLinkTable)
      .set({
        metadata: JSON.stringify({
          lastSync: {
            description: {
              timestamp: new Date().toISOString(),
              source: "gitea",
              value: "Same",
            },
          },
        }),
      })
      .where(eq(schema.externalLinkTable.taskId, s.task.id));
    await handleTaskDescriptionChanged(descEvent(s, "Same"), s.context);
    expect(fake.calls).toEqual([]);

    await handleTaskDescriptionChanged(descEvent(s, "Different"), s.context);
    expect(fake.callsTo("PATCH", /issues\/7$/)).toHaveLength(1);
  });

  it("covers description edge cases: corrupt metadata, bad issue id, no link, no credentials, Gitea error", async () => {
    const s = await seed();
    const link = await addIssueLink(
      s.task.id,
      s.integration.id,
      "7",
      "{corrupt",
    );
    await handleTaskDescriptionChanged(descEvent(s, "ok"), s.context);
    expect(fake.callsTo("PATCH", /issues\/7$/)).toHaveLength(1);

    fake.setOverride(() => new Response("x", { status: 500 }));
    await db
      .update(schema.externalLinkTable)
      .set({ metadata: JSON.stringify({ state: "open" }) })
      .where(eq(schema.externalLinkTable.id, link.id));
    await handleTaskDescriptionChanged(descEvent(s, "fails"), s.context);
    const stored = await db.query.externalLinkTable.findFirst({
      where: eq(schema.externalLinkTable.id, link.id),
    });
    expect(JSON.parse(stored?.metadata ?? "")).toEqual({ state: "open" });

    useFake();
    await db
      .update(schema.externalLinkTable)
      .set({ externalId: "not-a-number" })
      .where(eq(schema.externalLinkTable.id, link.id));
    await handleTaskDescriptionChanged(descEvent(s, "x"), s.context);
    await handleTaskDescriptionChanged(descEvent(s, "x"), {
      ...s.context,
      config: { ...baseConfig, baseUrl: "" },
    });
    const lonely = await seed();
    await handleTaskDescriptionChanged(descEvent(lonely, "x"), lonely.context);
    expect(fake.calls).toEqual([]);
  });

  it("posts a task comment to the linked issue", async () => {
    const s = await seed();
    await addIssueLink(s.task.id, s.integration.id, "7");
    await handleTaskCommentCreated(
      {
        taskId: s.task.id,
        projectId: s.project.id,
        userId: "u1",
        comment: "Looks good",
      },
      s.context,
    );
    expect(
      fake.callsTo("POST", /issues\/7\/comments$/).map((c) => c.body),
    ).toEqual([{ body: "Looks good" }]);
  });

  it("does not post comments for invalid issue ids, missing links or missing credentials", async () => {
    const s = await seed();
    const event = {
      taskId: s.task.id,
      projectId: s.project.id,
      userId: "u1",
      comment: "hi",
    };
    await handleTaskCommentCreated(event, s.context);
    const link = await addIssueLink(s.task.id, s.integration.id, "abc");
    await handleTaskCommentCreated(event, s.context);
    await db
      .update(schema.externalLinkTable)
      .set({ externalId: "0" })
      .where(eq(schema.externalLinkTable.id, link.id));
    await handleTaskCommentCreated(event, s.context);
    await handleTaskCommentCreated(event, {
      ...s.context,
      config: { ...baseConfig, accessToken: "" },
    });
    expect(fake.calls).toEqual([]);
  });

  it("swallows a comment failure from Gitea", async () => {
    const s = await seed();
    await addIssueLink(s.task.id, s.integration.id, "7");
    fake.setOverride(() => new Response("x", { status: 500 }));
    await expect(
      handleTaskCommentCreated(
        {
          taskId: s.task.id,
          projectId: s.project.id,
          userId: "u1",
          comment: "hi",
        },
        s.context,
      ),
    ).resolves.toBe(undefined);
  });
});

describe("Gitea label sync", () => {
  it("creates a missing label with a hex colour and attaches it to the linked issue", async () => {
    const s = await seed();
    await addIssueLink(s.task.id, s.integration.id, "7");
    useFake({ issues: [{ number: 7, state: "open", labels: [] }] });
    await syncLabelToGitea(s.task.id, "bug", "blue");
    await syncLabelToGitea(s.task.id, "short", "#F0A");
    await syncLabelToGitea(s.task.id, "weird", "not-a-colour");
    await syncLabelToGitea(s.task.id, "hex", "#AbCdEf");
    expect(fake.labels.map((l) => [l.name, l.color])).toEqual([
      ["bug", "3B82F6"],
      ["short", "ff00aa"],
      ["weird", "6B7280"],
      ["hex", "abcdef"],
    ]);
    expect(fake.issues.get(7)?.labels.map((l) => l.name)).toEqual([
      "bug",
      "short",
      "weird",
      "hex",
    ]);
  });

  it("reuses an existing label and does not attach it twice", async () => {
    const s = await seed();
    await addIssueLink(s.task.id, s.integration.id, "7");
    const bug = { id: 5, name: "bug", color: "ff0000" };
    useFake({
      labels: [bug],
      issues: [{ number: 7, state: "open", labels: [bug] }],
    });
    await syncLabelToGitea(s.task.id, "bug", "red");
    expect(fake.callsTo("POST", /labels/)).toEqual([]);
  });

  it("does not attach a label when creating it fails, or when reading the issue fails", async () => {
    const s = await seed();
    await addIssueLink(s.task.id, s.integration.id, "7");
    useFake({ issues: [{ number: 7, state: "open", labels: [] }] });
    fake.setOverride((call) =>
      call.method === "POST" && /\/labels$/.test(call.path)
        ? new Response("x", { status: 500 })
        : undefined,
    );
    await syncLabelToGitea(s.task.id, "bug", "red");
    expect(fake.callsTo("POST", /issues\/7\/labels$/)).toEqual([]);

    fake.setOverride((call) =>
      call.method === "GET" && /issues\/7$/.test(call.path)
        ? new Response("x", { status: 500 })
        : undefined,
    );
    await expect(syncLabelToGitea(s.task.id, "other", "red")).resolves.toBe(
      undefined,
    );
  });

  it("does nothing without a Gitea issue link, with a bad issue id or incomplete config", async () => {
    const s = await seed();
    await syncLabelToGitea(s.task.id, "bug", "red");
    await removeLabelFromGitea(s.task.id, "bug");
    expect(fake.calls).toEqual([]);

    const link = await addIssueLink(s.task.id, s.integration.id, "abc");
    await syncLabelToGitea(s.task.id, "bug", "red");
    expect(fake.calls).toEqual([]);

    await db
      .update(schema.externalLinkTable)
      .set({ externalId: "7" })
      .where(eq(schema.externalLinkTable.id, link.id));
    await db
      .update(schema.integrationTable)
      .set({ config: JSON.stringify({ ...baseConfig, accessToken: "" }) })
      .where(eq(schema.integrationTable.id, s.integration.id));
    await syncLabelToGitea(s.task.id, "bug", "red");
    await db
      .update(schema.integrationTable)
      .set({ config: "{corrupt" })
      .where(eq(schema.integrationTable.id, s.integration.id));
    await syncLabelToGitea(s.task.id, "bug", "red");
    expect(fake.calls).toEqual([]);
  });

  it("ignores links that belong to other integration types", async () => {
    const s = await seed();
    const [github] = await db
      .insert(schema.integrationTable)
      .values({ projectId: s.project.id, type: "github", config: "{}" })
      .returning();
    await addIssueLink(s.task.id, github.id, "7");
    await syncLabelToGitea(s.task.id, "bug", "red");
    expect(fake.calls).toEqual([]);
  });

  it("removes a label from the linked issue, and tolerates unknown labels and Gitea errors", async () => {
    const s = await seed();
    await addIssueLink(s.task.id, s.integration.id, "7");
    const bug = { id: 5, name: "bug", color: "ff0000" };
    useFake({
      labels: [bug],
      issues: [{ number: 7, state: "open", labels: [bug] }],
    });
    await removeLabelFromGitea(s.task.id, "missing");
    expect(fake.callsTo("DELETE", /labels/)).toEqual([]);
    fake.setOverride((call) =>
      call.method === "DELETE" ? new Response("x", { status: 500 }) : undefined,
    );
    await expect(removeLabelFromGitea(s.task.id, "bug")).resolves.toBe(
      undefined,
    );
    fake.setOverride(undefined);
    await removeLabelFromGitea(s.task.id, "bug");
    expect(fake.issues.get(7)?.labels).toEqual([]);
  });

  it("ensureLabelsExistGitea maps names to ids, creating only the missing ones", async () => {
    useFake({ labels: [{ id: 1, name: "status:done", color: "10B981" }] });
    const map = await ensureLabelsExistGitea({ ...baseConfig }, [
      "status:done",
      "priority:low",
      "custom",
    ]);
    expect(Object.fromEntries(map)).toEqual({
      "status:done": 1,
      "priority:low": 100 + 1,
      custom: 102,
    });
    expect(fake.labels.map((l) => [l.name, l.color])).toEqual([
      ["status:done", "10B981"],
      ["priority:low", "0EA5E9"],
      ["custom", "6B7280"],
    ]);
  });

  it("ensureLabelsExistGitea returns an empty map when listing fails and skips labels it cannot create", async () => {
    useFake();
    fake.setOverride((call) =>
      call.method === "GET" ? new Response("x", { status: 500 }) : undefined,
    );
    expect((await ensureLabelsExistGitea(baseConfig, ["a"])).size).toBe(0);

    fake.setOverride((call) =>
      call.method === "POST" ? new Response("x", { status: 422 }) : undefined,
    );
    expect((await ensureLabelsExistGitea(baseConfig, ["a"])).size).toBe(0);
  });

  it("removeLabelGitea tolerates list failures, unknown labels and delete failures", async () => {
    const bug = { id: 5, name: "bug", color: "ff0000" };
    useFake({
      labels: [bug],
      issues: [{ number: 7, state: "open", labels: [bug] }],
    });
    fake.setOverride((call) =>
      call.method === "GET" ? new Response("x", { status: 500 }) : undefined,
    );
    await removeLabelGitea(baseConfig, 7, "bug");
    expect(fake.issues.get(7)?.labels).toHaveLength(1);

    fake.setOverride(undefined);
    await removeLabelGitea(baseConfig, 7, "unknown");
    expect(fake.issues.get(7)?.labels).toHaveLength(1);

    fake.setOverride((call) =>
      call.method === "DELETE" ? new Response("x", { status: 500 }) : undefined,
    );
    await removeLabelGitea(baseConfig, 7, "bug");
    expect(fake.issues.get(7)?.labels).toHaveLength(1);
  });
});

describe("addLabelsToIssueGitea", () => {
  it("attaches the ids of ensured labels and skips an empty request", async () => {
    useFake({ issues: [{ number: 7, state: "open", labels: [] }] });
    await addLabelsToIssueGitea(baseConfig, 7, []);
    expect(fake.calls).toEqual([]);
    await addLabelsToIssueGitea(baseConfig, 7, ["status:done"]);
    expect(fake.issues.get(7)?.labels.map((l) => l.name)).toEqual([
      "status:done",
    ]);
  });

  it("does not attach anything when no label could be ensured, and swallows attach failures", async () => {
    useFake({ issues: [{ number: 7, state: "open", labels: [] }] });
    fake.setOverride((call) =>
      call.method === "GET" ? new Response("x", { status: 500 }) : undefined,
    );
    await addLabelsToIssueGitea(baseConfig, 7, ["a"]);
    expect(fake.callsTo("POST", /issues\/7\/labels/)).toEqual([]);

    fake.setOverride((call) =>
      call.method === "POST" && /issues\/7\/labels$/.test(call.path)
        ? new Response("x", { status: 500 })
        : undefined,
    );
    await expect(addLabelsToIssueGitea(baseConfig, 7, ["a"])).resolves.toBe(
      undefined,
    );
    expect(fake.issues.get(7)?.labels).toEqual([]);
  });
});
