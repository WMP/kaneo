import { and, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const jira = vi.hoisted(() => ({
  myself: vi.fn(),
  listProjects: vi.fn(),
  listIssueTypes: vi.fn(),
  getCreateFields: vi.fn(),
  listStatuses: vi.fn(),
  listComponents: vi.fn(),
  searchUsers: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock(
  "../../apps/api/src/jira-integration/jira-client",
  async (importOriginal) => {
    jira.createClient.mockImplementation(() => jira);
    return {
      ...(await importOriginal<
        typeof import("../../apps/api/src/jira-integration/jira-client")
      >()),
      createJiraClient: jira.createClient,
    };
  },
);

const { JiraApiError } = await import(
  "../../apps/api/src/jira-integration/jira-client"
);

const BASE_URL = "https://jira.example.test";
const TOKEN_A = "test-pat-user-a-0123456789";
const TOKEN_B = "test-pat-user-b-9876543210";

const ENCRYPTION_KEY_ENV = "NOTIFICATION_SECRET_ENCRYPTION_KEY";
const PRIVATE_DESTINATIONS_ENV = "KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS";

const originalKey = process.env[ENCRYPTION_KEY_ENV];
const originalPrivate = process.env[PRIVATE_DESTINATIONS_ENV];

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
  jira.createClient.mockImplementation(() => jira);
  process.env[ENCRYPTION_KEY_ENV] = "jira-integration-test-encryption-key";
  delete process.env[PRIVATE_DESTINATIONS_ENV];
  jira.myself.mockResolvedValue({
    name: "alice",
    key: "alice",
    displayName: "Alice Example",
  });
  jira.listProjects.mockResolvedValue([
    { id: "10000", key: "PRJ", name: "Project", extra: "dropped" },
  ]);
});

afterEach(() => {
  restoreEnv(ENCRYPTION_KEY_ENV, originalKey);
  restoreEnv(PRIVATE_DESTINATIONS_ENV, originalPrivate);
});

afterAll(() => {
  restoreEnv(ENCRYPTION_KEY_ENV, originalKey);
  restoreEnv(PRIVATE_DESTINATIONS_ENV, originalPrivate);
});

// biome-ignore lint/suspicious/noExplicitAny: response bodies are asserted field by field
type Body = any;

type User = Awaited<ReturnType<typeof createWorkspaceMember>>["user"];

// A workspace with a manager (`admin`, holds workspace:manage_settings), a
// plain `member`, custom-role members for the project routes, a member of
// another workspace, and one project everybody in the workspace belongs to.
async function setup() {
  const manager = await createWorkspaceMember({ role: "admin" });
  const workspaceId = manager.workspace.id;

  await db.insert(schema.workspaceRoleTable).values([
    {
      workspaceId,
      role: "jira-reader",
      permission: JSON.stringify({ project: ["read"] }),
    },
    {
      workspaceId,
      role: "jira-editor",
      permission: JSON.stringify({ project: ["read", "update"] }),
    },
  ]);
  const plain = await addWorkspaceMember(workspaceId, "member");
  const reader = await addWorkspaceMember(workspaceId, "jira-reader");
  const editor = await addWorkspaceMember(workspaceId, "jira-editor");
  const outsider = await createWorkspaceMember({ role: "owner" });

  const { project, columns } = await createProjectFixture({ workspaceId });
  // Created after the project: no project row, so no project access.
  const noProjectAccess = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(project.id, noProjectAccess.id, "member");
  await db
    .delete(schema.projectMemberTable)
    .where(
      and(
        eq(schema.projectMemberTable.projectId, project.id),
        eq(schema.projectMemberTable.userId, noProjectAccess.id),
      ),
    );

  const { app } = createApp();

  const as = (user: User) => mockAuthenticatedSession(user);
  const call = async (
    user: User,
    method: string,
    path: string,
    body?: unknown,
  ) => {
    as(user);
    const response = await app.request(`/api/jira-integration${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // plain-text error from the access middleware
    }
    return { status: response.status, text, json: json as Body };
  };

  const connect = () =>
    call(manager.user, "PUT", `/workspace/${workspaceId}/connection`, {
      baseUrl: BASE_URL,
      deployment: "server",
    });

  return {
    app,
    call,
    connect,
    workspaceId,
    project,
    columns,
    manager: manager.user,
    plain,
    reader,
    editor,
    outsider: outsider.user,
    noProjectAccess,
    otherWorkspaceId: outsider.workspace.id,
  };
}

const ws = (id: string) => `/workspace/${id}`;

describe("Jira integration: workspace boundary", () => {
  it("answers 403 to a member of another workspace on every settings route", async () => {
    const s = await setup();
    await s.connect();
    await s.call(s.manager, "PUT", `${ws(s.workspaceId)}/me/token`, {
      token: TOKEN_A,
    });
    jira.myself.mockClear();
    jira.createClient.mockClear();

    const w = ws(s.workspaceId);
    const p = `/project/${s.project.id}`;
    const routes: [string, string, unknown?][] = [
      ["GET", `${w}/connection`],
      ["PUT", `${w}/connection`, { baseUrl: BASE_URL, deployment: "server" }],
      ["POST", `${w}/connection/rotate-webhook-secret`],
      ["DELETE", `${w}/connection`],
      ["GET", `${w}/mapping`],
      ["PUT", `${w}/mapping`, { config: {} }],
      ["GET", `${p}/mapping`],
      ["PUT", `${p}/mapping`, { config: {} }],
      ["GET", `${p}/resolved-mapping`],
      ["GET", `${w}/me/token`],
      ["PUT", `${w}/me/token`, { token: "test-pat-outsider" }],
      ["DELETE", `${w}/me/token`],
      ["GET", `${w}/me/mapping`],
      ["PUT", `${w}/me/mapping`, { config: {} }],
      ["GET", `${w}/meta/projects`],
      ["GET", `${w}/meta/issue-types?projectKey=PRJ`],
      ["GET", `${w}/meta/fields?projectKey=PRJ&issueTypeId=1`],
      ["GET", `${w}/meta/statuses?projectKey=PRJ`],
      ["GET", `${w}/meta/components?projectKey=PRJ`],
      ["GET", `${w}/meta/users?query=a`],
    ];

    for (const [method, path, body] of routes) {
      const response = await s.call(s.outsider, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(403);
    }

    // Nothing was reached: no Jira client was even created.
    expect(jira.createClient).not.toHaveBeenCalled();
    expect(jira.myself).not.toHaveBeenCalled();
    // And nothing changed.
    expect(await db.select().from(schema.jiraConnectionTable)).toHaveLength(1);
    expect(await db.select().from(schema.jiraUserTokenTable)).toHaveLength(1);
  });

  it("does not let a workspace member without access to the project read or write its mapping", async () => {
    const s = await setup();
    const p = `/project/${s.project.id}`;

    expect(
      (await s.call(s.noProjectAccess, "GET", `${p}/mapping`)).status,
    ).toBe(403);
    expect(
      (await s.call(s.noProjectAccess, "PUT", `${p}/mapping`, { config: {} }))
        .status,
    ).toBe(403);
    expect(
      (await s.call(s.noProjectAccess, "GET", `${p}/resolved-mapping`)).status,
    ).toBe(403);
  });
});

describe("Jira integration: connection", () => {
  it("lets a plain member read the connection without its webhook secret but not change it", async () => {
    const s = await setup();
    const created = await s.connect();
    expect(created.status).toBe(200);

    const w = ws(s.workspaceId);
    const read = await s.call(s.plain, "GET", `${w}/connection`);
    expect(read.status).toBe(200);
    expect(read.json).toMatchObject({
      baseUrl: BASE_URL,
      deployment: "server",
      isActive: true,
    });
    expect(read.json).not.toHaveProperty("webhookSecret");
    expect(read.json).not.toHaveProperty("webhookUrl");
    expect(read.text).not.toContain(created.json.webhookSecret);

    const write = await s.call(s.plain, "PUT", `${w}/connection`, {
      baseUrl: "https://other.example.test",
      deployment: "server",
    });
    expect(write.status).toBe(403);
    expect(
      (await s.call(s.plain, "POST", `${w}/connection/rotate-webhook-secret`))
        .status,
    ).toBe(403);
    expect((await s.call(s.plain, "DELETE", `${w}/connection`)).status).toBe(
      403,
    );

    const [row] = await db.select().from(schema.jiraConnectionTable);
    expect(row?.baseUrl).toBe(BASE_URL);
  });

  it("shows the webhook URL and secret to a manager, and rotates the secret", async () => {
    const s = await setup();
    const created = await s.connect();
    expect(created.status).toBe(200);
    const { id, webhookSecret, webhookUrl } = created.json;

    expect(webhookSecret).toMatch(/^[0-9a-f]{48}$/);
    expect(webhookUrl).toBe(
      `http://localhost:1337/api/jira-integration/webhook/${id}?secret=${webhookSecret}`,
    );

    const w = ws(s.workspaceId);
    const read = await s.call(s.manager, "GET", `${w}/connection`);
    expect(read.json).toMatchObject({ webhookSecret, webhookUrl });

    const rotated = await s.call(
      s.manager,
      "POST",
      `${w}/connection/rotate-webhook-secret`,
    );
    expect(rotated.status).toBe(200);
    expect(rotated.json.webhookSecret).not.toBe(webhookSecret);
    expect(rotated.json.webhookUrl).toContain(rotated.json.webhookSecret);
  });

  it("returns null when no connection exists", async () => {
    const s = await setup();
    const read = await s.call(
      s.plain,
      "GET",
      `${ws(s.workspaceId)}/connection`,
    );
    expect(read.status).toBe(200);
    expect(read.json).toBeNull();
  });

  it("normalizes the base URL and refuses unsafe ones", async () => {
    const s = await setup();
    const w = `${ws(s.workspaceId)}/connection`;

    const ok = await s.call(s.manager, "PUT", w, {
      baseUrl: "https://jira.example.test/jira///",
      deployment: "server",
    });
    expect(ok.status).toBe(200);
    expect(ok.json.baseUrl).toBe("https://jira.example.test/jira");

    for (const baseUrl of [
      "http://jira.example.test",
      "https://user:secret@jira.example.test",
      "https://jira.example.test/?x=1",
      "https://jira.example.test/#frag",
      "ftp://jira.example.test",
      "https://127.0.0.1",
      "not a url",
    ]) {
      const response = await s.call(s.manager, "PUT", w, {
        baseUrl,
        deployment: "server",
      });
      expect(response.status, baseUrl).toBe(400);
    }

    // The private-network rule is the same switch GitLab and Gitea use.
    process.env[PRIVATE_DESTINATIONS_ENV] = "true";
    const http = await s.call(s.manager, "PUT", w, {
      baseUrl: "http://jira.internal.test:8080",
      deployment: "server",
    });
    expect(http.status).toBe(200);
    expect(http.json.baseUrl).toBe("http://jira.internal.test:8080");
  });

  it("drops every stored token when the target changes, and keeps them otherwise", async () => {
    const s = await setup();
    await s.connect();
    const w = ws(s.workspaceId);
    await s.call(s.plain, "PUT", `${w}/me/token`, { token: TOKEN_A });
    expect(await db.select().from(schema.jiraUserTokenTable)).toHaveLength(1);

    const sameTarget = await s.call(s.manager, "PUT", `${w}/connection`, {
      baseUrl: `${BASE_URL}/`,
      deployment: "server",
      pollingEnabled: false,
    });
    expect(sameTarget.json.pollingEnabled).toBe(false);
    expect(await db.select().from(schema.jiraUserTokenTable)).toHaveLength(1);

    await s.call(s.manager, "PUT", `${w}/connection`, {
      baseUrl: "https://elsewhere.example.test",
      deployment: "server",
    });
    expect(await db.select().from(schema.jiraUserTokenTable)).toHaveLength(0);
  });

  it("deletes the connection with its tokens, but keeps mappings", async () => {
    const s = await setup();
    await s.connect();
    const w = ws(s.workspaceId);
    await s.call(s.plain, "PUT", `${w}/me/token`, { token: TOKEN_A });
    await s.call(s.manager, "PUT", `${w}/mapping`, {
      config: { jiraProjectKey: "PRJ" },
    });

    const removed = await s.call(s.manager, "DELETE", `${w}/connection`);
    expect(removed.status).toBe(200);
    expect(await db.select().from(schema.jiraConnectionTable)).toHaveLength(0);
    expect(await db.select().from(schema.jiraUserTokenTable)).toHaveLength(0);
    expect(await db.select().from(schema.jiraMappingTable)).toHaveLength(1);

    const again = await s.call(s.manager, "DELETE", `${w}/connection`);
    expect(again.status).toBe(404);
    expect(again.json.code).toBe("JIRA_NOT_CONFIGURED");
  });
});

