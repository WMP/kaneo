import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import createGiteaIntegration from "../../apps/api/src/gitea-integration/controllers/create-gitea-integration";
import { importGiteaIssues } from "../../apps/api/src/gitea-integration/controllers/import-gitea-issues";
import { createApp } from "../../apps/api/src/index";
import { createFakeGitea, type FakeCall } from "./coverage-gitea-fake";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const TOKEN = "gitea-pat-route-token-9876";
const MASKED = "gite••••••9876";

type Role = "owner" | "member" | "viewer";

async function setup() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project, columns } = await createProjectFixture({
    workspaceId: owner.workspace.id,
    slug: "kan",
  });
  const member = await addWorkspaceMember(owner.workspace.id, "member");
  await addProjectMember(project.id, member.id, "member");
  const viewer = await addWorkspaceMember(owner.workspace.id, "viewer");
  await addProjectMember(project.id, viewer.id, "viewer");
  const stranger = await createWorkspaceMember();
  return {
    workspaceId: owner.workspace.id,
    project,
    columns,
    users: { owner: owner.user, member, viewer, stranger: stranger.user },
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function call(
  user: Setup["users"][Role | "stranger"] | null,
  method: string,
  path: string,
  body?: unknown,
) {
  if (user) mockAuthenticatedSession(user);
  else mockAnonymousSession();
  const { app } = createApp();
  const response = await app.request(`/api/gitea-integration${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  // The raw token must never appear in any response of these routes.
  expect(text).not.toContain(TOKEN);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  // biome-ignore lint/suspicious/noExplicitAny: loosely typed response bodies keep the assertions readable
  return { status: response.status, text, json: json as Record<string, any> };
}

async function giteaRows(projectId: string) {
  return db.query.integrationTable.findMany({
    where: and(
      eq(schema.integrationTable.projectId, projectId),
      eq(schema.integrationTable.type, "gitea"),
    ),
  });
}

async function insertIntegration(
  projectId: string,
  config: Record<string, unknown> | string,
  isActive = true,
) {
  const [row] = await db
    .insert(schema.integrationTable)
    .values({
      projectId,
      type: "gitea",
      isActive,
      config:
        typeof config === "string"
          ? config
          : JSON.stringify({
              baseUrl: "https://gitea.example",
              accessToken: TOKEN,
              repositoryOwner: "owner",
              repositoryName: "repo",
              webhookSecret: "stored-webhook-secret",
              ...config,
            }),
    })
    .returning();
  return row;
}

let fake: ReturnType<typeof createFakeGitea>;
const originalAllowPrivate =
  process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
const originalApiUrl = process.env.KANEO_API_URL;

function useFake(options?: Parameters<typeof createFakeGitea>[0]) {
  fake = createFakeGitea(options);
  vi.stubGlobal("fetch", fake.fetch);
}

beforeEach(async () => {
  await resetTestDatabase();
  process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
  process.env.KANEO_API_URL = "https://kaneo.example.com/api/";
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
  if (originalApiUrl === undefined) delete process.env.KANEO_API_URL;
  else process.env.KANEO_API_URL = originalApiUrl;
});

const createBody = (over: Record<string, unknown> = {}) => ({
  baseUrl: "https://gitea.example/",
  accessToken: TOKEN,
  repositoryOwner: "owner",
  repositoryName: "repo",
  ...over,
});

describe("Gitea integration routes: create", () => {
  it("stores a verified integration and returns a masked token and the webhook secret once configured", async () => {
    const s = await setup();
    const res = await call(
      s.users.owner,
      "POST",
      `/project/${s.project.id}`,
      createBody(),
    );
    expect(res.status).toBe(200);
    const rows = await giteaRows(s.project.id);
    expect(rows).toHaveLength(1);
    expect(res.json).toMatchObject({
      id: rows[0].id,
      projectId: s.project.id,
      baseUrl: "https://gitea.example",
      repositoryOwner: "owner",
      repositoryName: "repo",
      maskedAccessToken: MASKED,
      webhookUrl: `https://kaneo.example.com/api/gitea-integration/webhook/${rows[0].id}`,
      branchPattern: "{slug}-{number}",
      commentTaskLinkOnGiteaIssue: true,
      isActive: true,
    });
    expect(res.json.webhookSecret).toMatch(/^[0-9a-f]{48}$/);
    const stored = JSON.parse(rows[0].config);
    expect(stored).toMatchObject({
      baseUrl: "https://gitea.example",
      accessToken: TOKEN,
      webhookSecret: res.json.webhookSecret,
    });
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /user",
      "GET /repos/owner/repo",
    ]);
    expect(fake.calls.every((c) => c.authorization === `token ${TOKEN}`)).toBe(
      true,
    );
  });

  it("re-saving without a token keeps the stored token and webhook secret and re-activates", async () => {
    const s = await setup();
    const first = await call(
      s.users.owner,
      "POST",
      `/project/${s.project.id}`,
      createBody(),
    );
    await db
      .update(schema.integrationTable)
      .set({ isActive: false })
      .where(eq(schema.integrationTable.projectId, s.project.id));
    useFake();
    const second = await call(
      s.users.owner,
      "POST",
      `/project/${s.project.id}`,
      createBody({ accessToken: undefined, repositoryName: "repo" }),
    );
    expect(second.status).toBe(200);
    expect(second.json.id).toBe(first.json.id);
    expect(second.json.webhookSecret).toBe(first.json.webhookSecret);
    expect(second.json.isActive).toBe(true);
    expect(fake.calls[0].authorization).toBe(`token ${TOKEN}`);
    expect(await giteaRows(s.project.id)).toHaveLength(1);
  });

  it("requires a token for a new integration", async () => {
    const s = await setup();
    const res = await call(
      s.users.owner,
      "POST",
      `/project/${s.project.id}`,
      createBody({ accessToken: "   " }),
    );
    expect(res.status).toBe(400);
    expect(await giteaRows(s.project.id)).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("reuses the old webhook secret and tolerates an unreadable old config when no token is sent", async () => {
    const s = await setup();
    await insertIntegration(s.project.id, "{corrupt");
    const res = await call(
      s.users.owner,
      "POST",
      `/project/${s.project.id}`,
      createBody({ accessToken: undefined }),
    );
    expect(res.status).toBe(400);
    expect(await giteaRows(s.project.id)).toHaveLength(1);

    // With a fresh token the corrupt config is replaced and a new secret is made.
    const ok = await call(
      s.users.owner,
      "POST",
      `/project/${s.project.id}`,
      createBody(),
    );
    expect(ok.status).toBe(200);
    expect(ok.json.webhookSecret).toMatch(/^[0-9a-f]{48}$/);
  });

  it("refuses a repository that another active project already links", async () => {
    const s = await setup();
    const other = await createWorkspaceMember({ role: "owner" });
    const { project: otherProject } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    await insertIntegration(otherProject.id, {
      baseUrl: "https://gitea.example/",
    });
    const res = await call(
      s.users.owner,
      "POST",
      `/project/${s.project.id}`,
      createBody(),
    );
    expect(res.status).toBe(409);
    expect(res.text).toContain("already linked to another project");
    expect(await giteaRows(s.project.id)).toEqual([]);
  });

  it("does not treat inactive, unreadable or different-repository integrations as conflicts", async () => {
    const s = await setup();
    const make = async () => {
      const w = await createWorkspaceMember({ role: "owner" });
      return (await createProjectFixture({ workspaceId: w.workspace.id }))
        .project;
    };
    await insertIntegration((await make()).id, {}, false);
    await insertIntegration((await make()).id, "{corrupt");
    await insertIntegration((await make()).id, { repositoryName: "different" });
    const res = await call(
      s.users.owner,
      "POST",
      `/project/${s.project.id}`,
      createBody(),
    );
    expect(res.status).toBe(200);
  });

  it("passes Gitea errors through with their status and never echoes the token", async () => {
    const s = await setup();
    fake.setOverride((c) =>
      c.path === "/user"
        ? new Response(`bad token ${TOKEN}`, { status: 401 })
        : undefined,
    );
    const unauthorized = await call(
      s.users.owner,
      "POST",
      `/project/${s.project.id}`,
      createBody(),
    );
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.text).toContain("Gitea API error 401");

    fake.setOverride((c) =>
      c.path === "/repos/owner/repo"
        ? new Response("not found", { status: 404 })
        : undefined,
    );
    const missing = await call(
      s.users.owner,
      "POST",
      `/project/${s.project.id}`,
      createBody(),
    );
    expect(missing.status).toBe(404);

    fake.setOverride(() => {
      throw new TypeError("connect ECONNREFUSED");
    });
    const down = await call(
      s.users.owner,
      "POST",
      `/project/${s.project.id}`,
      createBody(),
    );
    expect(down.status).toBe(500);
    expect(await giteaRows(s.project.id)).toEqual([]);
  });

  it("rejects non-http base URLs and base URLs that carry credentials", async () => {
    const s = await setup();
    for (const baseUrl of [
      "ftp://gitea.example",
      "https://user:pw@gitea.example",
      "https://gitea.example/?x=1",
    ]) {
      const res = await call(
        s.users.owner,
        "POST",
        `/project/${s.project.id}`,
        createBody({ baseUrl }),
      );
      expect(res.status, baseUrl).toBeGreaterThanOrEqual(400);
    }
    expect(fake.calls).toEqual([]);
    expect(await giteaRows(s.project.id)).toEqual([]);
  });

  it("denies non-managers, strangers and anonymous callers without side effects", async () => {
    const s = await setup();
    for (const user of [
      s.users.member,
      s.users.viewer,
      s.users.stranger,
      null,
    ] as const) {
      const res = await call(
        user,
        "POST",
        `/project/${s.project.id}`,
        createBody(),
      );
      expect([401, 403]).toContain(res.status);
    }
    expect(await giteaRows(s.project.id)).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("answers 400 for an unknown project and an invalid body", async () => {
    const s = await setup();
    const unknown = await call(
      s.users.owner,
      "POST",
      "/project/no-such-project",
      createBody(),
    );
    expect(unknown.status).toBe(400);
    const invalid = await call(
      s.users.owner,
      "POST",
      `/project/${s.project.id}`,
      { baseUrl: "https://gitea.example" },
    );
    expect(invalid.status).toBe(400);
    expect(fake.calls).toEqual([]);
  });
});

describe("Gitea integration routes: read, update, delete", () => {
  it("returns null before configuration", async () => {
    const s = await setup();
    const res = await call(s.users.viewer, "GET", `/project/${s.project.id}`);
    expect(res.status).toBe(200);
    expect(res.json).toBeNull();
  });

  it("shows the webhook secret only to workspace managers and never the token", async () => {
    const s = await setup();
    await insertIntegration(s.project.id, {});
    const asOwner = await call(
      s.users.owner,
      "GET",
      `/project/${s.project.id}`,
    );
    expect(asOwner.json.webhookSecret).toBe("stored-webhook-secret");
    expect(asOwner.json.maskedAccessToken).toBe(MASKED);
    const asViewer = await call(
      s.users.viewer,
      "GET",
      `/project/${s.project.id}`,
    );
    expect(asViewer.status).toBe(200);
    expect(asViewer.json.webhookSecret).toBe("");
    expect(asViewer.text).not.toContain("stored-webhook-secret");
    expect(asViewer.json.maskedAccessToken).toBe(MASKED);
  });

  it("masks short tokens completely and defaults missing optional settings", async () => {
    const s = await setup();
    await insertIntegration(s.project.id, {
      accessToken: "short",
      webhookSecret: undefined,
      commentTaskLinkOnGiteaIssue: false,
      branchPattern: "feat/{number}",
    });
    const res = await call(s.users.owner, "GET", `/project/${s.project.id}`);
    expect(res.json).toMatchObject({
      maskedAccessToken: "••••••••",
      webhookSecret: "",
      commentTaskLinkOnGiteaIssue: false,
      branchPattern: "feat/{number}",
    });
  });

  it("denies reading to strangers", async () => {
    const s = await setup();
    await insertIntegration(s.project.id, {});
    const res = await call(s.users.stranger, "GET", `/project/${s.project.id}`);
    expect(res.status).toBe(403);
  });

  it("updates isActive and the comment-link flag, keeping the rest of the config", async () => {
    const s = await setup();
    const row = await insertIntegration(s.project.id, {});
    const res = await call(s.users.owner, "PATCH", `/project/${s.project.id}`, {
      isActive: false,
      commentTaskLinkOnGiteaIssue: false,
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      isActive: false,
      commentTaskLinkOnGiteaIssue: false,
      webhookSecret: "stored-webhook-secret",
    });
    const [stored] = await giteaRows(s.project.id);
    expect(JSON.parse(stored.config)).toMatchObject({
      accessToken: TOKEN,
      webhookSecret: "stored-webhook-secret",
      commentTaskLinkOnGiteaIssue: false,
    });
    expect(stored.isActive).toBe(false);
    expect(stored.id).toBe(row.id);

    // an empty patch leaves everything alone
    const noop = await call(
      s.users.owner,
      "PATCH",
      `/project/${s.project.id}`,
      {},
    );
    expect(noop.json.isActive).toBe(false);
    expect(noop.json.commentTaskLinkOnGiteaIssue).toBe(false);
  });

  it("answers 404 when there is nothing to update, 500 for a corrupt config and 400 for an invalid one", async () => {
    const s = await setup();
    const none = await call(
      s.users.owner,
      "PATCH",
      `/project/${s.project.id}`,
      {
        isActive: true,
      },
    );
    expect(none.status).toBe(404);
    expect(none.json).toEqual({ error: "Integration not found" });

    const row = await insertIntegration(s.project.id, "{corrupt");
    const corrupt = await call(
      s.users.owner,
      "PATCH",
      `/project/${s.project.id}`,
      { isActive: true },
    );
    expect(corrupt.status).toBe(500);

    await db
      .update(schema.integrationTable)
      .set({ config: JSON.stringify({ baseUrl: "not-a-url" }) })
      .where(eq(schema.integrationTable.id, row.id));
    const invalid = await call(
      s.users.owner,
      "PATCH",
      `/project/${s.project.id}`,
      { isActive: true },
    );
    expect(invalid.status).toBe(400);
  });

  it("denies update and delete to non-managers without changing anything", async () => {
    const s = await setup();
    await insertIntegration(s.project.id, {});
    for (const user of [s.users.member, s.users.viewer, s.users.stranger]) {
      const patch = await call(user, "PATCH", `/project/${s.project.id}`, {
        isActive: false,
      });
      const del = await call(user, "DELETE", `/project/${s.project.id}`);
      expect(patch.status).toBe(403);
      expect(del.status).toBe(403);
    }
    const [stored] = await giteaRows(s.project.id);
    expect(stored.isActive).toBe(true);
  });

  it("deletes only the project's own Gitea integration", async () => {
    const s = await setup();
    await insertIntegration(s.project.id, {});
    const other = await createWorkspaceMember({ role: "owner" });
    const { project: otherProject } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    await insertIntegration(otherProject.id, { repositoryName: "other" });
    const res = await call(s.users.owner, "DELETE", `/project/${s.project.id}`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      success: true,
      message: "Gitea integration deleted",
    });
    expect(await giteaRows(s.project.id)).toEqual([]);
    expect(await giteaRows(otherProject.id)).toHaveLength(1);

    const again = await call(
      s.users.owner,
      "DELETE",
      `/project/${s.project.id}`,
    );
    expect(again.status).toBe(404);
  });
});

