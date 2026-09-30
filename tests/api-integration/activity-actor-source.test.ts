import { createHash, randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { waitForPendingEventHandlers } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import {
  createAuthCode,
  exchangeCode,
  registerClient,
} from "../../apps/api/src/mcp/oauth";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture } from "./helpers/fixtures";

const origin = "http://localhost:5173";
const password = "actor-source-password-12345";

type App = ReturnType<typeof createApp>["app"];

function mergeCookieJar(cookieJar: string, res: Response): string {
  const pairs = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .filter(Boolean);
  return pairs.length
    ? `${cookieJar ? `${cookieJar}; ` : ""}${pairs.join("; ")}`
    : cookieJar;
}

const jsonHeaders = { "content-type": "application/json", Origin: origin };

// A real user with a cookie session (the web UI), owner of a workspace with a
// project and one task.
async function seed(app: App) {
  const email = `actor-${randomUUID()}@example.com`;
  let jar = "csrf=1";
  for (const [path, body] of [
    ["/api/auth/sign-up/email", { name: "Marcin Janowski", email, password }],
    ["/api/auth/sign-in/email", { email, password }],
  ] as const) {
    const res = await app.request(path, {
      method: "POST",
      headers: { ...jsonHeaders, Cookie: jar },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    jar = mergeCookieJar(jar, res);
  }
  const [user] = await db
    .select()
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email));
  const workspaceId = `ws-${randomUUID()}`;
  await db.insert(schema.workspaceTable).values({
    id: workspaceId,
    name: "Actor source workspace",
    slug: `slug-${randomUUID()}`,
    createdAt: new Date(),
  });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role: "owner",
    joinedAt: new Date(),
  });
  const { project } = await createProjectFixture({ workspaceId });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Task",
      status: "to-do",
      number: 1,
    })
    .returning();
  return { cookie: jar, userId: user.id, taskId: task.id, workspaceId };
}

async function deviceAccessToken(app: App, cookie: string, clientId: string) {
  const codeRes = await app.request("/api/auth/device/code", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ client_id: clientId }),
  });
  expect(codeRes.status).toBe(200);
  const { device_code, user_code } = (await codeRes.json()) as {
    device_code: string;
    user_code: string;
  };
  const claim = await app.request(
    `/api/auth/device?user_code=${encodeURIComponent(user_code)}`,
    { headers: { Origin: origin, Cookie: cookie } },
  );
  expect(claim.status).toBe(200);
  const approve = await app.request("/api/auth/device/approve", {
    method: "POST",
    headers: { ...jsonHeaders, Cookie: cookie },
    body: JSON.stringify({ userCode: user_code }),
  });
  expect(approve.status).toBe(200);
  const tokenRes = await app.request("/api/auth/device/token", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code,
      client_id: clientId,
    }),
  });
  expect(tokenRes.status).toBe(200);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  return access_token;
}

