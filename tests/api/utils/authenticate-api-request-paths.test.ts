import { APIError } from "better-auth/api";
import type { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, verifyApiKey, setUser } = vi.hoisted(() => ({
  getSession: vi.fn(),
  verifyApiKey: vi.fn(),
  setUser: vi.fn(),
}));

vi.mock("../../../apps/api/src/auth", () => ({
  auth: { api: { getSession } },
}));
vi.mock("../../../apps/api/src/utils/verify-api-key", () => ({ verifyApiKey }));
// @sentry/node is installed under apps/api only, so mock its ES module entry.
vi.mock(
  "../../../apps/api/node_modules/@sentry/node/build/esm/index.js",
  () => ({
    setUser,
  }),
);

import {
  authenticateApiRequest,
  resolveAssetBearerOrCookie,
} from "../../../apps/api/src/utils/authenticate-api-request";

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

const validKey = {
  valid: true,
  key: {
    id: "key-1",
    userId: "user-1",
    enabled: true,
    permissions: { task: ["read"] },
    start: "kaneo_",
  },
};

const session = {
  user: { id: "user-2", email: "two@example.test" },
  session: { id: "session-2", token: "tok-2", authVia: null },
};

beforeEach(() => {
  getSession.mockReset();
  verifyApiKey.mockReset();
  setUser.mockReset();
});

describe("authenticateApiRequest request paths", () => {
  it.each([
    ["Bearer a b", "two tokens"],
    ["Bearer", "no token at all"],
  ])(
    "rejects the malformed header %j (%s) without any lookup",
    async (authorization) => {
      const { c } = fakeContext({ authorization, "x-api-key": "kaneo_x" });

      await expect(authenticateApiRequest(c)).rejects.toMatchObject({
        status: 401,
      });
      expect(verifyApiKey).not.toHaveBeenCalled();
      expect(getSession).not.toHaveBeenCalled();
    },
  );

  it("exposes the API key owner, key id, permissions and no user or session, and tags the Sentry user", async () => {
    verifyApiKey.mockResolvedValue(validKey);
    const { c, values } = fakeContext({ "x-api-key": "  kaneo_secret  " });

    await authenticateApiRequest(c);

    expect(verifyApiKey).toHaveBeenCalledWith("kaneo_secret");
    expect(values.get("userId")).toBe("user-1");
    expect(values.get("userEmail")).toBe("");
    expect(values.get("user")).toBeNull();
    expect(values.get("session")).toBeNull();
    expect(values.get("apiKey")).toEqual({
      id: "key-1",
      userId: "user-1",
      enabled: true,
      permissions: { task: ["read"] },
    });
    expect(setUser).toHaveBeenCalledWith({ id: "user-1" });
  });

  it("rejects an x-api-key that verifies as invalid or without a key", async () => {
    verifyApiKey.mockResolvedValueOnce({ valid: false, key: validKey.key });
    await expect(
      authenticateApiRequest(fakeContext({ "x-api-key": "k" }).c),
    ).rejects.toMatchObject({ status: 401 });
    verifyApiKey.mockResolvedValueOnce({ valid: true, key: null });
    await expect(
      authenticateApiRequest(fakeContext({ "x-api-key": "k" }).c),
    ).rejects.toMatchObject({ status: 401 });
    expect(setUser).not.toHaveBeenCalled();
  });

  it("authenticates a bearer API key without consulting sessions", async () => {
    verifyApiKey.mockResolvedValue(validKey);
    const { c, values } = fakeContext({ authorization: "bearer kaneo_secret" });

    await authenticateApiRequest(c);

    expect(verifyApiKey).toHaveBeenCalledWith("kaneo_secret");
    expect(values.get("userId")).toBe("user-1");
    expect(values.get("apiKey")).toMatchObject({ id: "key-1" });
    expect(getSession).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith({ id: "user-1" });
  });

  it("prefers the bearer token over x-api-key", async () => {
    verifyApiKey.mockResolvedValue(null);
    getSession.mockResolvedValue(session);
    const { c, values } = fakeContext({
      authorization: "Bearer tok-2",
      "x-api-key": "kaneo_other",
    });

    await authenticateApiRequest(c);

    expect(verifyApiKey).toHaveBeenCalledTimes(1);
    expect(verifyApiKey).toHaveBeenCalledWith("tok-2");
    expect(values.get("userId")).toBe("user-2");
    expect(values.get("userEmail")).toBe("two@example.test");
    expect(values.get("user")).toBe(session.user);
    expect(values.get("session")).toBe(session.session);
    expect(setUser).toHaveBeenCalledWith({ id: "user-2" });
  });

  it("rejects a bearer token that is neither an API key nor a session", async () => {
    verifyApiKey.mockResolvedValue({ valid: false, key: null });
    getSession.mockResolvedValue(null);
    await expect(
      authenticateApiRequest(fakeContext({ authorization: "Bearer nope" }).c),
    ).rejects.toMatchObject({ status: 401 });

    getSession.mockResolvedValue({ user: session.user, session: null });
    await expect(
      authenticateApiRequest(fakeContext({ authorization: "Bearer nope" }).c),
    ).rejects.toMatchObject({ status: 401 });
    expect(setUser).not.toHaveBeenCalled();
  });

  it("treats a 4xx Better Auth rejection as no session but propagates other failures", async () => {
    getSession.mockRejectedValueOnce(
      new APIError("UNAUTHORIZED", { message: "bad" }),
    );
    await expect(
      authenticateApiRequest(fakeContext({ cookie: "a=b" }).c),
    ).rejects.toMatchObject({ status: 401 });

    const failure = new Error("database down");
    getSession.mockRejectedValueOnce(failure);
    await expect(
      authenticateApiRequest(fakeContext({ cookie: "a=b" }).c),
    ).rejects.toBe(failure);

    getSession.mockRejectedValueOnce(
      new APIError("INTERNAL_SERVER_ERROR", { message: "boom" }),
    );
    await expect(
      authenticateApiRequest(fakeContext({ cookie: "a=b" }).c),
    ).rejects.toBeInstanceOf(APIError);
  });

  it("sets the cookie session user and tags Sentry, or leaves empty values and rejects without a session", async () => {
    getSession.mockResolvedValueOnce(session);
    const ok = fakeContext({ cookie: "a=b" });
    await authenticateApiRequest(ok.c);
    expect(ok.values.get("userId")).toBe("user-2");
    expect(ok.values.get("userEmail")).toBe("two@example.test");
    expect(setUser).toHaveBeenCalledWith({ id: "user-2" });

    getSession.mockResolvedValueOnce(null);
    const anonymous = fakeContext({});
    await expect(authenticateApiRequest(anonymous.c)).rejects.toMatchObject({
      status: 401,
    });
    expect(anonymous.values.get("userId")).toBe("");
    expect(anonymous.values.get("user")).toBeNull();
    expect(setUser).toHaveBeenCalledTimes(1);
  });
});

