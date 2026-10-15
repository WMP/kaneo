import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { handleTaskCommentCreated } from "../../apps/api/src/plugins/github/events/task-comment-created";
import { handleTaskCreated } from "../../apps/api/src/plugins/github/events/task-created";
import { handleTaskDescriptionChanged } from "../../apps/api/src/plugins/github/events/task-description-changed";
import { handleTaskPriorityChanged } from "../../apps/api/src/plugins/github/events/task-priority-changed";
import { handleTaskStatusChanged } from "../../apps/api/src/plugins/github/events/task-status-changed";
import { handleTaskTitleChanged } from "../../apps/api/src/plugins/github/events/task-title-changed";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  configureGithubApp,
  GITHUB_PRIVATE_KEY_PEM,
  type GithubRoutes,
  INSTALLATION_TOKEN,
  stubGithub,
} from "./support/github-coverage";

configureGithubApp();

// Octokit's default write throttle waits one second between mutating requests,
// which would add minutes of wall-clock time. The bounded variant that the
// import flow already uses disables throttle and retry but is otherwise the same
// App/Octokit stack, and it still issues the real HTTP requests that
// `stubGithub` answers.
vi.mock("../../apps/api/src/plugins/github/utils/github-app", async (load) => {
  const actual =
    await load<
      typeof import("../../apps/api/src/plugins/github/utils/github-app")
    >();
  return {
    ...actual,
    getVerifiedInstallationOctokit: (
      config: Parameters<typeof actual.getVerifiedInstallationOctokit>[0],
    ) => actual.getVerifiedInstallationOctokit(config, true),
  };
});

const REPO = "/repos/example/repo";
const REPO_OK = { [`GET ${REPO}`]: { body: { id: 20 } } };

beforeEach(async () => {
  await resetTestDatabase();
  vi.stubEnv("KANEO_CLIENT_URL", "https://kaneo.test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function seed(
  options: {
    config?: Record<string, unknown>;
    link?: {
      resourceType?: string;
      externalId?: string;
      metadata?: Record<string, unknown>;
      otherIntegration?: boolean;
    } | null;
    taskStatus?: string;
  } = {},
) {
  const { user, workspace } = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  const config = {
    repositoryOwner: "example",
    repositoryName: "repo",
    installationId: 10,
    repositoryId: 20,
    verifiedGithubAccountId: "30",
    verifiedByUserId: user.id,
    ...options.config,
  };
  const [integration] = await db
    .insert(schema.integrationTable)
    .values({
      projectId: project.id,
      type: "github",
      config: JSON.stringify(config),
    })
    .returning();
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Task title",
      description: "Task description",
      number: 7,
      status: options.taskStatus ?? "to-do",
    })
    .returning();
  let linkId: string | undefined;
  if (options.link !== null) {
    let linkIntegrationId = integration.id;
    if (options.link?.otherIntegration) {
      const other = await createProjectFixture({
        workspaceId: workspace.id,
      });
      const [otherIntegration] = await db
        .insert(schema.integrationTable)
        .values({
          projectId: other.project.id,
          type: "github",
          config: JSON.stringify(config),
        })
        .returning();
      linkIntegrationId = otherIntegration.id;
    }
    const [link] = await db
      .insert(schema.externalLinkTable)
      .values({
        taskId: task.id,
        integrationId: linkIntegrationId,
        resourceType: options.link?.resourceType ?? "issue",
        externalId: options.link?.externalId ?? "5",
        url: "https://github.com/example/repo/issues/5",
        title: "Old issue title",
        metadata: options.link?.metadata
          ? JSON.stringify(options.link.metadata)
          : null,
      })
      .returning();
    linkId = link.id;
  }
  const context = {
    integrationId: integration.id,
    projectId: project.id,
    config: config as Record<string, unknown>,
  };
  return { user, workspace, project, integration, task, linkId, context };
}

async function storedLink(id: string | undefined) {
  if (!id) throw new Error("no link");
  const link = await db.query.externalLinkTable.findFirst({
    where: eq(schema.externalLinkTable.id, id),
  });
  return {
    ...link,
    metadata: link?.metadata ? JSON.parse(link.metadata) : null,
  };
}

