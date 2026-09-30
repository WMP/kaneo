import type { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, verifyApiKey } = vi.hoisted(() => ({
  getSession: vi.fn(),
  verifyApiKey: vi.fn(),
}));

vi.mock("../../../apps/api/src/auth", () => ({
  auth: { api: { getSession } },
}));
vi.mock("../../../apps/api/src/utils/verify-api-key", () => ({ verifyApiKey }));
vi.mock("@sentry/node", () => ({ setUser: vi.fn() }));

import { authenticateApiRequest } from "../../../apps/api/src/utils/authenticate-api-request";

const FULL_KEY = "kaneo_abcdefghijklmnopqrstuvwxyz0123456789";
const SESSION_TOKEN = "0b7f6c1e-5d44-4c39-8f57-aa11bb22cc33a1b2";

function fakeContext(headers: Record<string, string>) {
  const values = new Map<string, unknown>();
  const c = {
    req: {
      header: (name: string) =>
        Object.entries(headers).find(
          ([key]) => key.toLowerCase() === name.toLowerCase(),
        )?.[1],
      raw: new Request("http://localhost/api/task", { headers }),
    },
    set: (key: string, value: unknown) => values.set(key, value),
    get: (key: string) => values.get(key),
  };
  return { c: c as unknown as Context, values };
}

const apiKeyResult = {
  valid: true,
  key: {
    id: "key-1",
    userId: "user-1",
    enabled: true,
    permissions: null,
    start: "kaneo_",
  },
};

function sessionResult(authVia: string | null) {
  return {
    user: { id: "user-1", email: "marcin@example.test" },
    session: { id: "session-1", token: SESSION_TOKEN, authVia },
  };
}

beforeEach(() => {
  getSession.mockReset();
  verifyApiKey.mockReset();
});

describe("authenticateApiRequest auth source", () => {
  it("labels an x-api-key request with the key's stored start, never the key", async () => {
    verifyApiKey.mockResolvedValue(apiKeyResult);
    const { c, values } = fakeContext({ "x-api-key": FULL_KEY });

    await authenticateApiRequest(c);

    expect(values.get("authSource")).toEqual({
      via: "api",
      tokenHint: "kaneo_…",
    });
    expect(JSON.stringify([...values.values()])).not.toContain(FULL_KEY);
  });

  it("labels a bearer API key the same way", async () => {
    verifyApiKey.mockResolvedValue(apiKeyResult);
    const { c, values } = fakeContext({ authorization: `Bearer ${FULL_KEY}` });

    await authenticateApiRequest(c);

    expect(values.get("authSource")).toEqual({
      via: "api",
      tokenHint: "kaneo_…",
    });
    expect(getSession).not.toHaveBeenCalled();
    expect(JSON.stringify([...values.values()])).not.toContain(FULL_KEY);
  });

  it("labels a bearer session marked as MCP with the last 4 token characters", async () => {
    verifyApiKey.mockResolvedValue(null);
    getSession.mockResolvedValue(sessionResult("mcp"));
    const { c, values } = fakeContext({
      authorization: `Bearer ${SESSION_TOKEN}`,
      cookie: "better-auth.session_token=web",
    });

    await authenticateApiRequest(c);

    expect(values.get("authSource")).toEqual({
      via: "mcp",
      tokenHint: "…a1b2",
    });
    expect(values.get("userId")).toBe("user-1");
    expect(JSON.stringify(values.get("authSource"))).not.toContain(
      SESSION_TOKEN,
    );
    // The cookie must not take part in the bearer lookup.
    const headers = getSession.mock.calls[0]?.[0].headers as Headers;
    expect(headers.has("cookie")).toBe(false);
  });

  it("does not label a plain bearer session (for example the CLI)", async () => {
    verifyApiKey.mockResolvedValue(null);
    getSession.mockResolvedValue(sessionResult(null));
    const { c, values } = fakeContext({
      authorization: `Bearer ${SESSION_TOKEN}`,
    });

    await authenticateApiRequest(c);

    expect(values.get("authSource")).toEqual({ via: null, tokenHint: null });
  });

  it("does not label a cookie session, even one marked as MCP", async () => {
    getSession.mockResolvedValue(sessionResult("mcp"));
    const { c, values } = fakeContext({
      cookie: "better-auth.session_token=x",
    });

    await authenticateApiRequest(c);

    expect(values.get("authSource")).toEqual({ via: null, tokenHint: null });
  });

  it("rejects an unknown API key without setting a source", async () => {
    verifyApiKey.mockResolvedValue(null);
    const { c, values } = fakeContext({ "x-api-key": FULL_KEY });

    await expect(authenticateApiRequest(c)).rejects.toMatchObject({
      status: 401,
    });
    expect(values.has("authSource")).toBe(false);
  });
});
