import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollDeviceAccessToken, requestDeviceCode } from "./device-flow.js";

const realFetch = globalThis.fetch;
const BASE = "https://api.example.com";

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const validCode = {
  device_code: "dc",
  user_code: "uc",
  verification_uri: "https://v.example.com",
  interval: 5,
  expires_in: 600,
};

function abortError() {
  return new DOMException("aborted", "AbortError");
}

describe("requestDeviceCode errors", () => {
  it("coerces numeric strings for interval and expires_in", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        json({ ...validCode, interval: "5", expires_in: " 600 " }),
      ) as typeof fetch;
    const res = await requestDeviceCode(BASE, "c");
    expect(res.interval).toBe(5);
    expect(res.expires_in).toBe(600);
  });

  it.each([
    [{ ...validCode, interval: "abc" }],
    [{ ...validCode, expires_in: "" }],
    [{ ...validCode, interval: undefined }],
    [{ ...validCode, expires_in: Number.NaN }],
  ])("rejects an invalid interval or expires_in (%j)", async (body) => {
    globalThis.fetch = vi.fn().mockResolvedValue(json(body)) as typeof fetch;
    await expect(requestDeviceCode(BASE, "c")).rejects.toThrow(
      /invalid interval or expires_in/,
    );
  });

  it("rejects a response without user_code or verification_uri", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        json({ device_code: "dc", interval: 1, expires_in: 1 }),
      ) as typeof fetch;
    await expect(requestDeviceCode(BASE, "c")).rejects.toThrow(
      /missing user_code or verification_uri/,
    );
  });

  it("includes the HTTP status and body for a failed request", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        json({ error: "invalid_client" }, 400),
      ) as typeof fetch;
    await expect(requestDeviceCode(BASE, "c")).rejects.toThrow(
      'device/code failed (400): {"error":"invalid_client"}',
    );
  });

  it.each([
    ["null", "null"],
    ["a JSON string", '"text"'],
  ])("rejects a non-object body (%s)", async (_n, raw) => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(raw)) as typeof fetch;
    await expect(requestDeviceCode(BASE, "c")).rejects.toThrow(
      /device\/code: unexpected response/,
    );
  });

  it("treats an unparseable body as an empty object", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("<html>", { status: 502 }),
      ) as typeof fetch;
    await expect(requestDeviceCode(BASE, "c")).rejects.toThrow(
      "device/code failed (502): {}",
    );
  });

  it("reports a timeout when the request is aborted", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(abortError()) as typeof fetch;
    await expect(requestDeviceCode(BASE, "c")).rejects.toThrow(
      "device/code request timed out after 10s.",
    );
    const plain = Object.assign(new Error("x"), { name: "AbortError" });
    globalThis.fetch = vi.fn().mockRejectedValue(plain) as typeof fetch;
    await expect(requestDeviceCode(BASE, "c")).rejects.toThrow(
      "device/code request timed out after 10s.",
    );
  });

  it("rethrows other network errors", async () => {
    const error = new TypeError("fetch failed");
    globalThis.fetch = vi.fn().mockRejectedValue(error) as typeof fetch;
    await expect(requestDeviceCode(BASE, "c")).rejects.toBe(error);
  });
});

describe("pollDeviceAccessToken errors", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("posts the device grant", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ access_token: "t" }));
    globalThis.fetch = fetchMock as typeof fetch;
    await pollDeviceAccessToken(BASE, "client", "dev", 1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE}/api/auth/device/token`);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: "dev",
      client_id: "client",
    });
  });

  it("reports an expired device code", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(json({ error: "expired_token" }, 400)) as typeof fetch;
    await expect(pollDeviceAccessToken(BASE, "c", "d", 1)).rejects.toThrow(
      "Device code expired; start login again.",
    );
  });

  it("fails on an unknown error with status and body", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(json({ error: "server_error" }, 500)) as typeof fetch;
    await expect(pollDeviceAccessToken(BASE, "c", "d", 1)).rejects.toThrow(
      'device/token failed (500): {"error":"server_error"}',
    );
  });

  it("does not accept a 200 response without an access token", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(json({})) as typeof fetch;
    await expect(pollDeviceAccessToken(BASE, "c", "d", 1)).rejects.toThrow(
      "device/token failed (200): {}",
    );
  });

  it("fails on a non-object body", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("null")) as typeof fetch;
    await expect(pollDeviceAccessToken(BASE, "c", "d", 1)).rejects.toThrow(
      "device/token failed (200): null",
    );
  });

  it("retries after a timed-out poll request and logs it", async () => {
    const log = vi.fn();
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(json({ access_token: "t" })) as typeof fetch;
    const p = pollDeviceAccessToken(BASE, "c", "d", 1, { log });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("t");
    expect(log).toHaveBeenCalledWith(
      "Device token poll request timed out; retrying.",
    );
  });

  it("rethrows non-abort network errors", async () => {
    const error = new TypeError("fetch failed");
    globalThis.fetch = vi.fn().mockRejectedValue(error) as typeof fetch;
    await expect(pollDeviceAccessToken(BASE, "c", "d", 1)).rejects.toBe(error);
  });

  it("times out when approval never arrives", async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementation(async () =>
        json({ error: "authorization_pending" }, 400),
      ) as typeof fetch;
    const p = pollDeviceAccessToken(BASE, "c", "d", 1, { maxWaitMs: 2500 });
    const assertion = expect(p).rejects.toThrow(
      "Device authorization timed out waiting for approval.",
    );
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("fails if the deadline passes while a poll request is in flight", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 10_000);
      return json({ error: "authorization_pending" }, 400);
    }) as typeof fetch;
    await expect(
      pollDeviceAccessToken(BASE, "c", "d", 1, { maxWaitMs: 5000 }),
    ).rejects.toThrow("Device authorization timed out waiting for approval.");
  });

  it("stops if the deadline passes during the wait between polls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ error: "authorization_pending" }, 400));
    globalThis.fetch = fetchMock as typeof fetch;
    const p = pollDeviceAccessToken(BASE, "c", "d", 1, { maxWaitMs: 500 });
    const assertion = expect(p).rejects.toThrow(
      "Device authorization timed out waiting for approval.",
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("request timeouts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("aborts device/code after 10 seconds", async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(abortError()));
        }),
    ) as typeof fetch;
    const p = requestDeviceCode(BASE, "c");
    const assertion = expect(p).rejects.toThrow(
      "device/code request timed out after 10s.",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it("treats an unparseable poll body as an empty error response", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("<html>", { status: 502 }),
      ) as typeof fetch;
    await expect(pollDeviceAccessToken(BASE, "c", "d", 1)).rejects.toThrow(
      "device/token failed (502): {}",
    );
  });
});