function noTokenLeak(spy: { mock: { calls: unknown[][] } }) {
  const logged = JSON.stringify(
    spy.mock.calls.map((call) =>
      call.map((part) =>
        part instanceof Error ? `${part.name}: ${part.message}` : part,
      ),
    ),
  );
  expect(logged).not.toContain(INSTALLATION_TOKEN);
  expect(logged).not.toContain("BEGIN PRIVATE KEY");
  expect(logged).not.toContain(GITHUB_PRIVATE_KEY_PEM.slice(40, 120));
}

describe("handleTaskCreated", () => {
  const event = (s: Awaited<ReturnType<typeof seed>>) => ({
    taskId: s.task.id,
    projectId: s.project.id,
    userId: s.user.id,
    title: "Fix login",
    description: "Steps to reproduce",
    priority: "high",
    status: "to-do",
    number: 7,
  });
  const issueCreated = {
    body: {
      number: 42,
      html_url: "https://github.com/example/repo/issues/42",
      title: "Fix login",
      state: "open",
    },
    status: 201,
  };

  it("creates the issue, its labels, the link row and the task-link comment", async () => {
    const s = await seed({ link: null });
    const calls = stubGithub({
      ...REPO_OK,
      [`POST ${REPO}/issues`]: issueCreated,
      [`POST ${REPO}/labels`]: { status: 201, body: {} },
      [`POST ${REPO}/issues/42/labels`]: { body: [] },
      [`POST ${REPO}/issues/42/comments`]: { status: 201, body: {} },
    });

    await handleTaskCreated(event(s), s.context);

    expect(
      calls
        .map((c) => `${c.method} ${c.path}`)
        .filter((c) => c !== `GET ${REPO}`),
    ).toEqual([
      `POST ${REPO}/issues`,
      `GET ${REPO}/labels/priority:high`,
      `POST ${REPO}/labels`,
      `GET ${REPO}/labels/status:to-do`,
      `POST ${REPO}/labels`,
      `POST ${REPO}/issues/42/labels`,
      `POST ${REPO}/issues/42/comments`,
    ]);
    const byPath = (m: string, p: string) =>
      calls.filter((c) => c.method === m && c.path === p);
    expect(byPath("POST", `${REPO}/issues`)[0].body).toEqual({
      title: "Fix login",
      body: `Steps to reproduce\n\n---\n<sub>Task: ${s.task.id}</sub>`,
    });
    expect(byPath("POST", `${REPO}/labels`).map((c) => c.body)).toEqual([
      { name: "priority:high", color: "F97316" },
      { name: "status:to-do", color: "6B7280" },
    ]);
    expect(byPath("POST", `${REPO}/issues/42/labels`)[0].body).toEqual({
      labels: ["priority:high", "status:to-do"],
    });
    expect(byPath("POST", `${REPO}/issues/42/comments`)[0].body).toEqual({
      body: `[${s.project.slug.toUpperCase()}-7](https://kaneo.test/dashboard/workspace/${s.workspace.id}/project/${s.project.id}/task/${s.task.id})`,
    });
    const links = await db.query.externalLinkTable.findMany({
      where: eq(schema.externalLinkTable.taskId, s.task.id),
    });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      integrationId: s.integration.id,
      resourceType: "issue",
      externalId: "42",
      url: "https://github.com/example/repo/issues/42",
      title: "Fix login",
    });
    expect(JSON.parse(links[0].metadata ?? "{}")).toEqual({
      state: "open",
      createdFrom: "kaneo",
    });
  });

  it("omits the priority label for no-priority and the task comment when disabled", async () => {
    const s = await seed({
      link: null,
      config: { commentTaskLinkOnGitHubIssue: false },
    });
    const calls = stubGithub({
      ...REPO_OK,
      [`POST ${REPO}/issues`]: issueCreated,
      [`GET ${REPO}/labels/status:to-do`]: { body: { name: "status:to-do" } },
      [`POST ${REPO}/issues/42/labels`]: { body: [] },
    });
    await handleTaskCreated(
      { ...event(s), priority: "no-priority", description: null },
      s.context,
    );
    expect(calls.find((c) => c.path === `${REPO}/issues`)?.body).toEqual({
      title: "Fix login",
      body: `<sub>Task: ${s.task.id}</sub>`,
    });
    expect(
      calls.find((c) => c.path === `${REPO}/issues/42/labels`)?.body,
    ).toEqual({ labels: ["status:to-do"] });
    expect(calls.some((c) => c.path.endsWith("/comments"))).toBe(false);
    expect(calls.some((c) => c.path === `${REPO}/labels`)).toBe(false);
  });

  it("skips the comment when the project no longer exists", async () => {
    const s = await seed({ link: null });
    const calls = stubGithub({
      ...REPO_OK,
      [`POST ${REPO}/issues`]: issueCreated,
      [`GET ${REPO}/labels/status:to-do`]: { body: {} },
      [`GET ${REPO}/labels/priority:high`]: { body: {} },
      [`POST ${REPO}/issues/42/labels`]: { body: [] },
    });
    await handleTaskCreated(
      { ...event(s), projectId: "missing-project" },
      s.context,
    );
    expect(calls.some((c) => c.path.endsWith("/comments"))).toBe(false);
    expect(
      await db.query.externalLinkTable.findMany({
        where: eq(schema.externalLinkTable.taskId, s.task.id),
      }),
    ).toHaveLength(1);
  });

  it("does not create a second issue when the task is already linked", async () => {
    const s = await seed();
    const calls = stubGithub(REPO_OK);
    await handleTaskCreated(event(s), s.context);
    expect(calls).toEqual([]);
    expect(
      await db.query.externalLinkTable.findMany({
        where: eq(schema.externalLinkTable.taskId, s.task.id),
      }),
    ).toHaveLength(1);
  });

  it.each([
    ["no repository id", { repositoryId: undefined }],
    ["no verifying user", { verifiedByUserId: "" }],
    ["no installation", { installationId: null }],
  ])(
    "makes no GitHub call for an unverified binding (%s)",
    async (_n, patch) => {
      const s = await seed({ link: null, config: patch });
      const calls = stubGithub(REPO_OK);
      await handleTaskCreated(event(s), {
        ...s.context,
        config: { ...s.context.config, ...patch },
      });
      expect(calls).toEqual([]);
      expect(
        await db.query.externalLinkTable.findMany({
          where: eq(schema.externalLinkTable.taskId, s.task.id),
        }),
      ).toHaveLength(0);
    },
  );

  it("refuses to write when the repository id changed and does not leak credentials", async () => {
    const s = await seed({ link: null });
    const calls = stubGithub({ [`GET ${REPO}`]: { body: { id: 999 } } });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleTaskCreated(event(s), s.context);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${REPO}`]);
    expect(String(error.mock.calls[0][1])).toContain(
      "GitHub repository identity changed",
    );
    noTokenLeak(error);
    expect(
      await db.query.externalLinkTable.findMany({
        where: eq(schema.externalLinkTable.taskId, s.task.id),
      }),
    ).toHaveLength(0);
  });

  it("stores no link when GitHub rejects the issue and does not leak credentials", async () => {
    const s = await seed({ link: null });
    stubGithub({
      ...REPO_OK,
      [`POST ${REPO}/issues`]: { status: 422, body: { message: "Invalid" } },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleTaskCreated(event(s), s.context);
    expect(error).toHaveBeenCalledWith(
      "Failed to create GitHub issue:",
      expect.objectContaining({ status: 422 }),
    );
    noTokenLeak(error);
    expect(
      await db.query.externalLinkTable.findMany({
        where: eq(schema.externalLinkTable.taskId, s.task.id),
      }),
    ).toHaveLength(0);
  });
});

describe("handleTaskStatusChanged", () => {
  const event = (
    s: Awaited<ReturnType<typeof seed>>,
    oldStatus: string,
    newStatus: string,
  ) => ({
    taskId: s.task.id,
    projectId: s.project.id,
    userId: s.user.id,
    oldStatus,
    newStatus,
    title: "Task title",
  });
  const labelRoutes: GithubRoutes = {
    ...REPO_OK,
    [`GET ${REPO}/labels/status:done`]: { body: {} },
    [`GET ${REPO}/labels/status:in-progress`]: { body: {} },
    [`GET ${REPO}/labels/status:to-do`]: { body: {} },
    [`DELETE ${REPO}/issues/5/labels/status:to-do`]: { body: [] },
    [`DELETE ${REPO}/issues/5/labels/status:done`]: { body: [] },
    [`POST ${REPO}/issues/5/labels`]: { body: [] },
    [`PATCH ${REPO}/issues/5`]: { body: {} },
  };

  it("swaps the status label and closes the issue when the task becomes done", async () => {
    const s = await seed({ link: { metadata: { createdFrom: "github" } } });
    const calls = stubGithub(labelRoutes);
    await handleTaskStatusChanged(event(s, "to-do", "done"), s.context);
    expect(
      calls
        .filter((c) => c.path !== REPO)
        .map((c) => [c.method, c.path, c.body]),
    ).toEqual([
      ["DELETE", `${REPO}/issues/5/labels/status:to-do`, null],
      ["GET", `${REPO}/labels/status:done`, null],
      ["POST", `${REPO}/issues/5/labels`, { labels: ["status:done"] }],
      ["PATCH", `${REPO}/issues/5`, { state: "closed" }],
    ]);
    expect((await storedLink(s.linkId)).metadata).toEqual({
      createdFrom: "github",
      state: "closed",
    });
  });

  it("reopens the issue when a done task moves to another status", async () => {
    const s = await seed({ link: { metadata: { state: "closed" } } });
    const calls = stubGithub(labelRoutes);
    await handleTaskStatusChanged(event(s, "done", "in-progress"), s.context);
    expect(
      calls.filter((c) => c.method === "PATCH").map((c) => c.body),
    ).toEqual([{ state: "open" }]);
    expect((await storedLink(s.linkId)).metadata).toEqual({ state: "open" });
  });

  it("only swaps labels for a status change that does not cross done", async () => {
    const s = await seed({ link: { metadata: { state: "open" } } });
    const calls = stubGithub(labelRoutes);
    await handleTaskStatusChanged(event(s, "to-do", "in-progress"), s.context);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(
      calls.find((c) => c.path === `${REPO}/issues/5/labels`)?.body,
    ).toEqual({ labels: ["status:in-progress"] });
    expect((await storedLink(s.linkId)).metadata).toEqual({ state: "open" });
  });

  it("tolerates a missing old label (404) and still applies the new one", async () => {
    const s = await seed({ link: {} });
    const calls = stubGithub({
      ...labelRoutes,
      [`DELETE ${REPO}/issues/5/labels/status:to-do`]: {
        status: 404,
        body: { message: "Label does not exist" },
      },
    });
    await handleTaskStatusChanged(event(s, "to-do", "done"), s.context);
    expect(calls.some((c) => c.method === "PATCH")).toBe(true);
    expect((await storedLink(s.linkId)).metadata).toEqual({ state: "closed" });
  });

  it("stops without changing the link when label removal fails with 403", async () => {
    const s = await seed({ link: { metadata: { state: "open" } } });
    const calls = stubGithub({
      ...labelRoutes,
      [`DELETE ${REPO}/issues/5/labels/status:to-do`]: {
        status: 403,
        body: { message: "Forbidden" },
      },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleTaskStatusChanged(event(s, "to-do", "done"), s.context);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect((await storedLink(s.linkId)).metadata).toEqual({ state: "open" });
    expect(error).toHaveBeenCalledWith(
      "Failed to update GitHub issue status:",
      expect.objectContaining({ status: 403 }),
    );
    noTokenLeak(error);
  });

  it.each([
    ["no link", null],
    ["a pull-request link only", { resourceType: "pull_request" }],
    ["a link of another integration", { otherIntegration: true }],
  ])("does nothing for %s", async (_n, link) => {
    const s = await seed({ link });
    const calls = stubGithub(labelRoutes);
    await handleTaskStatusChanged(event(s, "to-do", "done"), s.context);
    expect(calls).toEqual([]);
  });

  it("does nothing for an unverified binding", async () => {
    const s = await seed({ link: {} });
    const calls = stubGithub(labelRoutes);
    await handleTaskStatusChanged(event(s, "to-do", "done"), {
      ...s.context,
      config: { ...s.context.config, repositoryId: undefined },
    });
    expect(calls).toEqual([]);
  });
});

describe("handleTaskPriorityChanged", () => {
  const event = (
    s: Awaited<ReturnType<typeof seed>>,
    oldPriority: string,
    newPriority: string,
  ) => ({
    taskId: s.task.id,
    projectId: s.project.id,
    userId: s.user.id,
    oldPriority,
    newPriority,
    title: "Task title",
  });
  const routes: GithubRoutes = {
    ...REPO_OK,
    [`DELETE ${REPO}/issues/5/labels/priority:high`]: { body: [] },
    [`GET ${REPO}/labels/priority:low`]: { body: {} },
    [`GET ${REPO}/labels/priority:urgent`]: { body: {} },
    [`POST ${REPO}/issues/5/labels`]: { body: [] },
  };
  const effects = (calls: { method: string; path: string; body: unknown }[]) =>
    calls
      .filter((c) => c.path !== REPO && c.method !== "GET")
      .map((c) => [c.method, c.path, c.body]);

  it("removes the old priority label and adds the new one", async () => {
    const s = await seed();
    const calls = stubGithub(routes);
    await handleTaskPriorityChanged(event(s, "high", "low"), s.context);
    expect(effects(calls)).toEqual([
      ["DELETE", `${REPO}/issues/5/labels/priority:high`, null],
      ["POST", `${REPO}/issues/5/labels`, { labels: ["priority:low"] }],
    ]);
  });

  it("only adds a label when the old priority was no-priority or empty", async () => {
    for (const old of ["no-priority", ""]) {
      const s = await seed();
      const calls = stubGithub(routes);
      await handleTaskPriorityChanged(event(s, old, "urgent"), s.context);
      expect(effects(calls)).toEqual([
        ["POST", `${REPO}/issues/5/labels`, { labels: ["priority:urgent"] }],
      ]);
    }
  });

  it("only removes the old label when the new priority is no-priority", async () => {
    const s = await seed();
    const calls = stubGithub(routes);
    await handleTaskPriorityChanged(event(s, "high", "no-priority"), s.context);
    expect(effects(calls)).toEqual([
      ["DELETE", `${REPO}/issues/5/labels/priority:high`, null],
    ]);
  });

  it("does not add the new label when removing the old one fails", async () => {
    const s = await seed();
    const calls = stubGithub({
      ...routes,
      [`DELETE ${REPO}/issues/5/labels/priority:high`]: {
        status: 403,
        body: {},
      },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleTaskPriorityChanged(event(s, "high", "low"), s.context);
    expect(effects(calls).some((c) => c[0] === "POST")).toBe(false);
    expect(error).toHaveBeenCalledWith(
      "Failed to update GitHub issue priority:",
      expect.objectContaining({ status: 403 }),
    );
    noTokenLeak(error);
  });

  it.each([
    ["no link", null],
    ["a branch link only", { resourceType: "branch" }],
    ["a link of another integration", { otherIntegration: true }],
  ])("does nothing for %s", async (_n, link) => {
    const s = await seed({ link });
    const calls = stubGithub(routes);
    await handleTaskPriorityChanged(event(s, "high", "low"), s.context);
    expect(calls).toEqual([]);
  });

  it("does nothing for an unverified binding", async () => {
    const s = await seed();
    const calls = stubGithub(routes);
    await handleTaskPriorityChanged(event(s, "high", "low"), {
      ...s.context,
      config: { ...s.context.config, verifiedGithubAccountId: "abc" },
    });
    expect(calls).toEqual([]);
  });
});

describe("handleTaskTitleChanged", () => {
  const event = (s: Awaited<ReturnType<typeof seed>>, newTitle: string) => ({
    taskId: s.task.id,
    projectId: s.project.id,
    userId: s.user.id,
    oldTitle: "Task title",
    newTitle,
  });
  const routes: GithubRoutes = {
    ...REPO_OK,
    [`PATCH ${REPO}/issues/5`]: { body: {} },
  };
  const patches = (calls: { method: string; body: unknown }[]) =>
    calls.filter((c) => c.method === "PATCH").map((c) => c.body);
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it("pushes the new title and records a kaneo-sourced sync stamp", async () => {
    const s = await seed({ link: { metadata: { state: "open" } } });
    const calls = stubGithub(routes);
    await handleTaskTitleChanged(event(s, "Renamed"), s.context);
    expect(patches(calls)).toEqual([{ title: "Renamed" }]);
    const link = await storedLink(s.linkId);
    expect(link.title).toBe("Renamed");
    expect(link.metadata.state).toBe("open");
    expect(link.metadata.lastSync.title).toMatchObject({
      source: "kaneo",
      value: "Renamed",
    });
  });

  it("pushes when the previous sync is old and from another title", async () => {
    const s = await seed({
      link: {
        metadata: {
          lastSync: {
            title: { source: "github", value: "Other", timestamp: ago(60_000) },
            description: { source: "github", value: "d", timestamp: ago(1) },
          },
        },
      },
    });
    const calls = stubGithub(routes);
    await handleTaskTitleChanged(event(s, "Renamed"), s.context);
    expect(patches(calls)).toEqual([{ title: "Renamed" }]);
    const link = await storedLink(s.linkId);
    expect(link.metadata.lastSync.description.value).toBe("d");
    expect(link.metadata.lastSync.title.source).toBe("kaneo");
  });

  it("skips an echo of a title that GitHub itself just set", async () => {
    const s = await seed({
      link: {
        metadata: {
          lastSync: {
            title: {
              source: "github",
              value: "Renamed",
              timestamp: ago(60_000),
            },
          },
        },
      },
    });
    const calls = stubGithub(routes);
    await handleTaskTitleChanged(event(s, "Renamed"), s.context);
    expect(calls).toEqual([]);
    expect((await storedLink(s.linkId)).title).toBe("Old issue title");
  });

  it("skips a change that follows a sync within two seconds", async () => {
    const s = await seed({
      link: {
        metadata: {
          lastSync: {
            title: { source: "kaneo", value: "Earlier", timestamp: ago(500) },
          },
        },
      },
    });
    const calls = stubGithub(routes);
    await handleTaskTitleChanged(event(s, "Renamed"), s.context);
    expect(calls).toEqual([]);
  });

  it("keeps the link unchanged and does not leak credentials when GitHub rejects the title", async () => {
    const s = await seed({ link: { metadata: { state: "open" } } });
    stubGithub({
      ...routes,
      [`PATCH ${REPO}/issues/5`]: { status: 422, body: {} },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleTaskTitleChanged(event(s, "Renamed"), s.context);
    const link = await storedLink(s.linkId);
    expect(link.title).toBe("Old issue title");
    expect(link.metadata).toEqual({ state: "open" });
    noTokenLeak(error);
  });

  it.each([
    ["no link", null],
    ["a pull-request link only", { resourceType: "pull_request" }],
    ["a link of another integration", { otherIntegration: true }],
  ])("does nothing for %s", async (_n, link) => {
    const s = await seed({ link });
    const calls = stubGithub(routes);
    await handleTaskTitleChanged(event(s, "Renamed"), s.context);
    expect(calls).toEqual([]);
  });

  it("does nothing for an unverified binding", async () => {
    const s = await seed({ link: {} });
    const calls = stubGithub(routes);
    await handleTaskTitleChanged(event(s, "Renamed"), {
      ...s.context,
      config: { ...s.context.config, installationId: 0 },
    });
    expect(calls).toEqual([]);
  });
});

describe("handleTaskDescriptionChanged", () => {
  const event = (
    s: Awaited<ReturnType<typeof seed>>,
    newDescription: string | null,
  ) => ({
    taskId: s.task.id,
    projectId: s.project.id,
    userId: s.user.id,
    oldDescription: "Task description",
    newDescription,
  });
  const routes: GithubRoutes = {
    ...REPO_OK,
    [`PATCH ${REPO}/issues/5`]: { body: {} },
  };
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it("pushes the description with the task footer and records the sync", async () => {
    const s = await seed({ link: { metadata: { state: "open" } } });
    const calls = stubGithub(routes);
    await handleTaskDescriptionChanged(event(s, "New text"), s.context);
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
      body: `New text\n\n---\n<sub>Task: ${s.task.id}</sub>`,
    });
    const link = await storedLink(s.linkId);
    expect(link.metadata.state).toBe("open");
    expect(link.metadata.lastSync.description).toMatchObject({
      source: "kaneo",
      value: "New text",
    });
  });

  it("sends only the footer for a cleared description and stores an empty value", async () => {
    const s = await seed({ link: {} });
    const calls = stubGithub(routes);
    await handleTaskDescriptionChanged(event(s, null), s.context);
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
      body: `<sub>Task: ${s.task.id}</sub>`,
    });
    expect(
      (await storedLink(s.linkId)).metadata.lastSync.description.value,
    ).toBe("");
  });

  it("skips a description that GitHub itself just set", async () => {
    const s = await seed({
      link: {
        metadata: {
          lastSync: {
            description: {
              source: "github",
              value: "Same",
              timestamp: ago(60_000),
            },
          },
        },
      },
    });
    const calls = stubGithub(routes);
    await handleTaskDescriptionChanged(event(s, "Same"), s.context);
    expect(calls).toEqual([]);
  });

  it("skips within two seconds of a previous sync but pushes after that", async () => {
    const recent = await seed({
      link: {
        metadata: {
          lastSync: {
            description: { source: "kaneo", value: "x", timestamp: ago(300) },
          },
        },
      },
    });
    let calls = stubGithub(routes);
    await handleTaskDescriptionChanged(event(recent, "y"), recent.context);
    expect(calls).toEqual([]);

    const old = await seed({
      link: {
        metadata: {
          lastSync: {
            description: { source: "kaneo", value: "x", timestamp: ago(5000) },
          },
        },
      },
    });
    calls = stubGithub(routes);
    await handleTaskDescriptionChanged(event(old, "y"), old.context);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("keeps stored metadata and does not leak credentials when GitHub rejects the update", async () => {
    const s = await seed({ link: { metadata: { state: "open" } } });
    stubGithub({
      ...routes,
      [`PATCH ${REPO}/issues/5`]: { status: 422, body: {} },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleTaskDescriptionChanged(event(s, "New text"), s.context);
    expect((await storedLink(s.linkId)).metadata).toEqual({ state: "open" });
    noTokenLeak(error);
  });

  it.each([
    ["no link", null],
    ["a branch link only", { resourceType: "branch" }],
    ["a link of another integration", { otherIntegration: true }],
  ])("does nothing for %s", async (_n, link) => {
    const s = await seed({ link });
    const calls = stubGithub(routes);
    await handleTaskDescriptionChanged(event(s, "New text"), s.context);
    expect(calls).toEqual([]);
  });

  it("does nothing for an unverified binding", async () => {
    const s = await seed({ link: {} });
    const calls = stubGithub(routes);
    await handleTaskDescriptionChanged(event(s, "x"), {
      ...s.context,
      config: { ...s.context.config, verifiedByUserId: undefined },
    });
    expect(calls).toEqual([]);
  });
});

describe("handleTaskCommentCreated", () => {
  const event = (s: Awaited<ReturnType<typeof seed>>) => ({
    taskId: s.task.id,
    projectId: s.project.id,
    userId: s.user.id,
    comment: "Looks good",
  });

  it("posts the comment on the linked issue number", async () => {
    const s = await seed({ link: { externalId: "5" } });
    const calls = stubGithub({
      ...REPO_OK,
      [`POST ${REPO}/issues/5/comments`]: { status: 201, body: {} },
    });
    await handleTaskCommentCreated(event(s), s.context);
    expect(
      calls.filter((c) => c.method === "POST").map((c) => [c.path, c.body]),
    ).toEqual([[`${REPO}/issues/5/comments`, { body: "Looks good" }]]);
    expect(calls[0].authorization).toContain(INSTALLATION_TOKEN);
  });

  it("swallows an upstream failure without leaking credentials", async () => {
    const s = await seed();
    stubGithub({
      ...REPO_OK,
      [`POST ${REPO}/issues/5/comments`]: { status: 403, body: {} },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleTaskCommentCreated(event(s), s.context);
    expect(error).toHaveBeenCalledWith(
      "Failed to create GitHub comment:",
      expect.objectContaining({ status: 403 }),
    );
    noTokenLeak(error);
  });

  it.each([
    ["no link", null],
    ["a pull-request link only", { resourceType: "pull_request" }],
    ["a link of another integration", { otherIntegration: true }],
  ])("does nothing for %s", async (_n, link) => {
    const s = await seed({ link });
    const calls = stubGithub(REPO_OK);
    await handleTaskCommentCreated(event(s), s.context);
    expect(calls).toEqual([]);
  });

  it("does nothing for an unverified binding", async () => {
    const s = await seed();
    const calls = stubGithub(REPO_OK);
    await handleTaskCommentCreated(event(s), {
      ...s.context,
      config: { ...s.context.config, repositoryId: undefined },
    });
    expect(calls).toEqual([]);
  });
});
