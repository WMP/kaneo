import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import createGitlabIntegration from "../../apps/api/src/gitlab-integration/controllers/create-gitlab-integration";
import { importGitlabIssues } from "../../apps/api/src/gitlab-integration/controllers/import-gitlab-issues";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// A routable documentation address: the SSRF guard accepts it without DNS, and
// every request to it is answered by the fetch stub below.
const BASE_URL = "https://203.0.113.10";
const TOKEN = "glpat-abcdefghijklmnop";
const MASKED_TOKEN = "glpa••••••mnop";

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
type Route = [method: string, path: RegExp, handler: Handler];

const requests: Array<{
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}> = [];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubGitlab(routes: Route[]) {
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = (init.method ?? "GET").toUpperCase();
      const path = decodeURIComponent(url.pathname + url.search).replace(
        /^\/api\/v4/,
        "",
      );
      requests.push({
        method,
        path,
        headers: { ...(init.headers as Record<string, string>) },
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      const route = routes.find(
        ([routeMethod, pattern]) =>
          routeMethod === method && pattern.test(path),
      );
      if (!route) {
        throw new Error(`Unexpected GitLab request: ${method} ${path}`);
      }
      return route[2](url, init);
    }),
  );
}

const userOk: Route = [
  "GET",
  /^\/user$/,
  () => json({ id: 1, username: "bot" }),
];

function projectRoute(overrides: Record<string, unknown> = {}): Route {
  return [
    "GET",
    /^\/projects\/group\/project$/,
    () =>
      json({
        id: 9,
        name: "project",
        path_with_namespace: "group/project",
        name_with_namespace: "Group / project",
        visibility: "private",
        web_url: `${BASE_URL}/group/project`,
        permissions: { project_access: { access_level: 40 } },
        ...overrides,
      }),
  ];
}

