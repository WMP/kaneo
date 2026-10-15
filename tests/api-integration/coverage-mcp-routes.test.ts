import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import { mcpOauthStateTable } from "../../apps/api/src/database/schema";
import mcp, { mcpWellKnownRoutes } from "../../apps/api/src/mcp";
import {
  OAUTH_PAYLOAD_BYTES,
  putState,
} from "../../apps/api/src/mcp/oauth-store";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

const redirectUri = "https://client.example/callback";
const verifier = "coverage-verifier-0123456789";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const clientOrigin = new URL(
  process.env.KANEO_CLIENT_URL || "http://localhost:5173",
).origin;

beforeEach(async () => {
  await resetTestDatabase();
});

function json(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return mcp.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function registerAndAuthorize() {
  const registered = await json("/mcp/register", {
    client_name: "Coverage client",
    redirect_uris: [redirectUri],
  });
  expect(registered.status).toBe(200);
  const { client_id } = (await registered.json()) as { client_id: string };
  const url = new URL("http://api.local/mcp/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client_id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", "st");
  const authorize = await mcp.request(url.toString(), { redirect: "manual" });
  expect(authorize.status).toBe(302);
  const requestId = new URL(
    authorize.headers.get("location") ?? "",
  ).searchParams.get("request_id");
  expect(requestId).toBeTruthy();
  return { clientId: client_id, requestId: requestId as string };
}

describe("API integration: MCP bearer authentication on /mcp", () => {
  it.each([
    ["no Authorization header", undefined],
    ["a non-Bearer scheme", "Basic abc"],
    ["a Bearer header with spaces in the token", "Bearer a b"],
    ["a Bearer token that resolves to no session", "Bearer unknown-token"],
  ])(
    "answers 401 with a resource_metadata challenge for %s",
    async (_label, header) => {
      mockAnonymousSession();
      const response = await mcp.request("/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(header ? { authorization: header } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toMatch(
        /^Bearer resource_metadata="https?:\/\/[^"]+\/api\/\.well-known\/oauth-protected-resource\/api\/mcp"$/,
      );
      expect(await response.json()).toEqual({
        error: "invalid_token",
        error_description: "Missing or invalid token",
      });
    },
  );
});

describe("API integration: MCP legacy sessions", () => {
  function legacy(
    user: string,
    body: unknown,
    extra: Record<string, string> = {},
  ) {
    return mcp.request("/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${user}`,
        "content-type": "application/json",
        ...extra,
      },
      body: JSON.stringify(body),
    });
  }

  it("forgets a session once its owner closes it and hides it from other users", async () => {
    const owner = await createWorkspaceMember();
    const other = await createWorkspaceMember();
    const spy = mockAuthenticatedSession(owner.user);

    const init = await legacy("owner-token", {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "cov", version: "1" },
      },
    });
    const sessionId = init.headers.get("mcp-session-id") ?? "";
    expect(init.status).toBe(200);
    expect(sessionId).not.toBe("");

    // Another account presenting the same session id gets the same 404 as an unknown id.
    spy.mockResolvedValue({
      session: { id: "s", token: "t", userId: other.user.id } as never,
      user: other.user,
    } as never);
    const foreign = await legacy(
      "other-token",
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { "mcp-session-id": sessionId },
    );
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: "Session not found" });

    // The owner closes the session; afterwards the id is unknown.
    mockAuthenticatedSession(owner.user);
    const closed = await mcp.request("/mcp", {
      method: "DELETE",
      headers: {
        authorization: "Bearer owner-token",
        "mcp-session-id": sessionId,
      },
    });
    expect(closed.status).toBe(200);
    const after = await legacy(
      "owner-token",
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { "mcp-session-id": sessionId },
    );
    expect(after.status).toBe(404);
  });
});

