import { afterEach, describe, expect, it, vi } from "vitest";
import { client, windowId } from "./hono";

type Probe = { probe: { $get: () => Promise<Response> } };
const probe = () => (client as unknown as Probe).probe.$get();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("typed API client", () => {
  it("generates a per-tab window id", () => {
    expect(windowId).toMatch(/^[a-z0-9]{1,9}$/);
  });

  it("sends credentials, JSON content type and the window id to the resolved API URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await probe();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] as [
      Request | string | URL,
      RequestInit,
    ];
    expect(String(input instanceof Request ? input.url : input)).toBe(
      "http://localhost:1337/api/probe",
    );
    expect(init.credentials).toBe("include");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Kaneo-Window-Id"]).toBe(windowId);
  });

  it("turns a fetch TypeError into an actionable connection error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    await expect(probe()).rejects.toThrow(
      /Failed to connect to API server at http:\/\/localhost:1337\/api/,
    );
  });

  it("rethrows other errors unchanged", async () => {
    const error = new TypeError("bad url");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    await expect(probe()).rejects.toBe(error);

    const abort = new Error("aborted with fetch");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(probe()).rejects.toBe(abort);
  });
});