async function setup() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project, columns } = await createProjectFixture({
    workspaceId: owner.workspace.id,
    slug: "kan",
  });
  const reader = await addWorkspaceMember(owner.workspace.id, "member");
  await addProjectMember(project.id, reader.id, "member");
  const outsider = await createWorkspaceMember({ role: "owner" });
  const { app } = createApp();

  const call = (
    method: string,
    path: string,
    body?: unknown,
    as: { id: string } = owner.user,
  ) => {
    mockAuthenticatedSession(as as typeof owner.user);
    return app.request(`/api/gitlab-integration${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  return { owner, reader, outsider, project, columns, call };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function storeIntegration(
  projectId: string,
  config: Record<string, unknown> = {},
  isActive = true,
) {
  const [integration] = await db
    .insert(schema.integrationTable)
    .values({
      projectId,
      type: "gitlab",
      isActive,
      config: JSON.stringify({
        baseUrl: BASE_URL,
        projectPath: "group/project",
        accessToken: TOKEN,
        webhookSecret: "stored-secret",
        ...config,
      }),
    })
    .returning();
  return integration;
}

async function integrationRows(projectId: string) {
  return db.query.integrationTable.findMany({
    where: eq(schema.integrationTable.projectId, projectId),
  });
}

beforeEach(async () => {
  await resetTestDatabase();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  requests.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /gitlab-integration/projects", () => {
  const body = (env: Env, extra: Record<string, unknown> = {}) => ({
    projectId: env.project.id,
    baseUrl: BASE_URL,
    accessToken: TOKEN,
    ...extra,
  });

  it("lists member projects page by page and returns only the public fields", async () => {
    const env = await setup();
    const row = (id: number) => ({
      id,
      name: `p${id}`,
      path_with_namespace: `g/p${id}`,
      name_with_namespace: `G / p${id}`,
      visibility: "private",
      web_url: `${BASE_URL}/g/p${id}`,
      runners_token: "must-not-be-forwarded",
    });
    stubGitlab([
      userOk,
      [
        "GET",
        /^\/projects\?.*page=1$/,
        () => json(Array.from({ length: 50 }, (_, i) => row(i + 1))),
      ],
      [
        "GET",
        /^\/projects\?.*page=2$/,
        () => json([row(51), row(52), row(53)]),
      ],
    ]);

    const response = await env.call("POST", "/projects", body(env));

    expect(response.status).toBe(200);
    const text = await response.text();
    const { projects } = JSON.parse(text);
    expect(projects).toHaveLength(53);
    expect(projects[52]).toEqual({
      id: 53,
      name: "p53",
      path_with_namespace: "g/p53",
      name_with_namespace: "G / p53",
      visibility: "private",
      web_url: `${BASE_URL}/g/p53`,
    });
    expect(text).not.toContain("must-not-be-forwarded");
    expect(text).not.toContain(TOKEN);
    expect(requests.at(-1)?.path).toContain("membership=true");
    expect(requests.at(-1)?.headers["PRIVATE-TOKEN"]).toBe(TOKEN);
  });

  it("stops at an empty page and sends a bearer token when asked to", async () => {
    const env = await setup();
    stubGitlab([userOk, ["GET", /^\/projects\?/, () => json([])]]);

    const response = await env.call(
      "POST",
      "/projects",
      body(env, { tokenType: "bearer" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ projects: [] });
    expect(requests.map((r) => r.method + r.path.split("?")[0])).toEqual([
      "GET/user",
      "GET/projects",
    ]);
    expect(requests[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(requests[0]?.headers["PRIVATE-TOKEN"]).toBeUndefined();
  });

  it("answers 401 without the token when GitLab rejects it", async () => {
    const env = await setup();
    stubGitlab([
      ["GET", /^\/user$/, () => json({ message: "401 Unauthorized" }, 401)],
    ]);

    const response = await env.call("POST", "/projects", body(env));

    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).toContain("Invalid GitLab token or could not reach instance.");
    expect(text).not.toContain(TOKEN);
  });

  it("answers 401 when the instance cannot be reached", async () => {
    const env = await setup();
    stubGitlab([
      [
        "GET",
        /^\/user$/,
        () => {
          throw new TypeError("fetch failed");
        },
      ],
    ]);

    const response = await env.call("POST", "/projects", body(env));

    expect(response.status).toBe(401);
  });

  it.each([
    { name: "plain http", baseUrl: "http://203.0.113.10" },
    {
      name: "a base URL with credentials",
      baseUrl: "https://u:p@203.0.113.10",
    },
    { name: "a base URL with a query", baseUrl: "https://203.0.113.10/?x=1" },
  ])("rejects $name with 400 before contacting GitLab", async ({ baseUrl }) => {
    const env = await setup();
    stubGitlab([userOk]);

    const response = await env.call(
      "POST",
      "/projects",
      body(env, { baseUrl }),
    );

    expect(response.status).toBe(400);
    expect(requests).toEqual([]);
  });

  it("rejects a body without an access token", async () => {
    const env = await setup();
    stubGitlab([userOk]);

    const response = await env.call("POST", "/projects", {
      projectId: env.project.id,
      baseUrl: BASE_URL,
    });

    expect(response.status).toBe(400);
    expect(requests).toEqual([]);
  });

  it("refuses a member without manage_settings, a stranger and an unknown project", async () => {
    const env = await setup();
    stubGitlab([userOk]);

    expect(
      (await env.call("POST", "/projects", body(env), env.reader)).status,
    ).toBe(403);
    expect(
      (await env.call("POST", "/projects", body(env), env.outsider.user))
        .status,
    ).toBe(403);
    expect(
      (await env.call("POST", "/projects", body(env, { projectId: "nope" })))
        .status,
    ).toBe(400);
    expect(requests).toEqual([]);
  });
});

describe("POST /gitlab-integration/verify", () => {
  const body = (env: Env, extra: Record<string, unknown> = {}) => ({
    projectId: env.project.id,
    baseUrl: BASE_URL,
    accessToken: TOKEN,
    projectPath: "group/project",
    ...extra,
  });

  it("accepts a token with Developer access", async () => {
    const env = await setup();
    stubGitlab([userOk, projectRoute()]);

    const response = await env.call("POST", "/verify", body(env));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      isInstalled: true,
      hasRequiredPermissions: true,
      projectExists: true,
      projectVisibility: "private",
      missingPermissions: [],
      message: "Token can access the project.",
      failureReason: null,
    });
  });

  it.each([
    {
      name: "Reporter project access",
      permissions: { project_access: { access_level: 20 } },
      ok: false,
    },
    {
      name: "Developer group access",
      permissions: { project_access: null, group_access: { access_level: 30 } },
      ok: true,
    },
    {
      name: "the higher of project and group access",
      permissions: {
        project_access: { access_level: 10 },
        group_access: { access_level: 50 },
      },
      ok: true,
    },
    {
      name: "no access level (group or instance token)",
      permissions: null,
      ok: true,
    },
    {
      name: "an access level of 29",
      permissions: { project_access: { access_level: 29 } },
      ok: false,
    },
  ])("judges permissions for $name", async ({ permissions, ok }) => {
    const env = await setup();
    stubGitlab([userOk, projectRoute({ permissions })]);

    const response = await env.call("POST", "/verify", body(env));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      isInstalled: true,
      projectExists: true,
      hasRequiredPermissions: ok,
      missingPermissions: ok ? [] : ["Developer"],
      failureReason: null,
    });
  });

  it("reports a URL that is not a GitLab instance (404 on /user)", async () => {
    const env = await setup();
    stubGitlab([["GET", /^\/user$/, () => json({}, 404)]]);

    const response = await env.call("POST", "/verify", body(env));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      isInstalled: false,
      failureReason: "not_a_gitlab_instance",
      message: "The URL does not point to a GitLab instance.",
    });
  });

  it("reports a redirect so the user can enter the final URL", async () => {
    const env = await setup();
    stubGitlab([
      [
        "GET",
        /^\/user$/,
        () =>
          new Response(null, {
            status: 301,
            headers: { Location: "https://x" },
          }),
      ],
    ]);

    const response = await env.call("POST", "/verify", body(env));

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.failureReason).toBe("redirected");
    expect(result.message).toContain("HTTP 301");
  });

  it("reports an HTML answer as not being GitLab", async () => {
    const env = await setup();
    stubGitlab([
      [
        "GET",
        /^\/user$/,
        () => new Response("<html>login</html>", { status: 200 }),
      ],
    ]);

    const response = await env.call("POST", "/verify", body(env));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      isInstalled: false,
      failureReason: "not_a_gitlab_instance",
    });
  });

  it("reports a missing project in a 200 body", async () => {
    const env = await setup();
    stubGitlab([
      userOk,
      ["GET", /^\/projects\/group\/project$/, () => json({}, 404)],
    ]);

    const response = await env.call("POST", "/verify", body(env));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      isInstalled: false,
      projectExists: false,
      failureReason: "project_not_found",
    });
  });

  it.each([
    {
      name: "401 on /user",
      routes: [["GET", /^\/user$/, () => json({}, 401)]] as Route[],
    },
    {
      name: "403 on the project",
      routes: [
        userOk,
        ["GET", /^\/projects\//, () => json({}, 403)],
      ] as Route[],
    },
  ])("answers 401 for $name", async ({ routes }) => {
    const env = await setup();
    stubGitlab(routes);

    const response = await env.call("POST", "/verify", body(env));

    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).toContain("Invalid GitLab token or unauthorized.");
    expect(text).not.toContain(TOKEN);
  });

  it("answers 500 with the error message for an unexpected GitLab failure", async () => {
    const env = await setup();
    stubGitlab([["GET", /^\/user$/, () => json({}, 500)]]);

    const response = await env.call("POST", "/verify", body(env));

    expect(response.status).toBe(500);
    expect(await response.text()).toContain("GitLab API error 500");
  });

  it("answers 500 when the network fails", async () => {
    const env = await setup();
    stubGitlab([
      [
        "GET",
        /^\/user$/,
        () => {
          throw new TypeError("fetch failed");
        },
      ],
    ]);

    const response = await env.call("POST", "/verify", body(env));

    expect(response.status).toBe(500);
    expect(await response.text()).toContain("fetch failed");
  });

  it("rejects an invalid project path with 400 and does not call GitLab", async () => {
    const env = await setup();
    stubGitlab([userOk]);

    for (const projectPath of ["single", "group/../secret"]) {
      const response = await env.call(
        "POST",
        "/verify",
        body(env, { projectPath }),
      );
      expect(response.status).toBe(400);
    }
    expect(requests).toEqual([]);
  });

  it("refuses a member without manage_settings", async () => {
    const env = await setup();
    stubGitlab([userOk, projectRoute()]);

    const response = await env.call("POST", "/verify", body(env), env.reader);

    expect(response.status).toBe(403);
    expect(requests).toEqual([]);
  });
});

describe("GET /gitlab-integration/project/:projectId", () => {
  it("returns null while the project has no integration", async () => {
    const env = await setup();

    const response = await env.call("GET", `/project/${env.project.id}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("shows the masked token and webhook secret to a settings manager", async () => {
    const env = await setup();
    const integration = await storeIntegration(env.project.id, {
      branchPattern: "feature/{slug}-{number}",
      commentTaskLinkOnGitlabIssue: false,
      tokenType: "bearer",
    });
    vi.stubEnv("KANEO_API_URL", "https://kaneo.example/api/");

    const response = await env.call("GET", `/project/${env.project.id}`);

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({
      id: integration.id,
      projectId: env.project.id,
      baseUrl: BASE_URL,
      projectPath: "group/project",
      tokenType: "bearer",
      maskedAccessToken: MASKED_TOKEN,
      webhookSecret: "stored-secret",
      webhookUrl: `https://kaneo.example/api/gitlab-integration/webhook/${integration.id}`,
      branchPattern: "feature/{slug}-{number}",
      commentTaskLinkOnGitlabIssue: false,
      isActive: true,
    });
    expect(text).not.toContain(TOKEN);
  });

  it("fully masks a short token and defaults the optional settings", async () => {
    const env = await setup();
    await storeIntegration(env.project.id, { accessToken: "short" });

    const response = await env.call("GET", `/project/${env.project.id}`);

    expect(await response.json()).toMatchObject({
      maskedAccessToken: "••••••••",
      tokenType: "private",
      branchPattern: "{slug}-{number}",
      commentTaskLinkOnGitlabIssue: true,
    });
  });

  it("hides the token and the secret from a member without manage_settings", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);

    const response = await env.call(
      "GET",
      `/project/${env.project.id}`,
      undefined,
      env.reader,
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({
      maskedAccessToken: "",
      webhookSecret: "",
    });
    expect(text).not.toContain("stored-secret");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(MASKED_TOKEN);
  });

  it("refuses a user outside the workspace and an unknown project", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);

    const foreign = await env.call(
      "GET",
      `/project/${env.project.id}`,
      undefined,
      env.outsider.user,
    );
    const unknown = await env.call("GET", "/project/missing");

    expect(foreign.status).toBe(403);
    expect(await foreign.text()).not.toContain("stored-secret");
    expect(unknown.status).toBe(400);
  });
});