describe("Gitea integration routes: repositories and verification", () => {
  const repo = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    name: `r${id}`,
    full_name: `owner/r${id}`,
    private: false,
    owner: { login: "owner" },
    html_url: `https://gitea.example/owner/r${id}`,
    ...extra,
  });

  it("lists repositories across pages and falls back to the owner username", async () => {
    const s = await setup();
    fake.setOverride((c: FakeCall) => {
      if (c.path.startsWith("/user/repos?page=1")) {
        return Response.json(
          Array.from({ length: 50 }, (_, i) =>
            i === 0 ? repo(1, { owner: { username: "legacy" } }) : repo(i + 1),
          ),
        );
      }
      if (c.path.startsWith("/user/repos?page=2")) {
        return Response.json([repo(51), repo(52, { owner: undefined })]);
      }
      return undefined;
    });
    const res = await call(s.users.owner, "POST", "/repositories", {
      projectId: s.project.id,
      baseUrl: "https://gitea.example",
      accessToken: TOKEN,
    });
    expect(res.status).toBe(200);
    expect(res.json.repositories).toHaveLength(52);
    expect(res.json.repositories[0]).toEqual({
      id: 1,
      name: "r1",
      full_name: "owner/r1",
      private: false,
      owner: { login: "legacy" },
      html_url: "https://gitea.example/owner/r1",
    });
    expect(res.json.repositories[51].owner).toEqual({ login: "" });
  });

  it("stops after 50 pages", async () => {
    const s = await setup();
    fake.setOverride((c) =>
      c.path.startsWith("/user/repos")
        ? Response.json(Array.from({ length: 50 }, (_, i) => repo(i)))
        : undefined,
    );
    const res = await call(s.users.owner, "POST", "/repositories", {
      projectId: s.project.id,
      baseUrl: "https://gitea.example",
      accessToken: TOKEN,
    });
    expect(res.json.repositories).toHaveLength(2500);
    expect(fake.callsTo("GET", /^\/user\/repos/)).toHaveLength(50);
  });

  it("answers 401 when the token is rejected and 403 to non-managers", async () => {
    const s = await setup();
    fake.setOverride(() => new Response("no", { status: 401 }));
    const bad = await call(s.users.owner, "POST", "/repositories", {
      projectId: s.project.id,
      baseUrl: "https://gitea.example",
      accessToken: TOKEN,
    });
    expect(bad.status).toBe(401);

    fake.calls.length = 0;
    useFake();
    const denied = await call(s.users.member, "POST", "/repositories", {
      projectId: s.project.id,
      baseUrl: "https://gitea.example",
      accessToken: TOKEN,
    });
    expect(denied.status).toBe(403);
    expect(fake.calls).toEqual([]);
  });

  it("verify reports a missing repository in the body without leaking the token", async () => {
    const s = await setup();
    fake.setOverride((c) =>
      c.path === "/repos/owner/repo"
        ? new Response("{}", { status: 404 })
        : undefined,
    );
    const res = await call(s.users.owner, "POST", "/verify", {
      projectId: s.project.id,
      baseUrl: "https://gitea.example",
      accessToken: TOKEN,
      repositoryOwner: "owner",
      repositoryName: "repo",
    });
    expect(res.status).toBe(200);
    expect(res.json.repositoryExists).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const issue = (number: number, extra: Record<string, unknown> = {}) => ({
  id: number,
  number,
  title: `Issue ${number}`,
  body: `Body ${number}`,
  html_url: `https://gitea.example/owner/repo/issues/${number}`,
  state: "open",
  labels: [],
  user: { login: "alice" },
  ...extra,
});

type Routes = {
  issues?: Array<Record<string, unknown>[]>;
  pulls?: Array<Record<string, unknown>[]>;
  comments?: Record<number, Array<Record<string, unknown>[]> | number>;
};

function routeImport(routes: Routes) {
  return (c: FakeCall) => {
    const page = Number(/page=(\d+)/.exec(c.path)?.[1] ?? "1");
    if (c.path.startsWith("/repos/owner/repo/issues?")) {
      return Response.json(routes.issues?.[page - 1] ?? []);
    }
    if (c.path.startsWith("/repos/owner/repo/pulls?")) {
      return Response.json(routes.pulls?.[page - 1] ?? []);
    }
    const m = /^\/repos\/owner\/repo\/issues\/(\d+)\/comments\?/.exec(c.path);
    if (m) {
      const entry = routes.comments?.[Number(m[1])];
      if (typeof entry === "number") {
        return new Response("boom", { status: entry });
      }
      return Response.json(entry?.[page - 1] ?? []);
    }
    return undefined;
  };
}

async function tasksOf(projectId: string) {
  return (
    await db.query.taskTable.findMany({
      where: eq(schema.taskTable.projectId, projectId),
    })
  ).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}

describe("Gitea import route", () => {
  async function importAs(
    user: Setup["users"][Role | "stranger"] | null,
    body: unknown,
  ) {
    return call(user, "POST", "/import-issues", body);
  }

  it("creates tasks, links, labels and comments scoped to the project", async () => {
    const s = await setup();
    const integration = await insertIntegration(s.project.id, {});
    await db.insert(schema.labelTable).values({
      name: "bug",
      color: "#123456",
      workspaceId: s.workspaceId,
    });
    fake.setOverride(
      routeImport({
        issues: [
          [
            issue(12, {
              title: "Crash on login",
              body: "Steps",
              labels: [
                { id: 1, name: "priority:urgent", color: "ef4444" },
                { id: 2, name: "status:in-progress", color: "3b82f6" },
                { id: 3, name: "bug", color: "ff0000" },
                { id: 4, name: "docs", color: "" },
              ],
            }),
            issue(13, { pull_request: {}, title: "Actually a PR" }),
            issue(14, { body: null, user: null }),
          ],
        ],
        comments: {
          12: [
            [
              {
                id: 1,
                body: "First",
                html_url: "https://gitea.example/c/1",
                user: { login: "bob", avatar_url: "https://a/b.png" },
              },
              {
                id: 2,
                body: "From a bot",
                html_url: "https://gitea.example/c/2",
                user: { login: "ci[bot]" },
              },
              {
                id: 3,
                body: "Anon",
                html_url: "https://gitea.example/c/3",
                user: null,
              },
              {
                id: 4,
                body: "Legacy user",
                html_url: "https://gitea.example/c/4",
                user: { username: "carol" },
              },
            ],
          ],
        },
      }),
    );

    const res = await importAs(s.users.member, { projectId: s.project.id });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ imported: 2, updated: 0, skipped: 0 });

    const tasks = await tasksOf(s.project.id);
    expect(tasks.map((t) => [t.number, t.title, t.status, t.priority])).toEqual(
      [
        [1, "Crash on login", "in-progress", "urgent"],
        [2, "Issue 14", "to-do", "low"],
      ],
    );
    expect(tasks.every((t) => t.projectId === s.project.id)).toBe(true);
    expect(tasks[0].description).toBe("Steps");
    expect(tasks[1].description).toBe("");
    expect(tasks[0].userId).toBeNull();

    const links = await db.query.externalLinkTable.findMany({
      where: eq(schema.externalLinkTable.integrationId, integration.id),
    });
    expect(links.map((l) => [l.resourceType, l.externalId]).sort()).toEqual([
      ["issue", "12"],
      ["issue", "14"],
    ]);
    const link12 = links.find((l) => l.externalId === "12");
    expect(JSON.parse(link12?.metadata ?? "")).toEqual({
      state: "open",
      createdFrom: "gitea-import",
      author: "alice",
    });

    const labels = await db.query.labelTable.findMany({
      where: eq(schema.labelTable.taskId, tasks[0].id),
    });
    expect(labels.map((l) => [l.name, l.color, l.workspaceId]).sort()).toEqual([
      ["bug", "#123456", s.workspaceId], // the workspace label colour wins
      ["docs", "#6B7280", s.workspaceId],
    ]);

    const activities = await db.query.activityTable.findMany({
      where: eq(schema.activityTable.taskId, tasks[0].id),
    });
    expect(
      activities.map((a) => [a.content, a.externalUserName]).sort(),
    ).toEqual([
      ["Anon", "Unknown"],
      ["First", "bob"],
      ["Legacy user", "carol"],
    ]);
    expect(activities.every((a) => a.externalSource === "gitea")).toBe(true);
    expect(
      activities.find((a) => a.content === "First")?.externalUserAvatar,
    ).toBe("https://a/b.png");
  });

  it("refreshes tasks that are already linked instead of duplicating them", async () => {
    const s = await setup();
    const integration = await insertIntegration(s.project.id, {});
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: s.project.id,
        title: "Old title",
        description: "Old",
        status: "to-do",
        priority: "low",
        number: 1,
        columnId: s.columns.todo.id,
      })
      .returning();
    await db.insert(schema.externalLinkTable).values({
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: "12",
      url: "https://gitea.example/owner/repo/issues/12",
    });
    await db.insert(schema.labelTable).values([
      {
        name: "stale",
        color: "#000000",
        taskId: task.id,
        workspaceId: s.workspaceId,
      },
      {
        name: "keep",
        color: "#111111",
        taskId: task.id,
        workspaceId: s.workspaceId,
      },
    ]);
    fake.setOverride(
      routeImport({
        issues: [
          [
            issue(12, {
              title: "New title",
              body: "New body",
              labels: [
                { id: 1, name: "priority:high" },
                { id: 3, name: "keep", color: "222222" },
                { id: 4, name: "fresh", color: "#00ff00" },
              ],
            }),
          ],
        ],
        comments: {
          12: [
            [
              {
                id: 1,
                body: "Same",
                html_url: "https://gitea.example/c/1",
                user: { login: "bob" },
              },
            ],
          ],
        },
      }),
    );
    const first = await importAs(s.users.owner, { projectId: s.project.id });
    const second = await importAs(s.users.owner, { projectId: s.project.id });
    expect(first.json).toEqual({ imported: 0, updated: 1, skipped: 0 });
    expect(second.json).toEqual({ imported: 0, updated: 1, skipped: 0 });

    const tasks = await tasksOf(s.project.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: "New title",
      description: "New body",
      priority: "high",
      status: "to-do",
    });
    const labels = await db.query.labelTable.findMany({
      where: eq(schema.labelTable.taskId, task.id),
    });
    expect(labels.map((l) => [l.name, l.color]).sort()).toEqual([
      ["fresh", "#00ff00"],
      ["keep", "#111111"],
    ]);
    expect(
      await db.query.activityTable.findMany({
        where: eq(schema.activityTable.taskId, task.id),
      }),
    ).toHaveLength(1);
  });

  it("characterization: a status label on a linked issue changes the task status text only", async () => {
    // Open question for the owners: the webhook path moves the task to the
    // column of the new status; this path leaves columnId pointing at the old
    // column, so status and column can disagree.
    const s = await setup();
    const integration = await insertIntegration(s.project.id, {});
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: s.project.id,
        title: "T",
        status: "to-do",
        number: 1,
        columnId: s.columns.todo.id,
      })
      .returning();
    await db.insert(schema.externalLinkTable).values({
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: "12",
      url: "u",
    });
    fake.setOverride(
      routeImport({
        issues: [[issue(12, { labels: [{ id: 1, name: "status:done" }] })]],
      }),
    );
    await importAs(s.users.owner, { projectId: s.project.id });
    const [stored] = await tasksOf(s.project.id);
    expect(stored.status).toBe("done");
    expect(stored.columnId).toBe(s.columns.todo.id);
  });

  it("reads further pages of issues, comments and pull requests", async () => {
    const s = await setup();
    await insertIntegration(s.project.id, {});
    const prFiller = Array.from({ length: 100 }, (_, i) =>
      issue(1000 + i, { pull_request: {} }),
    );
    prFiller[0] = issue(1, {});
    const manyComments = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      body: `c${i}`,
      html_url: `https://gitea.example/c/${i}`,
      user: { login: "u" },
    }));
    const pullFiller = Array.from({ length: 100 }, (_, i) => ({
      number: 2000 + i,
      title: "no head",
      body: null,
      html_url: `https://gitea.example/pulls/${2000 + i}`,
      state: "open",
    }));
    fake.setOverride(
      routeImport({
        issues: [prFiller, [issue(2)]],
        comments: {
          1: [
            manyComments,
            [
              {
                id: 500,
                body: "last",
                html_url: "https://gitea.example/c/500",
                user: { login: "u" },
              },
            ],
          ],
        },
        pulls: [
          pullFiller,
          [
            {
              number: 7,
              title: "Work",
              body: null,
              html_url: "https://gitea.example/owner/repo/pulls/7",
              state: "open",
              head: { ref: "kan-1-work" },
              user: { username: "dave" },
            },
          ],
        ],
      }),
    );
    const res = await importAs(s.users.owner, { projectId: s.project.id });
    expect(res.json).toEqual({ imported: 2, updated: 0, skipped: 0 });
    const tasks = await tasksOf(s.project.id);
    const first = tasks.find((t) => t.title === "Issue 1");
    expect(
      await db.query.activityTable.findMany({
        where: eq(schema.activityTable.taskId, first?.id as string),
      }),
    ).toHaveLength(101);
    const prLinks = await db.query.externalLinkTable.findMany({
      where: eq(schema.externalLinkTable.resourceType, "pull_request"),
    });
    expect(prLinks).toHaveLength(1);
    expect(prLinks[0]).toMatchObject({ taskId: first?.id, externalId: "7" });
    expect(JSON.parse(prLinks[0].metadata ?? "")).toEqual({
      state: "open",
      branch: "kan-1-work",
      author: "dave",
    });
  });

  it("links pull requests by branch or by issue reference, once, and only inside the project", async () => {
    const s = await setup();
    const integration = await insertIntegration(s.project.id, {});
    const other = await createWorkspaceMember({ role: "owner" });
    const { project: otherProject } = await createProjectFixture({
      workspaceId: other.workspace.id,
      slug: "kan",
    });
    const [foreignTask] = await db
      .insert(schema.taskTable)
      .values({
        projectId: otherProject.id,
        title: "F",
        number: 5,
        position: 1,
      })
      .returning();
    const [byBranch] = await db
      .insert(schema.taskTable)
      .values({ projectId: s.project.id, title: "B", number: 1, position: 1 })
      .returning();
    const [byIssue] = await db
      .insert(schema.taskTable)
      .values({ projectId: s.project.id, title: "I", number: 2, position: 2 })
      .returning();
    await db.insert(schema.externalLinkTable).values({
      taskId: byIssue.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: "40",
      url: "u",
    });
    await db.insert(schema.externalLinkTable).values({
      taskId: byBranch.id,
      integrationId: integration.id,
      resourceType: "pull_request",
      externalId: "10",
      url: "already",
    });
    const pr = (number: number, ref: string, title: string) => ({
      number,
      title,
      body: null,
      html_url: `https://gitea.example/owner/repo/pulls/${number}`,
      state: "open",
      head: { ref },
    });
    fake.setOverride(
      routeImport({
        pulls: [
          [
            pr(10, "kan-1-again", "Already linked"),
            pr(11, "kan-1-new", "By branch"),
            pr(12, "feature-x", "Fixes #40"),
            pr(13, "kan-5-foreign", "Foreign number"),
            pr(14, "unrelated", "Nothing"),
          ],
        ],
      }),
    );
    const res = await importAs(s.users.owner, { projectId: s.project.id });
    expect(res.status).toBe(200);
    const links = await db.query.externalLinkTable.findMany({
      where: eq(schema.externalLinkTable.resourceType, "pull_request"),
    });
    expect(links.map((l) => [l.externalId, l.taskId]).sort()).toEqual(
      [
        ["10", byBranch.id],
        ["11", byBranch.id],
        ["12", byIssue.id],
      ].sort(),
    );
    expect(links.some((l) => l.taskId === foreignTask.id)).toBe(false);
    expect(links.find((l) => l.externalId === "10")?.url).toBe("already");
  });

  it("collects per-issue failures in errors and keeps importing the other issues", async () => {
    const s = await setup();
    await insertIntegration(s.project.id, {});
    fake.setOverride(
      routeImport({
        issues: [[issue(1), issue(2), issue(3)]],
        comments: { 2: 500 },
      }),
    );
    const res = await importAs(s.users.owner, { projectId: s.project.id });
    expect(res.status).toBe(200);
    expect(res.json.imported).toBe(2);
    expect(res.json.errors).toEqual(["Issue #2: Gitea API error 500"]);
    // characterization: the task of the failing issue was already created and linked,
    // so a later import treats it as "updated".
    expect(await tasksOf(s.project.id)).toHaveLength(3);
  });

  it("reports a failing pull request listing as a server error without leaking the token", async () => {
    const s = await setup();
    await insertIntegration(s.project.id, {});
    fake.setOverride((c) =>
      c.path.startsWith("/repos/owner/repo/issues?")
        ? Response.json([])
        : c.path.startsWith("/repos/owner/repo/pulls?")
          ? new Response("down", { status: 503 })
          : undefined,
    );
    const res = await importAs(s.users.owner, { projectId: s.project.id });
    expect(res.status).toBe(500);
  });

  it("answers 404 for an unknown project and a project without integration, 400 for inactive or broken ones", async () => {
    const s = await setup();
    const unknown = await importAs(s.users.owner, { projectId: "nope" });
    expect(unknown.status).toBe(404);
    const missingId = await importAs(s.users.owner, {});
    expect(missingId.status).toBe(400);

    const none = await importAs(s.users.owner, { projectId: s.project.id });
    expect(none.status).toBe(404);
    expect(none.text).toContain("Gitea integration not found");

    const row = await insertIntegration(s.project.id, {}, false);
    const inactive = await importAs(s.users.owner, { projectId: s.project.id });
    expect(inactive.status).toBe(400);
    expect(inactive.text).toContain("not active");

    await db
      .update(schema.integrationTable)
      .set({ isActive: true, config: "{corrupt" })
      .where(eq(schema.integrationTable.id, row.id));
    const corrupt = await importAs(s.users.owner, { projectId: s.project.id });
    expect(corrupt.status).toBe(400);
    expect(corrupt.text).toContain("Invalid Gitea integration config");

    await db
      .update(schema.integrationTable)
      .set({
        config: JSON.stringify({
          baseUrl: "https://gitea.example",
          accessToken: "",
          repositoryOwner: "owner",
          repositoryName: "repo",
        }),
      })
      .where(eq(schema.integrationTable.id, row.id));
    const noToken = await importAs(s.users.owner, { projectId: s.project.id });
    expect(noToken.status).toBe(400);
    expect(fake.calls).toEqual([]);
    expect(await tasksOf(s.project.id)).toEqual([]);
  });

  it("denies viewers, strangers and anonymous callers without importing anything", async () => {
    const s = await setup();
    await insertIntegration(s.project.id, {});
    fake.setOverride(routeImport({ issues: [[issue(1)]] }));
    for (const user of [s.users.viewer, s.users.stranger, null] as const) {
      const res = await importAs(user, { projectId: s.project.id });
      expect([401, 403]).toContain(res.status);
    }
    expect(fake.calls).toEqual([]);
    expect(await tasksOf(s.project.id)).toEqual([]);
  });
});