describe("API integration: MCP token endpoint rejections", () => {
  it.each([
    ["malformed JSON", "application/json", "{not json"],
    ["a JSON array", "application/json", "[]"],
    ["JSON null", "application/json", "null"],
  ])(
    "answers 400 invalid_request for %s",
    async (_label, contentType, body) => {
      const response = await mcp.request("/mcp/token", {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    },
  );

  it("answers unsupported_grant_type for any grant but authorization_code", async () => {
    const response = await json("/mcp/token", {
      grant_type: "refresh_token",
      code: "c",
      client_id: "x",
      code_verifier: "v",
      redirect_uri: redirectUri,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unsupported_grant_type" });
  });

  it.each([
    ["missing code", { code: undefined }],
    ["over-long code", { code: "c".repeat(129) }],
    ["missing client_id", { client_id: "" }],
    ["over-long client_id", { client_id: "c".repeat(129) }],
    ["over-long verifier", { code_verifier: "v".repeat(129) }],
    [
      "over-long redirect_uri",
      { redirect_uri: `https://a.example/${"x".repeat(2048)}` },
    ],
    ["non-string code", { code: 12345 }],
  ])("answers invalid_request for %s", async (_label, override) => {
    const response = await json("/mcp/token", {
      grant_type: "authorization_code",
      code: "code",
      client_id: "client",
      code_verifier: "verifier",
      redirect_uri: redirectUri,
      ...override,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("answers invalid_grant for a code that was never issued", async () => {
    const response = await json("/mcp/token", {
      grant_type: "authorization_code",
      code: "never-issued",
      client_id: "client",
      code_verifier: "verifier",
      redirect_uri: redirectUri,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_grant" });
  });
});

describe("API integration: MCP authorization request lookup and decision", () => {
  it("returns the client name and redirect URI of a pending request and 404 for an unknown one", async () => {
    const { requestId } = await registerAndAuthorize();

    const found = await mcp.request(`/mcp/authorize/request/${requestId}`);
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({
      client_name: "Coverage client",
      redirect_uri: redirectUri,
    });

    const missing = await mcp.request("/mcp/authorize/request/unknown-id");
    expect(missing.status).toBe(404);
  });

  it("answers 400 invalid_client for a request whose client no longer exists, on lookup and on decision", async () => {
    const { clientId, requestId } = await registerAndAuthorize();
    await db
      .delete(mcpOauthStateTable)
      .where(eq(mcpOauthStateTable.key, clientId));
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);

    const lookup = await mcp.request(`/mcp/authorize/request/${requestId}`);
    expect(lookup.status).toBe(400);

    const decision = await json(
      `/mcp/authorize/request/${requestId}`,
      { approved: true },
      { origin: clientOrigin },
    );
    expect(decision.status).toBe(400);
    expect(await decision.json()).toMatchObject({ error: "invalid_client" });
  });

  it("a denial redirects with access_denied and the request cannot be decided again", async () => {
    const { requestId } = await registerAndAuthorize();
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);

    const denied = await json(
      `/mcp/authorize/request/${requestId}`,
      { approved: false },
      { origin: clientOrigin },
    );
    expect(denied.status).toBe(200);
    const redirect = new URL(
      ((await denied.json()) as { redirect: string }).redirect,
    );
    expect(redirect.origin + redirect.pathname).toBe(redirectUri);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("state")).toBe("st");
    expect(redirect.searchParams.has("code")).toBe(false);

    const again = await json(
      `/mcp/authorize/request/${requestId}`,
      { approved: true },
      { origin: clientOrigin },
    );
    expect(again.status).toBe(404);
  });

  it("refuses a decision whose Origin header is not a URL", async () => {
    const { requestId } = await registerAndAuthorize();
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);

    const response = await json(
      `/mcp/authorize/request/${requestId}`,
      { approved: true },
      { origin: "not a url" },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "invalid_origin" });
  });
});

describe("API integration: MCP client registration redirect URI rules", () => {
  it.each([
    ["a fragment", "https://client.example/cb#frag"],
    ["embedded credentials", "https://user:pw@client.example/cb"],
    ["a javascript: URI", "javascript:alert(1)"],
    ["plain http to a public host", "http://client.example/cb"],
    ["something that is not a URL", "not a url"],
  ])("refuses %s and stores no client", async (_label, uri) => {
    const response = await json("/mcp/register", { redirect_uris: [uri] });
    expect(response.status).toBe(400);
    expect(await db.select().from(mcpOauthStateTable)).toHaveLength(0);
  });

  it("accepts plain http to loopback and a custom app scheme", async () => {
    const response = await json("/mcp/register", {
      redirect_uris: ["http://127.0.0.1:8123/cb", "cursor://callback"],
    });
    expect(response.status).toBe(200);
  });
});

describe("API integration: MCP OAuth discovery documents", () => {
  it("serves the protected-resource and authorization-server metadata with the endpoints of the API", async () => {
    const resource = await mcp.request(
      "/.well-known/oauth-protected-resource/api/mcp",
    );
    expect(resource.status).toBe(200);
    const resourceBody = (await resource.json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(resourceBody.resource).toMatch(/\/api\/mcp$/);
    expect(resourceBody.authorization_servers).toHaveLength(1);
    expect(resourceBody.authorization_servers[0]).toMatch(/\/api$/);

    const server = await mcp.request(
      "/.well-known/oauth-authorization-server/api",
    );
    expect(server.status).toBe(200);
    const body = (await server.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    expect(String(body.authorization_endpoint)).toMatch(
      /\/api\/mcp\/authorize$/,
    );
    expect(String(body.token_endpoint)).toMatch(/\/api\/mcp\/token$/);
    expect(String(body.registration_endpoint)).toMatch(/\/api\/mcp\/register$/);
    expect(String(body.issuer)).toMatch(/\/api$/);
  });

  it("mcpWellKnownRoutes derives every URL from the given base", async () => {
    const routes = mcpWellKnownRoutes("https://kaneo.example");
    const resource = (await (
      await routes.request("/.well-known/oauth-protected-resource/api/mcp")
    ).json()) as unknown;
    expect(resource).toEqual({
      resource: "https://kaneo.example/api/mcp",
      authorization_servers: ["https://kaneo.example/api"],
    });
    const server = (await (
      await routes.request("/.well-known/oauth-authorization-server/api")
    ).json()) as unknown;
    expect(server).toMatchObject({
      issuer: "https://kaneo.example/api",
      authorization_endpoint: "https://kaneo.example/api/mcp/authorize",
      token_endpoint: "https://kaneo.example/api/mcp/token",
      registration_endpoint: "https://kaneo.example/api/mcp/register",
    });
  });
});

describe("API integration: MCP OAuth state store bounds", () => {
  const later = () => new Date(Date.now() + 60_000);

  it("refuses an oversized payload, an oversized key and a payload that is not JSON-serializable with 413, storing nothing", async () => {
    for (const [key, payload] of [
      ["k1", { blob: "x".repeat(OAUTH_PAYLOAD_BYTES + 1) }],
      ["k".repeat(129), { ok: true }],
      ["k3", undefined],
    ] as const) {
      await expect(
        putState("client", key, payload, later()),
      ).rejects.toMatchObject({ status: 413 });
    }
    const clients = () =>
      db
        .select()
        .from(mcpOauthStateTable)
        .where(eq(mcpOauthStateTable.kind, "client"));
    expect(await clients()).toHaveLength(0);

    await putState("client", "k4", { clientId: "c" }, later());
    expect(await clients()).toHaveLength(1);
  });
});