describe("POST /gitlab-integration/project/:projectId", () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    baseUrl: `${BASE_URL}/`,
    accessToken: ` ${TOKEN} `,
    projectPath: "/group/project/",
    ...extra,
  });

  it("verifies the token, stores a normalized config with a fresh secret and returns it", async () => {
    const env = await setup();
    stubGitlab([userOk, projectRoute()]);

    const response = await env.call(
      "POST",
      `/project/${env.project.id}`,
      body(),
    );

    expect(response.status).toBe(200);
    const [row] = await integrationRows(env.project.id);
    const config = JSON.parse(row.config);
    expect(config).toMatchObject({
      baseUrl: BASE_URL,
      projectPath: "group/project",
      accessToken: TOKEN,
      tokenType: "private",
      branchPattern: "{slug}-{number}",
      commentTaskLinkOnGitlabIssue: true,
      statusTransitions: {
        onBranchPush: "in-progress",
        onPROpen: "in-review",
        onPRMerge: "done",
      },
    });
    expect(config.webhookSecret).toMatch(/^[0-9a-f]{48}$/);
    expect(row.isActive).toBe(true);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({
      id: row.id,
      projectId: env.project.id,
      webhookSecret: config.webhookSecret,
      maskedAccessToken: MASKED_TOKEN,
    });
    expect(text).not.toContain(TOKEN);
    expect(requests.map((r) => r.path)).toEqual([
      "/user",
      "/projects/group/project",
    ]);
  });

  it("keeps the secret, the token and the custom settings when it is called again without a token", async () => {
    const env = await setup();
    const existing = await storeIntegration(
      env.project.id,
      {
        branchPattern: "fix/{number}-{title}",
        customBranchRegex: "^x-(\\d+)$",
        commentTaskLinkOnGitlabIssue: false,
        statusTransitions: { onPRMerge: "in-review" },
      },
      false,
    );
    stubGitlab([userOk, projectRoute()]);

    const response = await env.call("POST", `/project/${env.project.id}`, {
      baseUrl: BASE_URL,
      projectPath: "group/project",
    });

    expect(response.status).toBe(200);
    const rows = await integrationRows(env.project.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing.id);
    expect(rows[0].isActive).toBe(true);
    expect(JSON.parse(rows[0].config)).toMatchObject({
      accessToken: TOKEN,
      webhookSecret: "stored-secret",
      branchPattern: "fix/{number}-{title}",
      customBranchRegex: "^x-(\\d+)$",
      commentTaskLinkOnGitlabIssue: false,
      statusTransitions: { onPRMerge: "in-review" },
    });
    expect(requests[0]?.headers["PRIVATE-TOKEN"]).toBe(TOKEN);
  });

  it("starts over with a new secret when the stored config cannot be read", async () => {
    const env = await setup();
    await db.insert(schema.integrationTable).values({
      projectId: env.project.id,
      type: "gitlab",
      config: "{broken",
    });
    stubGitlab([userOk, projectRoute()]);

    const noToken = await env.call("POST", `/project/${env.project.id}`, {
      baseUrl: BASE_URL,
      projectPath: "group/project",
    });
    expect(noToken.status).toBe(400);
    expect(await noToken.text()).toContain("Access token is required");

    const withToken = await env.call(
      "POST",
      `/project/${env.project.id}`,
      body(),
    );
    expect(withToken.status).toBe(200);
    const [row] = await integrationRows(env.project.id);
    expect(JSON.parse(row.config).webhookSecret).toMatch(/^[0-9a-f]{48}$/);
  });

  it("requires a token when none is stored and stores nothing", async () => {
    const env = await setup();
    stubGitlab([userOk, projectRoute()]);

    for (const accessToken of [undefined, "", "   "]) {
      const response = await env.call("POST", `/project/${env.project.id}`, {
        baseUrl: BASE_URL,
        projectPath: "group/project",
        accessToken,
      });
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Access token is required");
    }
    expect(await integrationRows(env.project.id)).toEqual([]);
    expect(requests).toEqual([]);
  });

  it.each([
    {
      name: "401 for a token GitLab rejects",
      routes: [["GET", /^\/user$/, () => json({}, 401)]] as Route[],
      status: 401,
    },
    {
      name: "404 for a project GitLab does not know",
      routes: [
        userOk,
        ["GET", /^\/projects\//, () => json({}, 404)],
      ] as Route[],
      status: 404,
    },
  ])("passes through $name and stores nothing", async ({ routes, status }) => {
    const env = await setup();
    stubGitlab(routes);

    const response = await env.call(
      "POST",
      `/project/${env.project.id}`,
      body(),
    );

    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain(TOKEN);
    expect(await integrationRows(env.project.id)).toEqual([]);
  });

  it("answers 500 when GitLab returns an empty project body", async () => {
    const env = await setup();
    stubGitlab([
      userOk,
      ["GET", /^\/projects\//, () => new Response("", { status: 200 })],
    ]);

    const response = await env.call(
      "POST",
      `/project/${env.project.id}`,
      body(),
    );

    expect(response.status).toBe(500);
    expect(await integrationRows(env.project.id)).toEqual([]);
  });

  it("propagates a network failure as a server error and stores nothing", async () => {
    const env = await setup();
    stubGitlab([
      [
        "GET",
        /^\/user$/,
        () => {
          throw new TypeError("fetch failed");
        },
      ],
    ]);

    const response = await env.call(
      "POST",
      `/project/${env.project.id}`,
      body(),
    );

    expect(response.status).toBe(500);
    expect(await integrationRows(env.project.id)).toEqual([]);
  });

  it("answers 409 when another project already uses that GitLab project", async () => {
    const env = await setup();
    const other = await createProjectFixture({
      workspaceId: env.owner.workspace.id,
    });
    await storeIntegration(other.project.id, { baseUrl: `${BASE_URL}/` });
    stubGitlab([userOk, projectRoute()]);

    const response = await env.call(
      "POST",
      `/project/${env.project.id}`,
      body(),
    );

    expect(response.status).toBe(409);
    expect(await response.text()).toContain(
      "already linked to another project",
    );
    expect(await integrationRows(env.project.id)).toEqual([]);
  });

  it("answers 409 across workspaces too, because webhooks match on instance and path", async () => {
    const env = await setup();
    const foreign = await createWorkspaceMember({ role: "owner" });
    const foreignProject = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    await storeIntegration(foreignProject.project.id);
    stubGitlab([userOk, projectRoute()]);

    const response = await env.call(
      "POST",
      `/project/${env.project.id}`,
      body(),
    );

    expect(response.status).toBe(409);
  });

  it("ignores a disabled integration, other paths and unreadable configs when checking conflicts", async () => {
    const env = await setup();
    const a = await createProjectFixture({
      workspaceId: env.owner.workspace.id,
    });
    const b = await createProjectFixture({
      workspaceId: env.owner.workspace.id,
    });
    const c = await createProjectFixture({
      workspaceId: env.owner.workspace.id,
    });
    await storeIntegration(a.project.id, {}, false);
    await storeIntegration(b.project.id, { projectPath: "group/another" });
    await db.insert(schema.integrationTable).values({
      projectId: c.project.id,
      type: "gitlab",
      config: "{broken",
    });
    stubGitlab([userOk, projectRoute()]);

    const response = await env.call(
      "POST",
      `/project/${env.project.id}`,
      body(),
    );

    expect(response.status).toBe(200);
  });

  it("rejects invalid input without calling GitLab", async () => {
    const env = await setup();
    stubGitlab([userOk, projectRoute()]);

    for (const bad of [
      { baseUrl: "not a url" },
      { baseUrl: "http://203.0.113.10" },
      { projectPath: "single" },
      { projectPath: "" },
    ]) {
      const response = await env.call(
        "POST",
        `/project/${env.project.id}`,
        body(bad),
      );
      expect(response.status).toBe(400);
    }
    expect(requests).toEqual([]);
    expect(await integrationRows(env.project.id)).toEqual([]);
  });

  it("refuses a member without manage_settings and a stranger", async () => {
    const env = await setup();
    stubGitlab([userOk, projectRoute()]);

    const asReader = await env.call(
      "POST",
      `/project/${env.project.id}`,
      body(),
      env.reader,
    );
    const asStranger = await env.call(
      "POST",
      `/project/${env.project.id}`,
      body(),
      env.outsider.user,
    );

    expect(asReader.status).toBe(403);
    expect(asStranger.status).toBe(403);
    expect(requests).toEqual([]);
    expect(await integrationRows(env.project.id)).toEqual([]);
  });

  it("the controller itself answers 404 for a project that does not exist", async () => {
    await setup();

    await expect(
      createGitlabIntegration({
        projectId: "missing",
        baseUrl: BASE_URL,
        accessToken: TOKEN,
        tokenType: "private",
        projectPath: "group/project",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("PATCH /gitlab-integration/project/:projectId", () => {
  it("turns the integration off and the back-link comment off, keeping the rest", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);

    const response = await env.call("PATCH", `/project/${env.project.id}`, {
      isActive: false,
      commentTaskLinkOnGitlabIssue: false,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      isActive: false,
      commentTaskLinkOnGitlabIssue: false,
      webhookSecret: "stored-secret",
    });
    const [row] = await integrationRows(env.project.id);
    expect(row.isActive).toBe(false);
    expect(JSON.parse(row.config)).toMatchObject({
      accessToken: TOKEN,
      commentTaskLinkOnGitlabIssue: false,
    });
  });

  it("keeps every field that the body omits", async () => {
    const env = await setup();
    await storeIntegration(
      env.project.id,
      { commentTaskLinkOnGitlabIssue: false },
      false,
    );

    const response = await env.call("PATCH", `/project/${env.project.id}`, {});

    expect(response.status).toBe(200);
    const [row] = await integrationRows(env.project.id);
    expect(row.isActive).toBe(false);
    expect(JSON.parse(row.config).commentTaskLinkOnGitlabIssue).toBe(false);
  });

  it("answers 404 when there is no integration", async () => {
    const env = await setup();

    const response = await env.call("PATCH", `/project/${env.project.id}`, {
      isActive: false,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Integration not found" });
  });

  it("answers 500 for a stored config that is not JSON and 400 for one that fails validation", async () => {
    const env = await setup();
    const [row] = [
      await db
        .insert(schema.integrationTable)
        .values({
          projectId: env.project.id,
          type: "gitlab",
          config: "{broken",
        })
        .returning(),
    ].flat();

    const broken = await env.call("PATCH", `/project/${env.project.id}`, {
      isActive: false,
    });
    expect(broken.status).toBe(500);

    await db
      .update(schema.integrationTable)
      .set({ config: JSON.stringify({ baseUrl: "not a url" }) })
      .where(eq(schema.integrationTable.id, row.id));
    const invalid = await env.call("PATCH", `/project/${env.project.id}`, {
      isActive: false,
    });
    expect(invalid.status).toBe(400);
    expect((await integrationRows(env.project.id))[0].isActive).toBe(true);
  });

  it("refuses a member without manage_settings and changes nothing", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);

    const response = await env.call(
      "PATCH",
      `/project/${env.project.id}`,
      { isActive: false },
      env.reader,
    );

    expect(response.status).toBe(403);
    expect((await integrationRows(env.project.id))[0].isActive).toBe(true);
  });
});

describe("DELETE /gitlab-integration/project/:projectId", () => {
  it("removes the integration of that project only", async () => {
    const env = await setup();
    const other = await createProjectFixture({
      workspaceId: env.owner.workspace.id,
    });
    await storeIntegration(env.project.id);
    await storeIntegration(other.project.id, { projectPath: "group/other" });

    const response = await env.call("DELETE", `/project/${env.project.id}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: "GitLab integration deleted",
    });
    expect(await integrationRows(env.project.id)).toEqual([]);
    expect(await integrationRows(other.project.id)).toHaveLength(1);
  });

  it("answers 404 when nothing is linked", async () => {
    const env = await setup();

    const response = await env.call("DELETE", `/project/${env.project.id}`);

    expect(response.status).toBe(404);
  });

  it("refuses a member without manage_settings and a stranger and deletes nothing", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);

    expect(
      (
        await env.call(
          "DELETE",
          `/project/${env.project.id}`,
          undefined,
          env.reader,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await env.call(
          "DELETE",
          `/project/${env.project.id}`,
          undefined,
          env.outsider.user,
        )
      ).status,
    ).toBe(403);
    expect(await integrationRows(env.project.id)).toHaveLength(1);
  });
});

describe("POST /gitlab-integration/import-issues", () => {
  const issue = (iid: number, extra: Record<string, unknown> = {}) => ({
    id: 1000 + iid,
    iid,
    title: `Issue ${iid}`,
    description: `Body ${iid}`,
    web_url: `${BASE_URL}/group/project/-/issues/${iid}`,
    state: "opened",
    labels: [],
    author: { username: "ann" },
    ...extra,
  });

  function issuesRoutes(
    pages: unknown[][],
    notes: Record<number, unknown[]> = {},
    mrs: unknown[] = [],
  ): Route[] {
    return [
      [
        "GET",
        /^\/projects\/group\/project\/issues\?.*page=(\d+)$/,
        (url) => {
          const page = Number(url.searchParams.get("page"));
          return json(pages[page - 1] ?? []);
        },
      ],
      [
        "GET",
        /^\/projects\/group\/project\/issues\/(\d+)\/notes\?/,
        (url) => {
          const iid = Number(url.pathname.match(/issues\/(\d+)\/notes/)?.[1]);
          const page = Number(url.searchParams.get("page"));
          return json(page === 1 ? (notes[iid] ?? []) : []);
        },
      ],
      [
        "GET",
        /^\/projects\/group\/project\/merge_requests\?/,
        (url) => json(Number(url.searchParams.get("page")) === 1 ? mrs : []),
      ],
    ];
  }

  const importIssues = (env: Env, as?: { id: string }) =>
    env.call("POST", "/import-issues", { projectId: env.project.id }, as);

  async function tasksOf(env: Env) {
    return db.query.taskTable.findMany({
      where: eq(schema.taskTable.projectId, env.project.id),
      orderBy: schema.taskTable.number,
    });
  }

  it("imports open issues as tasks with labels, priority, status, notes and a link", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);
    stubGitlab(
      issuesRoutes(
        [
          [
            issue(1, {
              labels: ["bug", "priority:high", "status:in-progress", "ui"],
              description: "Steps\n\n---\n<sub>Task: abc</sub>",
            }),
            issue(2, { description: null }),
          ],
        ],
        {
          1: [
            {
              id: 11,
              body: "first note",
              system: false,
              author: { username: "bob", avatar_url: "https://a/b.png" },
              created_at: "2026-01-01T00:00:00Z",
            },
            {
              id: 12,
              body: "label added",
              system: true,
              created_at: "2026-01-01T00:00:00Z",
            },
            {
              id: 13,
              body: "private",
              system: false,
              internal: true,
              created_at: "2026-01-01T00:00:00Z",
            },
            {
              id: 14,
              body: "anonymous",
              system: false,
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
        },
      ),
    );

    const response = await importIssues(env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      imported: 2,
      updated: 0,
      skipped: 0,
    });
    const tasks = await tasksOf(env);
    expect(
      tasks.map((t) => [
        t.number,
        t.title,
        t.description,
        t.status,
        t.priority,
      ]),
    ).toEqual([
      [1, "Issue 1", "Steps", "in-progress", "high"],
      [2, "Issue 2", "", "to-do", "low"],
    ]);
    const labels = await db.query.labelTable.findMany({
      where: eq(schema.labelTable.taskId, tasks[0].id),
    });
    expect(labels.map((l) => l.name).sort()).toEqual(["bug", "ui"]);
    expect(labels.every((l) => l.workspaceId === env.owner.workspace.id)).toBe(
      true,
    );
    const links = await db.query.externalLinkTable.findMany({
      where: eq(schema.externalLinkTable.taskId, tasks[0].id),
    });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      resourceType: "issue",
      externalId: "1",
      url: `${BASE_URL}/group/project/-/issues/1`,
    });
    expect(JSON.parse(links[0].metadata ?? "{}")).toMatchObject({
      state: "opened",
      createdFrom: "gitlab-import",
      author: "ann",
    });
    const comments = await db.query.activityTable.findMany({
      where: eq(schema.activityTable.taskId, tasks[0].id),
    });
    expect(
      comments
        .map((c) => [
          c.content,
          c.externalUserName,
          c.externalUserAvatar,
          c.externalUrl,
        ])
        .sort(),
    ).toEqual([
      [
        "anonymous",
        "Unknown",
        null,
        `${BASE_URL}/group/project/-/issues/1#note_14`,
      ],
      [
        "first note",
        "bob",
        "https://a/b.png",
        `${BASE_URL}/group/project/-/issues/1#note_11`,
      ],
    ]);
  });

  it("is idempotent: a second run refreshes the tasks without duplicating anything", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);
    const notes = {
      1: [
        {
          id: 11,
          body: "note",
          system: false,
          author: { username: "bob" },
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    };
    stubGitlab(issuesRoutes([[issue(1, { labels: ["bug"] })]], notes));
    await importIssues(env);

    stubGitlab(
      issuesRoutes(
        [
          [
            issue(1, {
              title: "Renamed",
              description: "New body",
              labels: ["bug", "priority:urgent", "status:to-do"],
            }),
          ],
        ],
        notes,
      ),
    );
    const response = await importIssues(env);

    expect(await response.json()).toEqual({
      imported: 0,
      updated: 1,
      skipped: 0,
    });
    const tasks = await tasksOf(env);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: "Renamed",
      description: "New body",
      priority: "urgent",
      status: "to-do",
    });
    expect(await db.select().from(schema.externalLinkTable)).toHaveLength(1);
    expect(
      await db.query.labelTable.findMany({
        where: eq(schema.labelTable.taskId, tasks[0].id),
      }),
    ).toHaveLength(1);
    expect(
      await db.query.activityTable.findMany({
        where: eq(schema.activityTable.taskId, tasks[0].id),
      }),
    ).toHaveLength(1);
  });

  it("reuses the color of an existing workspace label for a new task label", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);
    await db.insert(schema.labelTable).values({
      name: "bug",
      color: "#EF4444",
      workspaceId: env.owner.workspace.id,
    });
    stubGitlab(issuesRoutes([[issue(1, { labels: ["bug", "fresh"] })]]));

    await importIssues(env);

    const [task] = await tasksOf(env);
    const labels = await db.query.labelTable.findMany({
      where: eq(schema.labelTable.taskId, task.id),
    });
    expect(Object.fromEntries(labels.map((l) => [l.name, l.color]))).toEqual({
      bug: "#EF4444",
      fresh: "#6B7280",
    });
  });

  it("skips confidential issues and never fetches their notes", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);
    stubGitlab(issuesRoutes([[issue(1, { confidential: true }), issue(2)]]));

    const response = await importIssues(env);

    expect(await response.json()).toEqual({
      imported: 1,
      updated: 0,
      skipped: 0 + 1,
    });
    expect((await tasksOf(env)).map((t) => t.title)).toEqual(["Issue 2"]);
    expect(requests.some((r) => r.path.includes("/issues/1/notes"))).toBe(
      false,
    );
  });

  it("follows pagination: a full page of 100 issues triggers the next request", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);
    const first = Array.from({ length: 100 }, (_, i) =>
      issue(i + 1, { description: null }),
    );
    stubGitlab(issuesRoutes([first, [issue(101)]]));

    const response = await importIssues(env);

    expect(await response.json()).toEqual({
      imported: 101,
      updated: 0,
      skipped: 0,
    });
    expect(await tasksOf(env)).toHaveLength(101);
    expect(
      requests
        .filter((r) => /\/issues\?/.test(r.path))
        .map((r) => r.path.match(/[?&]page=(\d+)/)?.[1]),
    ).toEqual(["1", "2"]);
  });

  it("links open merge requests to the tasks their branch or title names", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);
    const mr = (iid: number, extra: Record<string, unknown>) => ({
      iid,
      title: `MR ${iid}`,
      description: null,
      web_url: `${BASE_URL}/group/project/-/merge_requests/${iid}`,
      state: "opened",
      source_branch: `topic-${iid}`,
      author: { username: "ann" },
      ...extra,
    });
    stubGitlab(
      issuesRoutes([[issue(1), issue(2)]], {}, [
        mr(21, { source_branch: "kan-1", draft: true }),
        mr(22, { title: "KAN-2 follow-up" }),
        mr(23, { source_branch: undefined, title: "KAN-1" }),
        mr(24, { source_branch: "unrelated" }),
        mr(25, { source_branch: "kan-99" }),
      ]),
    );

    const response = await importIssues(env);

    expect(response.status).toBe(200);
    const links = await db.query.externalLinkTable.findMany({
      where: eq(schema.externalLinkTable.resourceType, "pull_request"),
    });
    const tasks = await tasksOf(env);
    const byIid = Object.fromEntries(links.map((l) => [l.externalId, l]));
    expect(Object.keys(byIid).sort()).toEqual(["21", "22"]);
    expect(byIid["21"].taskId).toBe(tasks[0].id);
    expect(byIid["22"].taskId).toBe(tasks[1].id);
    expect(JSON.parse(byIid["21"].metadata ?? "{}")).toEqual({
      state: "opened",
      draft: true,
      merged: false,
      branch: "kan-1",
      author: "ann",
    });

    await importIssues(env);
    expect(
      await db.query.externalLinkTable.findMany({
        where: eq(schema.externalLinkTable.resourceType, "pull_request"),
      }),
    ).toHaveLength(2);
  });

  it("characterization: a notes failure is reported per issue but the task already exists", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);
    stubGitlab([
      [
        "GET",
        /\/issues\?/,
        (url) =>
          json(
            url.searchParams.get("page") === "1" ? [issue(1), issue(2)] : [],
          ),
      ],
      ["GET", /\/issues\/1\/notes\?/, () => json([])],
      ["GET", /\/issues\/2\/notes\?/, () => json({ message: "boom" }, 500)],
      ["GET", /\/merge_requests\?/, () => json([])],
    ]);

    const response = await importIssues(env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      imported: 1,
      updated: 0,
      skipped: 0,
      errors: ["Issue !2: GitLab API error 500"],
    });
    expect((await tasksOf(env)).map((t) => t.title)).toEqual([
      "Issue 1",
      "Issue 2",
    ]);
  });

  it("reports a failing merge request link per merge request", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);
    stubGitlab(
      issuesRoutes([[issue(1)]], {}, [
        {
          iid: null,
          title: "x",
          description: null,
          web_url: "u",
          state: "opened",
          source_branch: "kan-1",
        },
      ]),
    );

    const response = await importIssues(env);

    const result = await response.json();
    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^Merge request !null: /);
  });

  it("surfaces a GitLab failure while listing issues and imports nothing", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);
    stubGitlab([["GET", /\/issues\?/, () => json({}, 500)]]);

    const response = await importIssues(env);

    expect(response.status).toBe(500);
    expect(await tasksOf(env)).toEqual([]);
  });

  it("answers 404 when the project has no integration", async () => {
    const env = await setup();
    stubGitlab([]);

    const response = await importIssues(env);

    expect(response.status).toBe(404);
    expect(requests).toEqual([]);
  });

  it("answers 400 for a disabled integration, an unreadable config and a missing token", async () => {
    const env = await setup();
    const integration = await storeIntegration(env.project.id, {}, false);
    stubGitlab([]);

    const disabled = await importIssues(env);
    expect(disabled.status).toBe(400);
    expect(await disabled.text()).toContain("not active");

    await db
      .update(schema.integrationTable)
      .set({ isActive: true, config: "{broken" })
      .where(eq(schema.integrationTable.id, integration.id));
    const unreadable = await importIssues(env);
    expect(unreadable.status).toBe(400);
    expect(await unreadable.text()).toContain(
      "Invalid GitLab integration config",
    );

    await db
      .update(schema.integrationTable)
      .set({ config: JSON.stringify({ projectPath: "group/project" }) })
      .where(eq(schema.integrationTable.id, integration.id));
    const noToken = await importIssues(env);
    expect(noToken.status).toBe(400);
    expect(await noToken.text()).toContain(
      "access token or base URL not configured",
    );

    expect(requests).toEqual([]);
    expect(await tasksOf(env)).toEqual([]);
  });

  it("answers 404 for an unknown project and 400 without a projectId", async () => {
    const env = await setup();
    stubGitlab([]);

    const unknown = await env.call("POST", "/import-issues", {
      projectId: "missing",
    });
    const missing = await env.call("POST", "/import-issues", {});

    expect(unknown.status).toBe(404);
    expect(missing.status).toBe(400);
    expect(requests).toEqual([]);
  });

  it("refuses a user from another workspace before contacting GitLab", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);
    stubGitlab(issuesRoutes([[issue(1)]]));

    const response = await importIssues(env, env.outsider.user);

    expect(response.status).toBe(403);
    expect(requests).toEqual([]);
    expect(await tasksOf(env)).toEqual([]);
  });
});