async function createApiKey(userId: string, rawKey: string) {
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: createHash("sha256").update(rawKey).digest("base64url"),
    name: "actor source key",
    start: rawKey.slice(0, 8),
    prefix: "kaneo",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

// Drives a direct insert (title), an event handler insert (status) and a
// comment, and returns the activity rows in creation order.
async function changeTask(
  app: App,
  taskId: string,
  auth: Record<string, string>,
) {
  const headers = { "content-type": "application/json", ...auth };
  const requests = [
    app.request(`/api/task/title/${taskId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ title: `Renamed ${randomUUID()}` }),
    }),
  ];
  expect((await requests[0]).status).toBe(200);
  const status = await app.request(`/api/task/status/${taskId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ status: "in-progress" }),
  });
  expect(status.status).toBe(200);
  const comment = await app.request(`/api/comment/${taskId}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: "A comment" }),
  });
  expect(comment.status).toBe(200);
  await waitForPendingEventHandlers();
  const rows = await db
    .select()
    .from(schema.activityTable)
    .where(eq(schema.activityTable.taskId, taskId))
    .orderBy(asc(schema.activityTable.createdAt));
  expect(rows.map((row) => row.type)).toEqual(
    expect.arrayContaining(["title_changed", "status_changed", "comment"]),
  );
  return rows;
}

async function listActivity(
  app: App,
  taskId: string,
  auth: Record<string, string>,
) {
  const res = await app.request(`/api/activity/${taskId}`, { headers: auth });
  expect(res.status).toBe(200);
  return (await res.json()) as Array<{
    type: string;
    actorVia: string | null;
    actorTokenHint: string | null;
  }>;
}

// The test setup allows only kaneo-cli; the default production list also has
// the stdio MCP package's client.
const previousDeviceClients = process.env.DEVICE_AUTH_CLIENT_IDS;
beforeEach(async () => {
  process.env.DEVICE_AUTH_CLIENT_IDS = "kaneo-cli,kaneo-mcp";
  await resetTestDatabase();
});
afterEach(() => {
  if (previousDeviceClients === undefined) {
    delete process.env.DEVICE_AUTH_CLIENT_IDS;
  } else {
    process.env.DEVICE_AUTH_CLIENT_IDS = previousDeviceClients;
  }
});

describe("API integration: activity actor source", () => {
  it("records the web UI as a plain user", async () => {
    const { app } = createApp();
    const { cookie, taskId } = await seed(app);

    const rows = await changeTask(app, taskId, {
      Cookie: cookie,
      Origin: origin,
    });

    for (const row of rows) {
      expect(row.actorVia).toBeNull();
      expect(row.actorTokenHint).toBeNull();
    }
  });

  it("records an API key with the key's stored start and never the key", async () => {
    const { app } = createApp();
    const { userId, taskId, workspaceId } = await seed(app);
    const rawKey = `kaneo_${randomUUID().replace(/-/g, "")}`;
    await createApiKey(userId, rawKey);

    const rows = await changeTask(app, taskId, { "x-api-key": rawKey });

    for (const row of rows) {
      expect(row.userId).toBe(userId);
      expect(row.actorVia).toBe("api");
      expect(row.actorTokenHint).toBe(`${rawKey.slice(0, 8)}…`);
    }
    const listed = await listActivity(app, taskId, { "x-api-key": rawKey });
    expect(listed.filter((row) => row.actorVia === "api")).toHaveLength(
      rows.length,
    );
    const workspaceRes = await app.request(
      `/api/workspace/${workspaceId}/activity`,
      { headers: { "x-api-key": rawKey } },
    );
    expect(workspaceRes.status).toBe(200);
    const workspaceBody = (await workspaceRes.json()) as {
      data: Array<{ actorVia: string | null; actorTokenHint: string | null }>;
    };
    expect(workspaceBody.data).toHaveLength(rows.length);
    for (const row of workspaceBody.data) {
      expect(row).toMatchObject({
        actorVia: "api",
        actorTokenHint: `${rawKey.slice(0, 8)}…`,
      });
    }
    expect(JSON.stringify([rows, listed, workspaceBody])).not.toContain(rawKey);

    const bearerRows = await changeTask(app, taskId, {
      Authorization: `Bearer ${rawKey}`,
    });
    expect(bearerRows.filter((row) => row.actorVia === "api")).toHaveLength(
      bearerRows.length,
    );
  });

  it("records the kaneo-mcp device flow session as MCP with the last 4 token characters", async () => {
    const { app } = createApp();
    const { cookie, userId, taskId } = await seed(app);
    const token = await deviceAccessToken(app, cookie, "kaneo-mcp");

    const [session] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.token, token));
    expect(session?.authVia).toBe("mcp");

    const rows = await changeTask(app, taskId, {
      Authorization: `Bearer ${token}`,
    });

    for (const row of rows) {
      expect(row.userId).toBe(userId);
      expect(row.actorVia).toBe("mcp");
      expect(row.actorTokenHint).toBe(`…${token.slice(-4)}`);
    }
    const listed = await listActivity(app, taskId, {
      Authorization: `Bearer ${token}`,
    });
    expect(JSON.stringify([rows, listed])).not.toContain(token);
  });

  it("records the built-in MCP OAuth session as MCP", async () => {
    const { app } = createApp();
    const { userId, taskId } = await seed(app);
    const redirectUri = "http://localhost:9999/callback";
    const verifier = randomUUID() + randomUUID();
    const codeChallenge = createHash("sha256")
      .update(verifier)
      .digest("base64url");
    const client = await registerClient({
      redirectUris: [redirectUri],
      clientName: "Actor source test",
    });
    const code = await createAuthCode({
      clientId: client.clientId,
      userId,
      redirectUri,
      codeChallenge,
    });
    const exchanged = await exchangeCode(
      code,
      client.clientId,
      verifier,
      redirectUri,
    );
    if (!exchanged) throw new Error("expected a token");
    const token = exchanged.accessToken;

    const rows = await changeTask(app, taskId, {
      Authorization: `Bearer ${token}`,
    });

    for (const row of rows) {
      expect(row.actorVia).toBe("mcp");
      expect(row.actorTokenHint).toBe(`…${token.slice(-4)}`);
    }
  });

  it("does not mark the kaneo-cli device flow session", async () => {
    const { app } = createApp();
    const { cookie, taskId } = await seed(app);
    const token = await deviceAccessToken(app, cookie, "kaneo-cli");

    const [session] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.token, token));
    expect(session?.authVia).toBeNull();

    const rows = await changeTask(app, taskId, {
      Authorization: `Bearer ${token}`,
    });

    for (const row of rows) {
      expect(row.actorVia).toBeNull();
      expect(row.actorTokenHint).toBeNull();
    }
  });
});