describe("Jira integration: tokens", () => {
  it("verifies the token with myself(), stores it encrypted and never returns it", async () => {
    const s = await setup();
    await s.connect();
    const w = ws(s.workspaceId);

    const put = await s.call(s.plain, "PUT", `${w}/me/token`, {
      token: TOKEN_A,
    });
    expect(put.status).toBe(200);
    expect(put.json).toMatchObject({
      connected: true,
      jiraUsername: "alice",
      jiraDisplayName: "Alice Example",
      lastError: null,
    });
    expect(put.json.lastVerifiedAt).toEqual(expect.any(String));
    expect(jira.myself).toHaveBeenCalledTimes(1);
    expect(jira.createClient).toHaveBeenCalledWith(
      expect.objectContaining({ token: TOKEN_A, deployment: "server" }),
    );

    const responses = [
      put,
      await s.call(s.plain, "GET", `${w}/me/token`),
      await s.call(s.plain, "GET", `${w}/connection`),
      await s.call(s.manager, "GET", `${w}/connection`),
      await s.call(s.plain, "GET", `${w}/me/mapping`),
    ];
    for (const response of responses) {
      expect(JSON.stringify(response.json)).not.toContain(TOKEN_A);
      expect(response.text).not.toContain(TOKEN_A);
    }

    const rows = await db.select().from(schema.jiraUserTokenTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.encryptedToken.startsWith("enc:v1:")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(TOKEN_A);
  });

  it("answers 503 JIRA_ENCRYPTION_KEY_MISSING and stores nothing without the key", async () => {
    const s = await setup();
    await s.connect();
    delete process.env[ENCRYPTION_KEY_ENV];

    const put = await s.call(s.plain, "PUT", `${ws(s.workspaceId)}/me/token`, {
      token: TOKEN_A,
    });

    expect(put.status).toBe(503);
    expect(put.json).toMatchObject({ code: "JIRA_ENCRYPTION_KEY_MISSING" });
    expect(put.text).not.toContain(TOKEN_A);
    expect(jira.myself).not.toHaveBeenCalled();
    expect(await db.select().from(schema.jiraUserTokenTable)).toHaveLength(0);
  });

  it("does not store a token Jira rejects, and answers 422 rather than 401", async () => {
    const s = await setup();
    await s.connect();
    jira.myself.mockRejectedValue(
      new JiraApiError("Jira API error 401", 401, "HTTP_ERROR"),
    );

    const put = await s.call(s.plain, "PUT", `${ws(s.workspaceId)}/me/token`, {
      token: TOKEN_A,
    });

    expect(put.status).toBe(422);
    expect(put.json).toMatchObject({ code: "JIRA_TOKEN_INVALID" });
    expect(put.text).not.toContain(TOKEN_A);
    expect(await db.select().from(schema.jiraUserTokenTable)).toHaveLength(0);
  });

  it("reports a Jira failure with its messages and no token", async () => {
    const s = await setup();
    await s.connect();
    jira.myself.mockRejectedValue(
      new JiraApiError(
        "Jira API error 500: Boom",
        500,
        "HTTP_ERROR",
        ["Boom"],
        {
          field: "bad",
        },
      ),
    );

    const put = await s.call(s.plain, "PUT", `${ws(s.workspaceId)}/me/token`, {
      token: TOKEN_A,
    });

    expect(put.status).toBe(502);
    expect(put.json).toMatchObject({
      code: "JIRA_REQUEST_FAILED",
      jiraStatus: 500,
      errorMessages: ["Boom"],
      errors: { field: "bad" },
    });
    expect(put.text).not.toContain(TOKEN_A);
  });

  it("needs the Atlassian email for Jira Cloud and stores it with the token", async () => {
    const s = await setup();
    const w = ws(s.workspaceId);
    await s.call(s.manager, "PUT", `${w}/connection`, {
      baseUrl: BASE_URL,
      deployment: "cloud",
    });

    const missing = await s.call(s.plain, "PUT", `${w}/me/token`, {
      token: TOKEN_A,
    });
    expect(missing.status).toBe(400);
    expect(jira.myself).not.toHaveBeenCalled();

    jira.myself.mockResolvedValue({ accountId: "acc-1", displayName: "Alice" });
    const ok = await s.call(s.plain, "PUT", `${w}/me/token`, {
      token: TOKEN_A,
      email: "alice@example.test",
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({
      jiraAccountId: "acc-1",
      email: "alice@example.test",
    });
    expect(jira.createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        deployment: "cloud",
        email: "alice@example.test",
      }),
    );
  });

  it("needs a connection before a token can be set", async () => {
    const s = await setup();
    const put = await s.call(s.plain, "PUT", `${ws(s.workspaceId)}/me/token`, {
      token: TOKEN_A,
    });
    expect(put.status).toBe(404);
    expect(put.json.code).toBe("JIRA_NOT_CONFIGURED");
  });

  it("keeps every user's token to themselves", async () => {
    const s = await setup();
    await s.connect();
    const w = ws(s.workspaceId);

    jira.myself.mockResolvedValue({ name: "alice", displayName: "Alice" });
    await s.call(s.plain, "PUT", `${w}/me/token`, { token: TOKEN_A });
    jira.myself.mockResolvedValue({ name: "bob", displayName: "Bob" });
    await s.call(s.reader, "PUT", `${w}/me/token`, { token: TOKEN_B });

    // Each one only sees their own identity; no route reaches another's token.
    const a = await s.call(s.plain, "GET", `${w}/me/token`);
    const b = await s.call(s.reader, "GET", `${w}/me/token`);
    const editorView = await s.call(s.editor, "GET", `${w}/me/token`);
    expect(a.json).toMatchObject({ connected: true, jiraUsername: "alice" });
    expect(b.json).toMatchObject({ connected: true, jiraUsername: "bob" });
    expect(editorView.json).toMatchObject({
      connected: false,
      jiraUsername: null,
    });
    for (const view of [a, b, editorView]) {
      expect(view.text).not.toContain(TOKEN_A);
      expect(view.text).not.toContain(TOKEN_B);
    }

    // Requests made for a user carry that user's token.
    jira.createClient.mockClear();
    await s.call(s.plain, "GET", `${w}/meta/projects`);
    await s.call(s.reader, "GET", `${w}/meta/projects`);
    expect(
      jira.createClient.mock.calls.map(([config]) => config.token),
    ).toEqual([TOKEN_A, TOKEN_B]);

    // Deleting removes only the caller's own token.
    const removed = await s.call(s.plain, "DELETE", `${w}/me/token`);
    expect(removed.status).toBe(200);
    expect((await s.call(s.plain, "GET", `${w}/me/token`)).json.connected).toBe(
      false,
    );
    expect(
      (await s.call(s.reader, "GET", `${w}/me/token`)).json.connected,
    ).toBe(true);
    expect(await db.select().from(schema.jiraUserTokenTable)).toHaveLength(1);
  });

  it("replaces the token of the same user instead of adding a second row", async () => {
    const s = await setup();
    await s.connect();
    const w = ws(s.workspaceId);

    await s.call(s.plain, "PUT", `${w}/me/token`, { token: TOKEN_A });
    await s.call(s.plain, "PUT", `${w}/me/token`, { token: TOKEN_B });

    const rows = await db.select().from(schema.jiraUserTokenTable);
    expect(rows).toHaveLength(1);
    jira.createClient.mockClear();
    await s.call(s.plain, "GET", `${w}/meta/projects`);
    expect(jira.createClient.mock.calls[0]?.[0].token).toBe(TOKEN_B);
  });
});

describe("Jira integration: metadata routes", () => {
  it("needs a connection, then a token of the caller", async () => {
    const s = await setup();
    const w = ws(s.workspaceId);

    const noConnection = await s.call(s.plain, "GET", `${w}/meta/projects`);
    expect(noConnection.status).toBe(404);
    expect(noConnection.json.code).toBe("JIRA_NOT_CONFIGURED");

    await s.connect();
    const noToken = await s.call(s.plain, "GET", `${w}/meta/projects`);
    expect(noToken.status).toBe(409);
    expect(noToken.json.code).toBe("JIRA_TOKEN_MISSING");
    expect(jira.listProjects).not.toHaveBeenCalled();

    await s.call(s.manager, "PUT", `${w}/connection`, {
      baseUrl: BASE_URL,
      deployment: "server",
      isActive: false,
    });
    const inactive = await s.call(s.plain, "GET", `${w}/meta/projects`);
    expect(inactive.status).toBe(404);
  });

  it("returns shaped Jira metadata read with the caller's token", async () => {
    const s = await setup();
    await s.connect();
    const w = ws(s.workspaceId);
    await s.call(s.plain, "PUT", `${w}/me/token`, { token: TOKEN_A });

    jira.listIssueTypes.mockResolvedValue([
      { id: "1", name: "Bug", subtask: false, description: "dropped" },
    ]);
    jira.getCreateFields.mockResolvedValue([
      {
        fieldId: "customfield_1",
        name: "Team",
        required: true,
        hasDefaultValue: false,
        schema: { type: "option", custom: "select", customId: 1 },
        allowedValues: [{ id: "5", value: "A", self: "dropped" }],
      },
    ]);
    jira.listStatuses.mockResolvedValue([
      {
        id: "1",
        name: "Bug",
        statuses: [
          {
            id: "3",
            name: "In Progress",
            statusCategory: { key: "indeterminate" },
          },
          { id: "4", name: "Done", statusCategory: { key: "done" } },
        ],
      },
      {
        id: "2",
        name: "Task",
        statuses: [{ id: "3", name: "In Progress" }],
      },
    ]);
    jira.listComponents.mockResolvedValue([{ id: "9", name: "Backend" }]);
    jira.searchUsers.mockResolvedValue([
      { name: "bob", displayName: "Bob", emailAddress: "bob@example.test" },
      { name: "gone", displayName: "Gone", active: false },
    ]);

    expect((await s.call(s.plain, "GET", `${w}/meta/projects`)).json).toEqual({
      projects: [{ id: "10000", key: "PRJ", name: "Project" }],
    });
    expect(
      (await s.call(s.plain, "GET", `${w}/meta/issue-types?projectKey=PRJ`))
        .json,
    ).toEqual({ issueTypes: [{ id: "1", name: "Bug", subtask: false }] });
    expect(
      (
        await s.call(
          s.plain,
          "GET",
          `${w}/meta/fields?projectKey=PRJ&issueTypeId=1`,
        )
      ).json,
    ).toEqual({
      fields: [
        {
          fieldId: "customfield_1",
          name: "Team",
          required: true,
          hasDefaultValue: false,
          schema: { type: "option", custom: "select" },
          allowedValues: [{ id: "5", value: "A" }],
        },
      ],
    });
    expect(jira.getCreateFields).toHaveBeenCalledWith("PRJ", "1");
    expect(
      (await s.call(s.plain, "GET", `${w}/meta/statuses?projectKey=PRJ`)).json,
    ).toEqual({
      statuses: [
        { id: "3", name: "In Progress", category: "indeterminate" },
        { id: "4", name: "Done", category: "done" },
      ],
    });
    expect(
      (await s.call(s.plain, "GET", `${w}/meta/components?projectKey=PRJ`))
        .json,
    ).toEqual({ components: [{ id: "9", name: "Backend" }] });
    expect(
      (await s.call(s.plain, "GET", `${w}/meta/users?query=bo&projectKey=PRJ`))
        .json,
    ).toEqual({
      users: [
        {
          name: "bob",
          accountId: null,
          displayName: "Bob",
          emailAddress: "bob@example.test",
        },
      ],
    });
    expect(jira.searchUsers).toHaveBeenCalledWith("bo", "PRJ");

    // A missing query parameter is a 400, not a Jira call.
    expect((await s.call(s.plain, "GET", `${w}/meta/statuses`)).status).toBe(
      400,
    );
  });

  it("maps Jira failures on metadata reads", async () => {
    const s = await setup();
    await s.connect();
    const w = ws(s.workspaceId);
    await s.call(s.plain, "PUT", `${w}/me/token`, { token: TOKEN_A });

    jira.listProjects.mockRejectedValueOnce(
      new JiraApiError("Jira API error 401", 401, "HTTP_ERROR"),
    );
    const rejected = await s.call(s.plain, "GET", `${w}/meta/projects`);
    expect(rejected.status).toBe(422);
    expect(rejected.json.code).toBe("JIRA_TOKEN_INVALID");

    jira.listProjects.mockRejectedValueOnce(
      new JiraApiError("Jira request failed", 502, "NETWORK"),
    );
    const failed = await s.call(s.plain, "GET", `${w}/meta/projects`);
    expect(failed.status).toBe(502);
    expect(failed.json.code).toBe("JIRA_REQUEST_FAILED");
    expect(failed.text).not.toContain(TOKEN_A);
  });
});

describe("Jira integration: mappings", () => {
  it("lets only a manager write the workspace mapping, and any member read it", async () => {
    const s = await setup();
    const w = `${ws(s.workspaceId)}/mapping`;
    const config = {
      jiraProjectKey: "PRJ",
      fieldMappings: [
        {
          target: { fieldId: "duedate", type: "date" },
          source: { kind: "none" },
          disabled: true,
        },
      ],
    };

    expect((await s.call(s.plain, "PUT", w, { config })).status).toBe(403);
    expect((await s.call(s.editor, "PUT", w, { config })).status).toBe(403);
    expect(await db.select().from(schema.jiraMappingTable)).toHaveLength(0);

    const saved = await s.call(s.manager, "PUT", w, { config });
    expect(saved.status).toBe(200);
    expect(saved.json.config).toEqual(config);

    const read = await s.call(s.plain, "GET", w);
    expect(read.status).toBe(200);
    expect(read.json.config).toEqual(config);
    // `parent` is the built-in default level.
    expect(read.json.parent.fieldMappings).toHaveLength(6);
    expect(
      read.json.parent.fieldMappings.every((f: Body) => f.origin === "default"),
    ).toBe(true);
    expect(read.json.updatedAt).toEqual(expect.any(String));

    // Saving again replaces the row instead of adding one.
    await s.call(s.manager, "PUT", w, { config: { jiraProjectKey: "OTHER" } });
    const rows = await db.select().from(schema.jiraMappingTable);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.config ?? "{}")).toEqual({
      jiraProjectKey: "OTHER",
    });
  });

  it("returns an empty config for a level nobody has saved", async () => {
    const s = await setup();
    const read = await s.call(s.plain, "GET", `${ws(s.workspaceId)}/mapping`);
    expect(read.json).toMatchObject({ config: {}, updatedAt: null });
  });

  it("rejects a malformed mapping with 400", async () => {
    const s = await setup();
    const w = `${ws(s.workspaceId)}/mapping`;
    for (const config of [
      { unknownKey: 1 },
      {
        fieldMappings: [
          { target: { fieldId: "x", type: "nope" }, source: { kind: "none" } },
        ],
      },
      {
        fieldMappings: [
          {
            target: { fieldId: "x", type: "string" },
            source: { kind: "builtin", field: "nope" },
          },
        ],
      },
      { statusMappings: [{ jiraStatusName: "Done", kaneoStatus: "" }] },
    ]) {
      const response = await s.call(s.manager, "PUT", w, { config });
      expect(response.status, JSON.stringify(config)).toBe(400);
    }
  });

  it("checks custom field ids against the workspace's fields", async () => {
    const s = await setup();
    const w = `${ws(s.workspaceId)}/mapping`;
    const [workspaceField] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({
        workspaceId: s.workspaceId,
        name: "Workspace field",
        type: "text",
      })
      .returning();
    const [projectField] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({ projectId: s.project.id, name: "Project field", type: "text" })
      .returning();
    const [foreignField] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({
        workspaceId: s.otherWorkspaceId,
        name: "Foreign field",
        type: "text",
      })
      .returning();
    const withField = (customFieldId: string) => ({
      config: {
        fieldMappings: [
          {
            target: { fieldId: "customfield_1", type: "string" },
            source: { kind: "custom", customFieldId },
          },
        ],
      },
    });

    expect(
      (await s.call(s.manager, "PUT", w, withField(workspaceField.id))).status,
    ).toBe(200);
    for (const id of ["does-not-exist", projectField.id, foreignField.id]) {
      const response = await s.call(s.manager, "PUT", w, withField(id));
      expect(response.status, id).toBe(400);
    }
  });

  it("accepts any non-empty Kaneo status at the workspace level", async () => {
    const s = await setup();
    const response = await s.call(
      s.manager,
      "PUT",
      `${ws(s.workspaceId)}/mapping`,
      {
        config: {
          statusMappings: [
            { jiraStatusName: "Done", kaneoStatus: "some-project-only-status" },
          ],
        },
      },
    );
    expect(response.status).toBe(200);
  });

  it("needs project:read to read and project:update to write the project mapping", async () => {
    const s = await setup();
    const p = `/project/${s.project.id}/mapping`;
    await s.call(s.manager, "PUT", `${ws(s.workspaceId)}/mapping`, {
      config: { jiraProjectKey: "WS", issueTypeId: "10001" },
    });
    const config = { jiraProjectKey: "PRJ", components: ["Backend"] };

    // A plain `member` reads but cannot write; a viewer-like custom role too.
    expect((await s.call(s.plain, "GET", p)).status).toBe(200);
    expect((await s.call(s.plain, "PUT", p, { config })).status).toBe(403);
    expect((await s.call(s.reader, "GET", p)).status).toBe(200);
    expect((await s.call(s.reader, "PUT", p, { config })).status).toBe(403);
    expect(
      await db
        .select()
        .from(schema.jiraMappingTable)
        .where(eq(schema.jiraMappingTable.scope, "project")),
    ).toHaveLength(0);

    const saved = await s.call(s.editor, "PUT", p, { config });
    expect(saved.status).toBe(200);
    expect(saved.json.config).toEqual(config);
    // `parent` carries the workspace level with its origin.
    expect(saved.json.parent.jiraProjectKey).toEqual({
      value: "WS",
      origin: "workspace",
    });
    expect(saved.json.parent.issueTypeId).toEqual({
      value: "10001",
      origin: "workspace",
    });

    const read = await s.call(s.reader, "GET", p);
    expect(read.json.config).toEqual(config);
    expect((await s.call(s.manager, "PUT", p, { config: {} })).status).toBe(
      200,
    );
  });

  it("validates project custom fields and Kaneo statuses against the project", async () => {
    const s = await setup();
    const p = `/project/${s.project.id}/mapping`;
    const [projectField] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({ projectId: s.project.id, name: "Project field", type: "text" })
      .returning();
    const [otherProject] = await db
      .insert(schema.projectTable)
      .values({
        workspaceId: s.workspaceId,
        name: "Other",
        slug: "other-project",
      })
      .returning();
    const [otherField] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({ projectId: otherProject.id, name: "Other field", type: "text" })
      .returning();
    const withField = (customFieldId: string) => ({
      config: {
        fieldMappings: [
          {
            target: { fieldId: "customfield_1", type: "string" },
            source: { kind: "custom", customFieldId },
          },
        ],
      },
    });

    expect(
      (await s.call(s.editor, "PUT", p, withField(projectField.id))).status,
    ).toBe(200);
    expect(
      (await s.call(s.editor, "PUT", p, withField(otherField.id))).status,
    ).toBe(400);
    expect(
      (await s.call(s.editor, "PUT", p, withField("missing"))).status,
    ).toBe(400);

    const withStatus = (kaneoStatus: string | null) => ({
      config: {
        statusMappings: [{ jiraStatusName: "Done", kaneoStatus }],
      },
    });
    expect((await s.call(s.editor, "PUT", p, withStatus("done"))).status).toBe(
      200,
    );
    expect((await s.call(s.editor, "PUT", p, withStatus(null))).status).toBe(
      200,
    );
    const invalid = await s.call(
      s.editor,
      "PUT",
      p,
      withStatus("not-a-status"),
    );
    expect(invalid.status).toBe(400);
    expect(invalid.text).toContain("not-a-status");
  });

  it("keeps each user's mapping separate and rejects status mappings at the user level", async () => {
    const s = await setup();
    const w = `${ws(s.workspaceId)}/me/mapping`;

    const rejected = await s.call(s.plain, "PUT", w, {
      config: {
        statusMappings: [{ jiraStatusName: "Done", kaneoStatus: "done" }],
      },
    });
    expect(rejected.status).toBe(400);
    expect(rejected.text).toContain("user level");
    expect(await db.select().from(schema.jiraMappingTable)).toHaveLength(0);

    // An empty list is harmless and accepted.
    expect(
      (await s.call(s.plain, "PUT", w, { config: { statusMappings: [] } }))
        .status,
    ).toBe(200);

    await s.call(s.plain, "PUT", w, { config: { jiraProjectKey: "MINE" } });
    await s.call(s.reader, "PUT", w, { config: { jiraProjectKey: "THEIRS" } });

    expect((await s.call(s.plain, "GET", w)).json.config).toEqual({
      jiraProjectKey: "MINE",
    });
    expect((await s.call(s.reader, "GET", w)).json.config).toEqual({
      jiraProjectKey: "THEIRS",
    });
    expect((await s.call(s.editor, "GET", w)).json.config).toEqual({});
  });

  it("validates a user's custom fields against fields they can reach", async () => {
    const s = await setup();
    const w = `${ws(s.workspaceId)}/me/mapping`;
    const [projectField] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({ projectId: s.project.id, name: "Project field", type: "text" })
      .returning();
    const withField = {
      config: {
        fieldMappings: [
          {
            target: { fieldId: "customfield_1", type: "string" },
            source: { kind: "custom", customFieldId: projectField.id },
          },
        ],
      },
    };

    // Member of the project: allowed. Workspace member outside it: not.
    expect((await s.call(s.plain, "PUT", w, withField)).status).toBe(200);
    expect((await s.call(s.noProjectAccess, "PUT", w, withField)).status).toBe(
      400,
    );
  });

  it("resolves the mapping for the caller, with origins and without user statuses", async () => {
    const s = await setup();
    await s.call(s.manager, "PUT", `${ws(s.workspaceId)}/mapping`, {
      config: {
        jiraProjectKey: "WS",
        statusMappings: [{ jiraStatusName: "Done", kaneoStatus: "done" }],
        fieldMappings: [
          {
            target: { fieldId: "duedate", type: "date" },
            source: { kind: "none" },
            disabled: true,
          },
        ],
      },
    });
    await s.call(s.editor, "PUT", `/project/${s.project.id}/mapping`, {
      config: { issueTypeId: "10001" },
    });
    await s.call(s.plain, "PUT", `${ws(s.workspaceId)}/me/mapping`, {
      config: { jiraProjectKey: "MINE" },
    });
    // A user-level status mapping planted directly must not be applied.
    await db
      .update(schema.jiraMappingTable)
      .set({
        config: JSON.stringify({
          jiraProjectKey: "MINE",
          statusMappings: [
            { jiraStatusName: "Done", kaneoStatus: "in-review" },
          ],
        }),
      })
      .where(eq(schema.jiraMappingTable.scope, "user"));

    const path = `/project/${s.project.id}/resolved-mapping`;
    const mine = await s.call(s.plain, "GET", path);
    expect(mine.status).toBe(200);
    const { mapping } = mine.json;
    expect(mapping.jiraProjectKey).toEqual({ value: "MINE", origin: "user" });
    expect(mapping.issueTypeId).toEqual({ value: "10001", origin: "project" });
    expect(mapping.statusMappings).toEqual([
      { jiraStatusName: "Done", kaneoStatus: "done", origin: "workspace" },
    ]);
    expect(
      mapping.fieldMappings.map((f: Body) => f.target.fieldId),
    ).not.toContain("duedate");

    // Another member does not get MINE.
    const theirs = await s.call(s.reader, "GET", path);
    expect(theirs.json.mapping.jiraProjectKey).toEqual({
      value: "WS",
      origin: "workspace",
    });
  });
});

