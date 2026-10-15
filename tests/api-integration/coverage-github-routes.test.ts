import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import createGithubIntegration from "../../apps/api/src/github-integration/controllers/create-github-integration";
import { importIssues } from "../../apps/api/src/github-integration/controllers/import-issues";
import { initialImportState } from "../../apps/api/src/github-integration/import-state";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  configureGithubApp,
  GITHUB_PRIVATE_KEY_PEM,
  type GithubCall,
  type GithubRoutes,
  INSTALLATION_TOKEN,
  stubGithub,
} from "./support/github-coverage";

configureGithubApp();

beforeEach(async () => {
  await resetTestDatabase();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const { app } = createApp();
const REPO = "/repos/example/repo";

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture(
  options: {
    config?: Record<string, unknown> | string | null;
    isActive?: boolean;
  } = {},
) {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project, columns } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const member = await addWorkspaceMember(owner.workspace.id, "member");
  const outsider = await createWorkspaceMember({ role: "owner" });
  const config =
    options.config === null
      ? null
      : typeof options.config === "string"
        ? options.config
        : JSON.stringify({
            repositoryOwner: "example",
            repositoryName: "repo",
            installationId: 10,
            repositoryId: 20,
            verifiedGithubAccountId: "30",
            verifiedByUserId: owner.user.id,
            branchPattern: "{slug}-{number}",
            ...options.config,
          });
  const integration = config
    ? (
        await db
          .insert(schema.integrationTable)
          .values({
            projectId: project.id,
            type: "github",
            config,
            isActive: options.isActive ?? true,
          })
          .returning()
      )[0]
    : null;
  return {
    owner: owner.user,
    member,
    outsider: outsider.user,
    workspace: owner.workspace,
    project,
    columns,
    integration,
  };
}
async function connectGithubAccount(userId: string, accountId = "30") {
  await db.insert(schema.accountTable).values({
    accountId,
    providerId: "github",
    userId,
    updatedAt: new Date(),
  });
}
function call(
  path: string,
  method = "GET",
  body?: unknown,
  // biome-ignore lint/suspicious/noExplicitAny: response bodies are untyped JSON
): Promise<{ status: number; json: any }> {
  return app
    .request(`/api/github-integration${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    .then(async (r) => {
      const text = await r.text();
      let json: unknown = text;
      try {
        json = JSON.parse(text);
      } catch {
        // Plain-text error bodies are returned as they are.
      }
      return { status: r.status, json };
    });
}
const storedIntegration = (projectId: string) =>
  db.query.integrationTable.findFirst({
    where: and(
      eq(schema.integrationTable.projectId, projectId),
      eq(schema.integrationTable.type, "github"),
    ),
  });
function noLeak(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toContain(INSTALLATION_TOKEN);
  expect(text).not.toContain("PRIVATE KEY");
  expect(text).not.toContain(GITHUB_PRIVATE_KEY_PEM.slice(40, 120));
}

describe("GET /app-info", () => {
  it("requires a session", async () => {
    mockAnonymousSession();
    expect((await call("/app-info")).status).toBe(401);
  });

  it("reports the configured app name and whether this user connected GitHub", async () => {
    const f = await fixture();
    vi.stubEnv("GITHUB_APP_NAME", "kaneo-test-app");
    mockAuthenticatedSession(f.owner);
    expect((await call("/app-info")).json).toEqual({
      appName: "kaneo-test-app",
      accountConnected: false,
      accountLinkingAvailable: false,
    });
    await connectGithubAccount(f.owner.id);
    expect((await call("/app-info")).json.accountConnected).toBe(true);
    mockAuthenticatedSession(f.member);
    expect((await call("/app-info")).json.accountConnected).toBe(false);
  });

  it("returns a null app name when none is configured and ignores other providers", async () => {
    const f = await fixture();
    vi.stubEnv("GITHUB_APP_NAME", "");
    await db.insert(schema.accountTable).values({
      accountId: "1",
      providerId: "google",
      userId: f.owner.id,
      updatedAt: new Date(),
    });
    mockAuthenticatedSession(f.owner);
    const { json } = await call("/app-info");
    expect(json.appName).toBeNull();
    expect(json.accountConnected).toBe(false);
  });
});

describe("GET /project/:projectId", () => {
  it("returns null when the project has no GitHub integration", async () => {
    const f = await fixture({ config: null });
    mockAuthenticatedSession(f.owner);
    expect(await call(`/project/${f.project.id}`)).toEqual({
      status: 200,
      json: null,
    });
  });

  it("returns the public view without verification identifiers", async () => {
    const f = await fixture();
    mockAuthenticatedSession(f.owner);
    const { status, json } = await call(`/project/${f.project.id}`);
    expect(status).toBe(200);
    expect(json).toMatchObject({
      id: f.integration?.id,
      projectId: f.project.id,
      repositoryOwner: "example",
      repositoryName: "repo",
      installationId: 10,
      branchPattern: "{slug}-{number}",
      commentTaskLinkOnGitHubIssue: true,
      isActive: true,
      requiresVerification: false,
    });
    expect(json).not.toHaveProperty("verifiedByUserId");
    expect(json).not.toHaveProperty("verifiedGithubAccountId");
    expect(json).not.toHaveProperty("config");
    expect(json).not.toHaveProperty("importProgress");
  });

  it("flags a legacy unverified integration as inactive and needing verification", async () => {
    const f = await fixture({
      config: { repositoryId: undefined, branchPattern: undefined },
    });
    mockAuthenticatedSession(f.owner);
    const { json } = await call(`/project/${f.project.id}`);
    expect(json.requiresVerification).toBe(true);
    expect(json.isActive).toBe(false);
    expect(json.branchPattern).toBe("{slug}-{number}");
  });

  it("includes import progress only for the bound repository", async () => {
    const f = await fixture({
      config: { commentTaskLinkOnGitHubIssue: false },
    });
    const state = {
      ...initialImportState(20),
      imported: 3,
      updated: 1,
      skipped: 2,
    };
    await db.insert(schema.githubImportTable).values({
      integrationId: f.integration?.id as string,
      runId: "run-1",
      state,
    });
    mockAuthenticatedSession(f.owner);
    const { json } = await call(`/project/${f.project.id}`);
    expect(json.commentTaskLinkOnGitHubIssue).toBe(false);
    expect(json.importProgress).toEqual({
      runId: "run-1",
      pending: true,
      imported: 3,
      updated: 1,
      skipped: 2,
    });
    await db
      .update(schema.githubImportTable)
      .set({ state: { ...state, repositoryId: 21 } });
    expect((await call(`/project/${f.project.id}`)).json).not.toHaveProperty(
      "importProgress",
    );
  });

  it("denies a user outside the workspace", async () => {
    const f = await fixture();
    mockAuthenticatedSession(f.outsider);
    const r = await call(`/project/${f.project.id}`);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.json)).not.toContain("example");
  });
});

describe("PATCH /project/:projectId", () => {
  it("updates the comment flag and activity, keeping the rest of the config", async () => {
    const f = await fixture();
    mockAuthenticatedSession(f.owner);
    const r = await call(`/project/${f.project.id}`, "PATCH", {
      commentTaskLinkOnGitHubIssue: false,
      isActive: false,
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      commentTaskLinkOnGitHubIssue: false,
      isActive: false,
      repositoryOwner: "example",
    });
    const row = await storedIntegration(f.project.id);
    expect(row?.isActive).toBe(false);
    expect(JSON.parse(row?.config ?? "")).toMatchObject({
      repositoryId: 20,
      installationId: 10,
      verifiedByUserId: f.owner.id,
      commentTaskLinkOnGitHubIssue: false,
    });
  });

  it("keeps the current activity and flag when the body omits them", async () => {
    const f = await fixture({ isActive: false });
    mockAuthenticatedSession(f.owner);
    const r = await call(`/project/${f.project.id}`, "PATCH", {});
    expect(r.status).toBe(200);
    const row = await storedIntegration(f.project.id);
    expect(row?.isActive).toBe(false);
    expect(row?.config).toBe(f.integration?.config);
  });

  it("answers 404 without creating anything when no integration exists", async () => {
    const f = await fixture({ config: null });
    mockAuthenticatedSession(f.owner);
    expect(
      await call(`/project/${f.project.id}`, "PATCH", { isActive: true }),
    ).toEqual({ status: 404, json: { error: "Integration not found" } });
    expect(await storedIntegration(f.project.id)).toBeUndefined();
  });

  it("rejects a stored config that fails validation and leaves it untouched", async () => {
    const f = await fixture({ config: { installationId: "ten" } });
    mockAuthenticatedSession(f.owner);
    const r = await call(`/project/${f.project.id}`, "PATCH", {
      isActive: false,
    });
    expect(r.status).toBe(400);
    const row = await storedIntegration(f.project.id);
    expect(row?.isActive).toBe(true);
    expect(row?.config).toBe(f.integration?.config);
  });

  it("answers 500 for an unparsable stored config without changing it", async () => {
    const f = await fixture({ config: "{broken" });
    mockAuthenticatedSession(f.owner);
    const r = await call(`/project/${f.project.id}`, "PATCH", {
      isActive: false,
    });
    expect(r.status).toBe(500);
    expect((await storedIntegration(f.project.id))?.config).toBe("{broken");
  });

  it("denies members and outsiders and changes nothing", async () => {
    const f = await fixture();
    for (const user of [f.member, f.outsider]) {
      mockAuthenticatedSession(user);
      const r = await call(`/project/${f.project.id}`, "PATCH", {
        isActive: false,
      });
      expect(r.status).toBe(403);
    }
    const row = await storedIntegration(f.project.id);
    expect(row?.isActive).toBe(true);
    expect(row?.config).toBe(f.integration?.config);
  });
});

describe("DELETE /project/:projectId", () => {
  it("removes only this project's integration and its saved import progress", async () => {
    const f = await fixture();
    const other = await fixture();
    await db.insert(schema.githubImportTable).values({
      integrationId: f.integration?.id as string,
      state: initialImportState(20),
    });
    mockAuthenticatedSession(f.owner);
    const r = await call(`/project/${f.project.id}`, "DELETE");
    expect(r).toEqual({
      status: 200,
      json: { success: true, message: "GitHub integration deleted" },
    });
    expect(await storedIntegration(f.project.id)).toBeUndefined();
    expect(await storedIntegration(other.project.id)).toBeDefined();
    expect(await db.query.githubImportTable.findMany()).toHaveLength(0);
    expect((await call(`/project/${f.project.id}`, "DELETE")).status).toBe(404);
  });

  it("denies members and outsiders and keeps the integration", async () => {
    const f = await fixture();
    for (const user of [f.member, f.outsider]) {
      mockAuthenticatedSession(user);
      expect((await call(`/project/${f.project.id}`, "DELETE")).status).toBe(
        403,
      );
    }
    expect(await storedIntegration(f.project.id)).toBeDefined();
  });
});

describe("repository selection with GitHub", () => {
  const repoInfo = (id: number, name: string) => ({
    id,
    name,
    full_name: `example/${name}`,
    private: false,
    owner: { login: "example", avatar_url: "https://a/example", type: "User" },
    description: null,
    html_url: `https://github.com/example/${name}`,
    updated_at: "2025-01-01T00:00:00Z",
  });
  const happyRoutes = (f?: unknown): GithubRoutes => ({
    "GET /app/installations": {
      body: [{ id: 10, account: { login: "example", type: "User" } }],
    },
    "GET /user/30": { body: { id: 30, login: "admin" } },
    "GET /installation/repositories": {
      body: {
        total_count: 2,
        repositories: [repoInfo(20, "repo"), repoInfo(21, "readonly")],
      },
    },
    [`GET ${REPO}/collaborators/admin/permission`]: {
      body: { permission: "admin" },
    },
    "GET /repos/example/readonly/collaborators/admin/permission": {
      body: { permission: "write" },
    },
    ...(f ? {} : {}),
  });

  it("lists only repositories on which the user is admin, with bounded paging requests", async () => {
    const f = await fixture();
    await connectGithubAccount(f.owner.id);
    mockAuthenticatedSession(f.owner);
    const calls = stubGithub(happyRoutes());
    const r = await call(`/repositories/${f.project.id}`);
    expect(r.status).toBe(200);
    expect(
      r.json.repositories.map((x: { full_name: string }) => x.full_name),
    ).toEqual(["example/repo"]);
    expect(r.json.repositories[0]).toMatchObject({
      id: 20,
      installation_id: 10,
      owner: { login: "example", type: "User" },
    });
    expect(r.json.installations).toEqual([
      {
        id: 10,
        account: { login: "example", type: "User" },
        repositories: ["example/repo"],
      },
    ]);
    expect(r.json.total).toBe(1);
    expect(r.json.nextPage).toEqual({ installationPage: 2, repositoryPage: 1 });
    const installations = calls.find((c) => c.path === "/app/installations");
    expect(new URLSearchParams(installations?.search).get("per_page")).toBe(
      "1",
    );
    const repos = calls.find((c) => c.path === "/installation/repositories");
    expect(new URLSearchParams(repos?.search).get("per_page")).toBe("20");
    noLeak(r.json);
  });

  it("offers the next repository page when a full page was returned", async () => {
    const f = await fixture();
    await connectGithubAccount(f.owner.id);
    mockAuthenticatedSession(f.owner);
    const many = Array.from({ length: 20 }, (_, i) =>
      repoInfo(100 + i, `r${i}`),
    );
    const routes = happyRoutes();
    routes["GET /installation/repositories"] = {
      body: { total_count: 25, repositories: many },
    };
    for (const r of many) {
      routes[`GET /repos/example/${r.name}/collaborators/admin/permission`] = {
        body: { permission: "admin" },
      };
    }
    stubGithub(routes);
    const r = await call(
      `/repositories/${f.project.id}?installationPage=3&repositoryPage=2`,
    );
    expect(r.json.repositories).toHaveLength(20);
    expect(r.json.nextPage).toEqual({ installationPage: 3, repositoryPage: 3 });
  });

  it("returns an empty page when the App has no further installation", async () => {
    const f = await fixture();
    await connectGithubAccount(f.owner.id);
    mockAuthenticatedSession(f.owner);
    stubGithub({ "GET /app/installations": { body: [] } });
    expect(await call(`/repositories/${f.project.id}`)).toEqual({
      status: 200,
      json: { repositories: [], installations: [], total: 0, nextPage: null },
    });
  });

  it("omits repositories that GitHub reports as not found for the user", async () => {
    const f = await fixture();
    await connectGithubAccount(f.owner.id);
    mockAuthenticatedSession(f.owner);
    const routes = happyRoutes();
    routes[`GET ${REPO}/collaborators/admin/permission`] = {
      status: 404,
      body: {},
    };
    stubGithub(routes);
    const r = await call(`/repositories/${f.project.id}`);
    expect(r.json.repositories).toEqual([]);
    expect(r.json.installations).toEqual([]);
  });

  it("answers 502 without provider details when a permission lookup fails", async () => {
    const f = await fixture();
    await connectGithubAccount(f.owner.id);
    mockAuthenticatedSession(f.owner);
    const routes = happyRoutes();
    routes[`GET ${REPO}/collaborators/admin/permission`] = {
      status: 403,
      body: { message: "secret provider detail" },
    };
    stubGithub(routes);
    const r = await call(`/repositories/${f.project.id}`);
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.json)).not.toContain("secret provider detail");
    noLeak(r.json);
  });

  it("refuses when the GitHub identity of the connected account does not match", async () => {
    const f = await fixture();
    await connectGithubAccount(f.owner.id);
    mockAuthenticatedSession(f.owner);
    const routes = happyRoutes();
    routes["GET /user/30"] = { body: { id: 31, login: "someone-else" } };
    const calls = stubGithub(routes);
    const r = await call(`/repositories/${f.project.id}`);
    expect(r.status).toBe(403);
    expect(calls.some((c) => c.path === "/installation/repositories")).toBe(
      false,
    );
  });

  it("requires a connected GitHub account before any GitHub call", async () => {
    const f = await fixture();
    mockAuthenticatedSession(f.owner);
    const calls = stubGithub(happyRoutes());
    expect((await call(`/repositories/${f.project.id}`)).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("rejects malformed page parameters", async () => {
    const f = await fixture();
    await connectGithubAccount(f.owner.id);
    mockAuthenticatedSession(f.owner);
    const calls = stubGithub(happyRoutes());
    for (const q of [
      "installationPage=0",
      "repositoryPage=abc",
      "installationPage=1000000",
    ]) {
      expect((await call(`/repositories/${f.project.id}?${q}`)).status).toBe(
        400,
      );
    }
    expect(calls).toEqual([]);
  });

  describe("POST /project/:projectId", () => {
    const routes = (over: GithubRoutes = {}): GithubRoutes => ({
      [`GET ${REPO}/installation`]: { body: { id: 10 } },
      "GET /user/30": { body: { id: 30, login: "admin" } },
      [`GET ${REPO}/collaborators/admin/permission`]: {
        body: { permission: "admin" },
      },
      [`GET ${REPO}`]: {
        body: { id: 20, owner: { login: "example" }, name: "repo" },
      },
      ...over,
    });
    const body = { repositoryOwner: "example", repositoryName: "repo" };

    it("binds the verified repository and stores the verification identifiers", async () => {
      const f = await fixture({ config: null });
      await connectGithubAccount(f.owner.id);
      mockAuthenticatedSession(f.owner);
      stubGithub(routes());
      const r = await call(`/project/${f.project.id}`, "POST", body);
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({
        projectId: f.project.id,
        repositoryOwner: "example",
        repositoryName: "repo",
        installationId: 10,
        requiresVerification: false,
        isActive: true,
      });
      const row = await storedIntegration(f.project.id);
      expect(JSON.parse(row?.config ?? "")).toMatchObject({
        installationId: 10,
        repositoryId: 20,
        verifiedGithubAccountId: "30",
        verifiedByUserId: f.owner.id,
        branchPattern: "{slug}-{number}",
      });
      noLeak(r.json);
    });

    it("reconnects the same repository, keeping custom settings", async () => {
      const f = await fixture({
        config: {
          commentTaskLinkOnGitHubIssue: false,
          branchPattern: "{number}",
        },
        isActive: false,
      });
      await connectGithubAccount(f.owner.id);
      mockAuthenticatedSession(f.owner);
      stubGithub(routes());
      const r = await call(`/project/${f.project.id}`, "POST", body);
      expect(r.status).toBe(200);
      expect(r.json.id).toBe(f.integration?.id);
      const row = await storedIntegration(f.project.id);
      expect(row?.isActive).toBe(true);
      expect(JSON.parse(row?.config ?? "")).toMatchObject({
        commentTaskLinkOnGitHubIssue: false,
        branchPattern: "{number}",
      });
    });

    it("refuses another repository while the project is still linked", async () => {
      const f = await fixture();
      await connectGithubAccount(f.owner.id);
      mockAuthenticatedSession(f.owner);
      stubGithub(
        routes({
          "GET /repos/example/other/installation": { body: { id: 10 } },
          "GET /repos/example/other/collaborators/admin/permission": {
            body: { permission: "admin" },
          },
          "GET /repos/example/other": {
            body: { id: 99, owner: { login: "example" }, name: "other" },
          },
        }),
      );
      const r = await call(`/project/${f.project.id}`, "POST", {
        repositoryOwner: "example",
        repositoryName: "other",
      });
      expect(r.status).toBe(409);
      expect((await storedIntegration(f.project.id))?.config).toBe(
        f.integration?.config,
      );
    });

    it("treats an unparsable previous config as a different repository", async () => {
      const f = await fixture({ config: "{broken" });
      await connectGithubAccount(f.owner.id);
      mockAuthenticatedSession(f.owner);
      stubGithub(routes());
      expect(
        (await call(`/project/${f.project.id}`, "POST", body)).status,
      ).toBe(409);
      expect((await storedIntegration(f.project.id))?.config).toBe("{broken");
    });

    it("compares legacy configs without a repository id by owner and name, ignoring case", async () => {
      const f = await fixture({
        config: {
          repositoryOwner: "Example",
          repositoryName: "REPO",
          repositoryId: undefined,
          verifiedGithubAccountId: undefined,
          verifiedByUserId: undefined,
        },
      });
      await connectGithubAccount(f.owner.id);
      mockAuthenticatedSession(f.owner);
      stubGithub(routes());
      const r = await call(`/project/${f.project.id}`, "POST", body);
      expect(r.status).toBe(200);
      expect(
        JSON.parse((await storedIntegration(f.project.id))?.config ?? "")
          .repositoryId,
      ).toBe(20);
    });

    it.each([
      [
        "a non-admin collaborator",
        {
          [`GET ${REPO}/collaborators/admin/permission`]: {
            body: { permission: "write" },
          },
        },
      ],
      [
        "an uninstalled App",
        { [`GET ${REPO}/installation`]: { status: 404, body: {} } },
      ],
      [
        "a different GitHub identity",
        { "GET /user/30": { body: { id: 31, login: "x" } } },
      ],
    ])("answers a generic 403 and stores nothing for %s", async (_n, over) => {
      const f = await fixture({ config: null });
      await connectGithubAccount(f.owner.id);
      mockAuthenticatedSession(f.owner);
      stubGithub(routes(over as GithubRoutes));
      const r = await call(`/project/${f.project.id}`, "POST", body);
      expect(r.status).toBe(403);
      expect(JSON.stringify(r.json)).toContain("could not be verified");
      noLeak(r.json);
      expect(await storedIntegration(f.project.id)).toBeUndefined();
    });

    it("requires a connected GitHub account and workspace administration rights", async () => {
      const f = await fixture({ config: null });
      mockAuthenticatedSession(f.owner);
      const calls = stubGithub(routes());
      expect(
        (await call(`/project/${f.project.id}`, "POST", body)).status,
      ).toBe(403);
      await connectGithubAccount(f.member.id);
      mockAuthenticatedSession(f.member);
      expect(
        (await call(`/project/${f.project.id}`, "POST", body)).status,
      ).toBe(403);
      expect(calls).toEqual([]);
      expect(await storedIntegration(f.project.id)).toBeUndefined();
    });

    it("rejects empty or oversized repository names", async () => {
      const f = await fixture({ config: null });
      await connectGithubAccount(f.owner.id);
      mockAuthenticatedSession(f.owner);
      const calls = stubGithub(routes());
      for (const bad of [
        { repositoryOwner: "", repositoryName: "repo" },
        { repositoryOwner: "example", repositoryName: "x".repeat(101) },
        { repositoryOwner: "example" },
      ]) {
        expect(
          (await call(`/project/${f.project.id}`, "POST", bad)).status,
        ).toBe(400);
      }
      expect(calls).toEqual([]);
    });

    it("createGithubIntegration reports an unknown project as 404 before contacting GitHub", async () => {
      const f = await fixture({ config: null });
      const calls = stubGithub(routes());
      await expect(
        createGithubIntegration({
          userId: f.owner.id,
          projectId: "missing",
          repositoryOwner: "example",
          repositoryName: "repo",
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(calls).toEqual([]);
    });
  });

  describe("POST /verify", () => {
    it("returns the installation verification for a workspace administrator", async () => {
      const f = await fixture({ config: null });
      await connectGithubAccount(f.owner.id);
      mockAuthenticatedSession(f.owner);
      stubGithub({
        [`GET ${REPO}/installation`]: {
          body: { id: 10, permissions: { issues: "write" } },
        },
        "GET /user/30": { body: { id: 30, login: "admin" } },
        [`GET ${REPO}/collaborators/admin/permission`]: {
          body: { permission: "admin" },
        },
        [`GET ${REPO}`]: {
          body: {
            id: 20,
            private: true,
            owner: { id: 30, login: "example" },
            name: "repo",
          },
        },
      });
      const r = await call("/verify", "POST", {
        projectId: f.project.id,
        repositoryOwner: "example",
        repositoryName: "repo",
      });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({
        isInstalled: true,
        installationId: 10,
        repositoryExists: true,
        repositoryPrivate: true,
        hasRequiredPermissions: true,
        missingPermissions: [],
      });
      noLeak(r.json);
    });

    it("refuses a user whose GitHub account lacks admin rights without disclosing installation state", async () => {
      const f = await fixture({ config: null });
      await connectGithubAccount(f.owner.id);
      mockAuthenticatedSession(f.owner);
      stubGithub({
        [`GET ${REPO}/installation`]: { body: { id: 10 } },
        "GET /user/30": { body: { id: 30, login: "admin" } },
        [`GET ${REPO}/collaborators/admin/permission`]: {
          body: { permission: "read" },
        },
      });
      const r = await call("/verify", "POST", {
        projectId: f.project.id,
        repositoryOwner: "example",
        repositoryName: "repo",
      });
      expect(r.status).toBe(403);
      expect(JSON.stringify(r.json)).not.toContain("installationId");
    });
  });
});

describe("POST /import-issues error paths", () => {
  const post = (projectId: string, runId?: string) =>
    call("/import-issues", "POST", { projectId, ...(runId ? { runId } : {}) });

  it("answers 404 for a project without GitHub integration", async () => {
    const f = await fixture({ config: null });
    mockAuthenticatedSession(f.owner);
    const calls = stubGithub();
    expect(await post(f.project.id)).toMatchObject({ status: 404 });
    expect(calls).toEqual([]);
  });

  it("importIssues answers 404 for an unknown project", async () => {
    await expect(importIssues("missing")).rejects.toMatchObject({
      status: 404,
      message: "Project not found",
    });
  });

  it.each([
    ["inactive", { isActive: false }, "not active"],
    [
      "unparsable",
      { config: "{broken" },
      "Invalid GitHub integration configuration",
    ],
    [
      "unverified legacy",
      { config: { repositoryId: undefined } },
      "reconnected by a repository administrator",
    ],
  ])(
    "answers 400 for an %s integration without contacting GitHub",
    async (_n, options, message) => {
      const f = await fixture(options);
      mockAuthenticatedSession(f.owner);
      const calls = stubGithub();
      const r = await post(f.project.id);
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.json)).toContain(message);
      expect(calls).toEqual([]);
      expect(await db.query.taskTable.findMany()).toHaveLength(0);
    },
  );

  it("answers 502 when the repository identity cannot be verified and creates no task", async () => {
    const f = await fixture();
    mockAuthenticatedSession(f.owner);
    const calls = stubGithub({ [`GET ${REPO}`]: { body: { id: 99 } } });
    const r = await post(f.project.id);
    expect(r.status).toBe(502);
    expect(calls.some((c) => c.path === "/graphql")).toBe(false);
    expect(await db.query.taskTable.findMany()).toHaveLength(0);
    noLeak(r.json);
  });
});

describe("import continuation edge cases", () => {
  const startedAt = "2025-06-01T00:00:00.000Z";
  const emptyPulls = {
    repository: {
      databaseId: 20,
      pullRequests: {
        totalCount: 0,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [],
      },
    },
  };
  function graphql(handlers: Record<string, unknown>) {
    return (c: GithubCall) => {
      const query = String((c.body as { query: string }).query);
      const key = Object.keys(handlers).find((k) => query.includes(k));
      return key
        ? { body: { data: handlers[key] } }
        : { status: 500, body: { message: "unexpected query" } };
    };
  }
  async function resume(
    f: Fixture,
    state: Partial<ReturnType<typeof initialImportState>>,
  ) {
    await db.insert(schema.githubImportTable).values({
      integrationId: f.integration?.id as string,
      runId: "run-1",
      state: { ...initialImportState(20), startedAt, ...state },
    });
    mockAuthenticatedSession(f.owner);
  }
  const current = (taskId: string, over = {}) => ({
    number: 5,
    taskId,
    labelCursor: null,
    commentCursor: null,
    moreComments: false,
    labelsRemaining: 5,
    commentsRemaining: 0,
    statusSeen: false,
    prioritySeen: false,
    ...over,
  });

  it("skips an issue whose task now belongs to another project", async () => {
    const f = await fixture();
    const other = await fixture();
    const [foreignTask] = await db
      .insert(schema.taskTable)
      .values({ projectId: other.project.id, title: "Foreign", number: 1 })
      .returning();
    await resume(f, {
      phase: "labels",
      moreIssues: false,
      currentIssue: current(foreignTask.id),
      imported: 1,
    });
    stubGithub({
      [`GET ${REPO}`]: { body: { id: 20 } },
      "POST /graphql": graphql({
        ImportIssueLabels: {
          repository: {
            databaseId: 20,
            issue: {
              labels: {
                totalCount: 1,
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ name: "bug", color: "d73a4a" }],
              },
            },
          },
        },
        ImportPullRequests: emptyPulls,
      }),
    });
    const r = await call("/import-issues", "POST", { projectId: f.project.id });
    expect(r).toEqual({
      status: 200,
      json: {
        runId: "run-1",
        pending: false,
        imported: 1,
        updated: 0,
        skipped: 1,
      },
    });
    expect(await db.query.labelTable.findMany()).toHaveLength(0);
  });

  it("skips an issue that disappeared on GitHub while its labels were pending", async () => {
    const f = await fixture();
    const [task] = await db
      .insert(schema.taskTable)
      .values({ projectId: f.project.id, title: "Mine", number: 1 })
      .returning();
    await resume(f, {
      phase: "labels",
      moreIssues: false,
      currentIssue: current(task.id),
      imported: 1,
    });
    stubGithub({
      [`GET ${REPO}`]: { body: { id: 20 } },
      "POST /graphql": graphql({
        ImportIssueLabels: { repository: { databaseId: 20, issue: null } },
        ImportPullRequests: emptyPulls,
      }),
    });
    const r = await call("/import-issues", "POST", { projectId: f.project.id });
    expect(r.json).toMatchObject({ pending: false, imported: 1, skipped: 1 });
    expect(await db.query.taskTable.findMany()).toHaveLength(1);
  });

  it("does not link pull requests opened after the import started", async () => {
    const f = await fixture();
    await db
      .insert(schema.taskTable)
      .values({ projectId: f.project.id, title: "Mine", number: 7 });
    await resume(f, { phase: "pulls", moreIssues: false });
    stubGithub({
      [`GET ${REPO}`]: { body: { id: 20 } },
      "POST /graphql": graphql({
        ImportPullRequests: {
          repository: {
            databaseId: 20,
            pullRequests: {
              totalCount: 1,
              pageInfo: { hasNextPage: true, endCursor: "c1" },
              nodes: [
                {
                  number: 31,
                  title: "Fix",
                  body: null,
                  url: "https://github.com/example/repo/pull/31",
                  state: "OPEN",
                  createdAt: "2025-07-01T00:00:00Z",
                  headRefName: `${f.project.slug}-7`,
                  author: null,
                },
              ],
            },
          },
        },
      }),
    });
    const r = await call("/import-issues", "POST", { projectId: f.project.id });
    expect(r.json).toMatchObject({ pending: false });
    expect(await db.query.externalLinkTable.findMany()).toHaveLength(0);
  });
});