describe("Gitea integration: remaining failure paths", () => {
  it("verify maps 401 to 401, other upstream failures to 500, and network errors to 500", async () => {
    const s = await setup();
    const body = {
      projectId: s.project.id,
      baseUrl: "https://gitea.example",
      accessToken: TOKEN,
      repositoryOwner: "owner",
      repositoryName: "repo",
    };
    fake.setOverride(() => new Response("no", { status: 401 }));
    const unauthorized = await call(s.users.owner, "POST", "/verify", body);
    expect(unauthorized.status).toBe(401);

    fake.setOverride(() => new Response("oops", { status: 500 }));
    const upstream = await call(s.users.owner, "POST", "/verify", body);
    expect(upstream.status).toBe(500);
    expect(upstream.text).toContain("Gitea API error 500");

    fake.setOverride(() => {
      throw new TypeError("socket hang up");
    });
    const network = await call(s.users.owner, "POST", "/verify", body);
    expect(network.status).toBe(500);
    expect(network.text).toContain("socket hang up");
  });

  it("refuses to link a project that does not exist", async () => {
    await expect(
      createGiteaIntegration({
        projectId: "missing",
        baseUrl: "https://gitea.example",
        accessToken: TOKEN,
        repositoryOwner: "owner",
        repositoryName: "repo",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(fake.calls).toEqual([]);
    await expect(importGiteaIssues("missing")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("rejects an owner that is blank after trimming and stores nothing", async () => {
    const s = await setup();
    const res = await call(
      s.users.owner,
      "POST",
      `/project/${s.project.id}`,
      createBody({ repositoryOwner: "   " }),
    );
    expect(res.status).toBe(400);
    expect(await giteaRows(s.project.id)).toEqual([]);
  });

  it("reports a pull request that cannot be processed in errors and continues", async () => {
    const s = await setup();
    await insertIntegration(s.project.id, {});
    fake.setOverride(
      routeImport({
        issues: [[issue(1, { labels: ["plain-string-label"] })]],
        pulls: [
          [
            {
              number: null,
              title: "broken",
              body: null,
              html_url: "u",
              state: "open",
              head: { ref: "kan-1-x" },
            },
            {
              number: 8,
              title: "ok",
              body: null,
              html_url: "https://gitea.example/owner/repo/pulls/8",
              state: "open",
              head: { ref: "kan-1-x" },
            },
          ],
        ],
      }),
    );
    const res = await call(s.users.owner, "POST", "/import-issues", {
      projectId: s.project.id,
    });
    expect(res.status).toBe(200);
    expect(res.json.imported).toBe(1);
    expect(res.json.errors).toHaveLength(1);
    expect(res.json.errors[0]).toMatch(/^PR #null: /);
    const prLinks = await db.query.externalLinkTable.findMany({
      where: eq(schema.externalLinkTable.resourceType, "pull_request"),
    });
    expect(prLinks.map((l) => l.externalId)).toEqual(["8"]);
    const labels = await db.query.labelTable.findMany();
    expect(labels.map((l) => [l.name, l.color])).toEqual([
      ["plain-string-label", "#6B7280"],
    ]);
  });
});