describe("importGitlabIssues controller", () => {
  it("answers 404 for a project that does not exist", async () => {
    stubGitlab([]);

    await expect(importGitlabIssues("missing")).rejects.toMatchObject({
      status: 404,
    });
    expect(requests).toEqual([]);
  });

  it("reports a non-Error failure of one issue by its text and keeps importing", async () => {
    const env = await setup();
    await storeIntegration(env.project.id);
    const issue = (iid: number) => ({
      id: iid,
      iid,
      title: `Issue ${iid}`,
      description: null,
      web_url: `${BASE_URL}/group/project/-/issues/${iid}`,
      state: "opened",
    });
    stubGitlab([
      [
        "GET",
        /\/issues\?/,
        (url) =>
          json(
            url.searchParams.get("page") === "1" ? [issue(1), issue(2)] : [],
          ),
      ],
      [
        "GET",
        /\/issues\/1\/notes\?/,
        () => {
          throw "socket closed";
        },
      ],
      ["GET", /\/issues\/2\/notes\?/, () => json([])],
      ["GET", /\/merge_requests\?/, () => json([])],
    ]);

    const result = await importGitlabIssues(env.project.id);

    expect(result).toEqual({
      imported: 1,
      updated: 0,
      skipped: 0,
      errors: ["Issue !1: socket closed"],
    });
  });
});