describe("Jira integration: migration constraints", () => {
  async function seedLink() {
    const s = await setup();
    const [connection] = await db
      .insert(schema.jiraConnectionTable)
      .values({
        workspaceId: s.workspaceId,
        baseUrl: BASE_URL,
        deployment: "server",
        webhookSecret: "secret",
      })
      .returning();
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: s.project.id,
        title: "Task",
        number: 1,
        status: "to-do",
        columnId: s.columns.todo.id,
      })
      .returning();
    const [link] = await db
      .insert(schema.jiraIssueLinkTable)
      .values({
        taskId: task.id,
        connectionId: connection.id,
        issueId: "10001",
        issueKey: "PRJ-1",
        issueUrl: `${BASE_URL}/browse/PRJ-1`,
        jiraProjectKey: "PRJ",
      })
      .returning();
    return { s, connection, task, link };
  }

  const proposal = (
    taskId: string,
    linkId: string,
    overrides: Partial<typeof schema.jiraStatusProposalTable.$inferInsert> = {},
  ) => ({
    taskId,
    linkId,
    toStatusName: "Done",
    source: "poll" as const,
    ...overrides,
  });

  it("allows one pending proposal per task, and any number of resolved ones", async () => {
    const { task, link } = await seedLink();
    const insert = (
      overrides: Partial<typeof schema.jiraStatusProposalTable.$inferInsert>,
    ) =>
      db
        .insert(schema.jiraStatusProposalTable)
        .values(proposal(task.id, link.id, overrides));

    await insert({ state: "accepted" });
    await insert({ state: "rejected" });
    await insert({ state: "superseded" });
    await insert({ state: "pending" });
    await expect(insert({ state: "pending" })).rejects.toThrow();

    const pending = await db
      .select()
      .from(schema.jiraStatusProposalTable)
      .where(eq(schema.jiraStatusProposalTable.state, "pending"));
    expect(pending).toHaveLength(1);

    // Once resolved, a new one may become pending.
    await db
      .update(schema.jiraStatusProposalTable)
      .set({ state: "superseded" })
      .where(eq(schema.jiraStatusProposalTable.state, "pending"));
    await insert({ state: "pending" });
  });

  it("rejects an invalid proposal state or source", async () => {
    const { task, link } = await seedLink();
    await expect(
      db
        .insert(schema.jiraStatusProposalTable)
        .values(proposal(task.id, link.id, { state: "done" })),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.jiraStatusProposalTable).values(
        proposal(task.id, link.id, {
          source: "email" as unknown as "poll",
        }),
      ),
    ).rejects.toThrow();
  });

  it("links one task to one issue and one issue to one task", async () => {
    const { s, connection, task, link } = await seedLink();
    await expect(
      db.insert(schema.jiraIssueLinkTable).values({
        taskId: task.id,
        connectionId: connection.id,
        issueId: "10002",
        issueKey: "PRJ-2",
        issueUrl: `${BASE_URL}/browse/PRJ-2`,
        jiraProjectKey: "PRJ",
      }),
    ).rejects.toThrow();

    const [other] = await db
      .insert(schema.taskTable)
      .values({
        projectId: s.project.id,
        title: "Other",
        number: 2,
        status: "to-do",
        columnId: s.columns.todo.id,
      })
      .returning();
    await expect(
      db.insert(schema.jiraIssueLinkTable).values({
        taskId: other.id,
        connectionId: connection.id,
        issueId: link.issueId,
        issueKey: "PRJ-9",
        issueUrl: `${BASE_URL}/browse/PRJ-9`,
        jiraProjectKey: "PRJ",
      }),
    ).rejects.toThrow();
  });

  it("removes links and proposals with the task and with the connection", async () => {
    const { s, connection, task, link } = await seedLink();
    await db
      .insert(schema.jiraStatusProposalTable)
      .values(proposal(task.id, link.id));

    await db
      .delete(schema.jiraConnectionTable)
      .where(eq(schema.jiraConnectionTable.id, connection.id));

    expect(await db.select().from(schema.jiraIssueLinkTable)).toHaveLength(0);
    expect(await db.select().from(schema.jiraStatusProposalTable)).toHaveLength(
      0,
    );
    expect(s.project.id).toBeTruthy();
  });

  it("keeps the mapping scope consistent with project_id and user_id", async () => {
    const s = await setup();
    const base = { workspaceId: s.workspaceId, config: "{}" };
    const insert = (values: Record<string, unknown>) =>
      db
        .insert(schema.jiraMappingTable)
        .values({ ...base, ...values } as never);

    await expect(insert({ scope: "other" })).rejects.toThrow();
    await expect(insert({ scope: "project" })).rejects.toThrow();
    await expect(
      insert({ scope: "workspace", projectId: s.project.id }),
    ).rejects.toThrow();
    await expect(insert({ scope: "user" })).rejects.toThrow();
    await expect(
      insert({ scope: "workspace", userId: s.plain.id }),
    ).rejects.toThrow();
    await expect(
      insert({ scope: "project", projectId: s.project.id, userId: s.plain.id }),
    ).rejects.toThrow();

    await insert({ scope: "workspace" });
    await insert({ scope: "project", projectId: s.project.id });
    await insert({ scope: "user", userId: s.plain.id });
    // NULLS NOT DISTINCT: a second workspace-level row is a duplicate.
    await expect(insert({ scope: "workspace" })).rejects.toThrow();
    await expect(
      insert({ scope: "project", projectId: s.project.id }),
    ).rejects.toThrow();
    await expect(
      insert({ scope: "user", userId: s.plain.id }),
    ).rejects.toThrow();
  });

  it("allows one connection per workspace and one token per user and connection", async () => {
    const { s, connection } = await seedLink();
    await expect(
      db.insert(schema.jiraConnectionTable).values({
        workspaceId: s.workspaceId,
        baseUrl: BASE_URL,
        deployment: "cloud",
        webhookSecret: "x",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.jiraConnectionTable).values({
        workspaceId: s.otherWorkspaceId,
        baseUrl: BASE_URL,
        deployment: "datacenter",
        webhookSecret: "x",
      }),
    ).rejects.toThrow();

    const token = {
      connectionId: connection.id,
      userId: s.plain.id,
      encryptedToken: "enc:v1:x",
    };
    await db.insert(schema.jiraUserTokenTable).values(token);
    await expect(
      db.insert(schema.jiraUserTokenTable).values(token),
    ).rejects.toThrow();
  });
});