describe("resolveAssetBearerOrCookie", () => {
  it("resolves an x-api-key owner with the key id", async () => {
    verifyApiKey.mockResolvedValue(validKey);
    await expect(
      resolveAssetBearerOrCookie(fakeContext({ "x-api-key": "kaneo_k" }).c),
    ).resolves.toEqual({ userId: "user-1", apiKeyId: "key-1" });
  });

  it("rejects an invalid x-api-key without falling back to the cookie session", async () => {
    verifyApiKey.mockResolvedValue(null);
    getSession.mockResolvedValue(session);
    await expect(
      resolveAssetBearerOrCookie(
        fakeContext({ "x-api-key": "kaneo_k", cookie: "a=b" }).c,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("resolves a bearer API key, then a bearer session without an api key id", async () => {
    verifyApiKey.mockResolvedValueOnce(validKey);
    await expect(
      resolveAssetBearerOrCookie(
        fakeContext({ authorization: "Bearer kaneo_k" }).c,
      ),
    ).resolves.toEqual({ userId: "user-1", apiKeyId: "key-1" });

    verifyApiKey.mockResolvedValueOnce(null);
    getSession.mockResolvedValueOnce(session);
    await expect(
      resolveAssetBearerOrCookie(
        fakeContext({ authorization: "Bearer tok-2", cookie: "a=b" }).c,
      ),
    ).resolves.toEqual({ userId: "user-2" });
    const headers = getSession.mock.calls[0]?.[0].headers as Headers;
    expect(headers.has("cookie")).toBe(false);
  });

  it("rejects a bearer token that resolves to nothing and a malformed header", async () => {
    verifyApiKey.mockResolvedValue(null);
    getSession.mockResolvedValue({ user: null, session: null });
    await expect(
      resolveAssetBearerOrCookie(
        fakeContext({ authorization: "Bearer nope" }).c,
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      resolveAssetBearerOrCookie(fakeContext({ authorization: "Bearer" }).c),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("resolves the cookie session and rejects an anonymous request", async () => {
    getSession.mockResolvedValueOnce(session);
    await expect(
      resolveAssetBearerOrCookie(fakeContext({ cookie: "a=b" }).c),
    ).resolves.toEqual({ userId: "user-2" });

    getSession.mockResolvedValueOnce(null);
    await expect(
      resolveAssetBearerOrCookie(fakeContext({}).c),
    ).rejects.toMatchObject({ status: 401 });
  });
});
