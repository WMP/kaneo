import { afterEach, describe, expect, it, vi } from "vitest";
import { KaneoClient } from "./client.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const makeAuth = (usingApiKey = false) => ({
  getAccessToken: vi.fn().mockResolvedValue("tok"),
  clearToken: vi.fn().mockResolvedValue(undefined),
  usingApiKey,
});

const make = (auth = makeAuth()) =>
  new KaneoClient({ baseUrl: "https://api.example.com", auth: auth as never });

describe("KaneoClient", () => {
  it("exposes usingApiKey from the auth service", () => {
    expect(make(makeAuth(true)).usingApiKey).toBe(true);
    expect(make(makeAuth(false)).usingApiKey).toBe(false);
  });

  it("prefixes a missing leading slash and does not force a content type without a body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    globalThis.fetch = fetchMock as typeof fetch;
    await make().json("api/project");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.com/api/project",
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("authorization")).toBe("Bearer tok");
  });

  it("keeps a caller supplied content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    globalThis.fetch = fetchMock as typeof fetch;
    await make().json("/x", {
      method: "POST",
      body: "a=b",
      headers: { "Content-Type": "text/plain" },
    });
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("content-type")).toBe("text/plain");
  });

  it("combines a caller abort signal with the timeout", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    globalThis.fetch = fetchMock as typeof fetch;
    await make().json("/x", { signal: controller.signal });
    const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(signal).not.toBe(controller.signal);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it("does not retry a 401 when using an API key", async () => {
    const auth = makeAuth(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("unauthorized", { status: 401 }));
    globalThis.fetch = fetchMock as typeof fetch;
    await expect(make(auth).json("/x")).rejects.toThrow("/x: unauthorized");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(auth.clearToken).not.toHaveBeenCalled();
  });

  it("retries a 401 only once", async () => {
    const auth = makeAuth(false);
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response("no", { status: 401 }));
    globalThis.fetch = fetchMock as typeof fetch;
    await expect(make(auth).json("/x")).rejects.toThrow("/x: no");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.clearToken).toHaveBeenCalledTimes(1);
  });

  it("returns null for an empty body and raw text for non-JSON success", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(""))
      .mockResolvedValueOnce(new Response("plain")) as typeof fetch;
    await expect(make().json("/a")).resolves.toBeNull();
    await expect(make().json("/b")).resolves.toBe("plain");
  });

  it.each([
    [new Response("", { status: 503 }), "/x: HTTP 503"],
    [
      new Response(JSON.stringify({ error: "x" }), { status: 400 }),
      "/x: HTTP 400",
    ],
    [
      new Response(JSON.stringify({ message: 5 }), { status: 400 }),
      "/x: HTTP 400",
    ],
    [new Response("z".repeat(600), { status: 500 }), `/x: ${"z".repeat(500)}…`],
    [new Response("z".repeat(500), { status: 500 }), `/x: ${"z".repeat(500)}`],
  ])("builds the error detail for response %#", async (response, message) => {
    globalThis.fetch = vi.fn().mockResolvedValue(response) as typeof fetch;
    await expect(make().json("/x")).rejects.toThrow(message);
  });

  it("propagates network failures", async () => {
    const error = new TypeError("fetch failed");
    globalThis.fetch = vi.fn().mockRejectedValue(error) as typeof fetch;
    await expect(make().json("/x")).rejects.toBe(error);
  });
});
