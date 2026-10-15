import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth-service.js";

const {
  loadCredentialsMock,
  clearCredentialsMock,
  saveCredentialsMock,
  requestDeviceCodeMock,
  pollDeviceAccessTokenMock,
  openMock,
} = vi.hoisted(() => ({
  loadCredentialsMock: vi.fn(),
  clearCredentialsMock: vi.fn(),
  saveCredentialsMock: vi.fn(),
  requestDeviceCodeMock: vi.fn(),
  pollDeviceAccessTokenMock: vi.fn(),
  openMock: vi.fn(),
}));

vi.mock("./token-store.js", () => ({
  loadCredentials: loadCredentialsMock,
  clearCredentials: clearCredentialsMock,
  saveCredentials: saveCredentialsMock,
}));
vi.mock("./device-flow.js", () => ({
  requestDeviceCode: requestDeviceCodeMock,
  pollDeviceAccessToken: pollDeviceAccessTokenMock,
}));
vi.mock("open", () => ({ default: openMock }));

const BASE = "https://api.example.com";
const cached = {
  version: 1,
  baseUrl: BASE,
  clientId: "kaneo-mcp",
  accessToken: "cached-token",
};
const service = () => new AuthService({ baseUrl: BASE, clientId: "kaneo-mcp" });

const realFetch = globalThis.fetch;

beforeEach(() => {
  for (const m of [
    loadCredentialsMock,
    clearCredentialsMock,
    saveCredentialsMock,
    requestDeviceCodeMock,
    pollDeviceAccessTokenMock,
    openMock,
  ]) {
    m.mockReset();
  }
  loadCredentialsMock.mockResolvedValue(null);
  requestDeviceCodeMock.mockResolvedValue({
    device_code: "dc",
    user_code: "UC-1",
    verification_uri: "https://verify.example.com",
    interval: 5,
  });
  pollDeviceAccessTokenMock.mockResolvedValue("fresh-token");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("API key auth", () => {
  it("returns the key without touching storage, network or the device flow", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const s = new AuthService({
      baseUrl: BASE,
      clientId: "c",
      apiKey: "kaneo_key",
    });
    expect(s.usingApiKey).toBe(true);
    await expect(s.getAccessToken()).resolves.toBe("kaneo_key");
    expect(loadCredentialsMock).not.toHaveBeenCalled();
    expect(requestDeviceCodeMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not clear stored credentials when using an API key", async () => {
    const s = new AuthService({ baseUrl: BASE, clientId: "c", apiKey: "k" });
    await s.clearToken();
    expect(clearCredentialsMock).not.toHaveBeenCalled();
  });

  it("clears stored credentials for device-flow auth", async () => {
    const s = service();
    expect(s.usingApiKey).toBe(false);
    await s.clearToken();
    expect(clearCredentialsMock).toHaveBeenCalledTimes(1);
  });
});

describe("cached token validation", () => {
  it.each([
    ["a 500 response", () => new Response("err", { status: 500 })],
    [
      "a session without a user id",
      () => new Response(JSON.stringify({ user: {} })),
    ],
    ["a non-JSON body", () => new Response("not json")],
    ["a null session", () => new Response("null")],
  ])("keeps the cached token on %s", async (_name, respond) => {
    loadCredentialsMock.mockResolvedValue(cached);
    globalThis.fetch = vi
      .fn()
      .mockImplementation(async () => respond()) as typeof fetch;
    await expect(service().getAccessToken()).resolves.toBe("cached-token");
    expect(clearCredentialsMock).not.toHaveBeenCalled();
    expect(requestDeviceCodeMock).not.toHaveBeenCalled();
  });

  it("sends the cached token as a bearer to /api/auth/get-session", async () => {
    loadCredentialsMock.mockResolvedValue(cached);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ user: { id: "u" } })));
    globalThis.fetch = fetchMock as typeof fetch;
    await service().getAccessToken();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE}/api/auth/get-session`);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer cached-token" },
    });
  });

  it.each([
    ["another base URL", { ...cached, baseUrl: "https://other.example.com" }],
    ["another client id", { ...cached, clientId: "other" }],
    ["an empty token", { ...cached, accessToken: "" }],
  ])(
    "ignores cached credentials for %s without validating them",
    async (_n, creds) => {
      loadCredentialsMock.mockResolvedValue(creds);
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock as typeof fetch;
      await expect(service().getAccessToken()).resolves.toBe("fresh-token");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(clearCredentialsMock).not.toHaveBeenCalled();
      expect(requestDeviceCodeMock).toHaveBeenCalledTimes(1);
    },
  );
});

describe("device flow", () => {
  it("prefers verification_uri_complete, opens the browser, polls and stores the token", async () => {
    requestDeviceCodeMock.mockResolvedValue({
      device_code: "dc",
      user_code: "UC-1",
      verification_uri: "https://verify.example.com",
      verification_uri_complete: "https://verify.example.com?code=UC-1",
      interval: 7,
    });
    await expect(service().getAccessToken()).resolves.toBe("fresh-token");
    expect(openMock).toHaveBeenCalledWith(
      "https://verify.example.com?code=UC-1",
    );
    expect(console.error).toHaveBeenCalledWith(
      "[kaneo-mcp] Open https://verify.example.com?code=UC-1 and approve this device. User code: UC-1",
    );
    expect(pollDeviceAccessTokenMock).toHaveBeenCalledWith(
      BASE,
      "kaneo-mcp",
      "dc",
      7,
      { log: expect.any(Function) },
    );
    expect(saveCredentialsMock).toHaveBeenCalledWith({
      version: 1,
      baseUrl: BASE,
      clientId: "kaneo-mcp",
      accessToken: "fresh-token",
    });
  });

  it("prefixes poll log messages and continues when the browser cannot be opened", async () => {
    openMock.mockRejectedValue(new Error("no display"));
    pollDeviceAccessTokenMock.mockImplementation(
      async (
        _b: string,
        _c: string,
        _d: string,
        _i: number,
        o: { log: (m: string) => void },
      ) => {
        o.log("Waiting");
        return "fresh-token";
      },
    );
    await expect(service().getAccessToken()).resolves.toBe("fresh-token");
    expect(console.error).toHaveBeenCalledWith(
      "[kaneo-mcp] Could not open a browser automatically; use the URL above.",
    );
    expect(console.error).toHaveBeenCalledWith("[kaneo-mcp] Waiting");
    expect(saveCredentialsMock).toHaveBeenCalledTimes(1);
  });

  it("shares one device flow between concurrent callers", async () => {
    const [a, b] = await Promise.all([
      service().getAccessToken(),
      service().getAccessToken(),
    ]);
    expect([a, b]).toEqual(["fresh-token", "fresh-token"]);
    // two service instances do not share state
    expect(requestDeviceCodeMock).toHaveBeenCalledTimes(2);

    requestDeviceCodeMock.mockClear();
    const s = service();
    const results = await Promise.all([s.getAccessToken(), s.getAccessToken()]);
    expect(results).toEqual(["fresh-token", "fresh-token"]);
    expect(requestDeviceCodeMock).toHaveBeenCalledTimes(1);
    expect(saveCredentialsMock).toHaveBeenCalledTimes(3);
  });

  it("does not store a token and allows a retry when the flow fails", async () => {
    pollDeviceAccessTokenMock.mockRejectedValueOnce(
      new Error("Device authorization was denied."),
    );
    const s = service();
    await expect(s.getAccessToken()).rejects.toThrow(
      "Device authorization was denied.",
    );
    expect(saveCredentialsMock).not.toHaveBeenCalled();
    await expect(s.getAccessToken()).resolves.toBe("fresh-token");
  });
});
