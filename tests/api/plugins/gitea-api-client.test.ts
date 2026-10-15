import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGiteaClient,
  GiteaApiError,
  giteaFetch,
  verifyGiteaToken,
} from "../../../apps/api/src/plugins/gitea/utils/gitea-api";

const TOKEN = "gitea-token-do-not-leak";
const originalAllowPrivate =
  process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  if (originalAllowPrivate === undefined) {
    delete process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
  } else {
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = originalAllowPrivate;
  }
});

async function caught(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as GiteaApiError;
  }
  throw new Error("expected a rejection");
}

describe("giteaFetch", () => {
  it("builds the /api/v1 URL, authorises with the token and never follows redirects", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const result = await giteaFetch<{ ok: boolean }>(
      "https://gitea.example/sub/",
      TOKEN,
      "repos/o/r",
      { headers: { "X-Extra": "1" } },
    );
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gitea.example/sub/api/v1/repos/o/r");
    expect(init.redirect).toBe("manual");
    expect(init.headers).toMatchObject({
      Authorization: `token ${TOKEN}`,
      "Content-Type": "application/json",
      "X-Extra": "1",
    });
  });

  it("returns undefined for 204 and for an empty 200 body", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    expect(
      await giteaFetch("https://gitea.example", TOKEN, "/x"),
    ).toBeUndefined();
    expect(
      await giteaFetch("https://gitea.example", TOKEN, "/x"),
    ).toBeUndefined();
  });

  it("raises REDIRECT for 3xx without reading the target", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("", {
        status: 302,
        headers: { location: "http://10.0.0.1/" },
      }),
    );
    const error = await caught(
      giteaFetch("https://gitea.example", TOKEN, "/x"),
    );
    expect(error).toBeInstanceOf(GiteaApiError);
    expect(error).toMatchObject({ kind: "REDIRECT", status: 302 });
    expect(error.message).not.toContain(TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("raises HTTP_ERROR with status and body, and INVALID_JSON for HTML answers", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("nope", { status: 403 }))
      .mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    const http = await caught(giteaFetch("https://gitea.example", TOKEN, "/x"));
    expect(http).toMatchObject({
      kind: "HTTP_ERROR",
      status: 403,
      body: "nope",
    });
    expect(http.message).toBe("Gitea API error 403");
    const invalid = await caught(
      giteaFetch("https://gitea.example", TOKEN, "/x"),
    );
    expect(invalid).toMatchObject({
      kind: "INVALID_JSON",
      status: 200,
      body: "<html>",
    });
  });

  it("rethrows network errors unchanged", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("connect ECONNREFUSED"));
    await expect(
      giteaFetch("https://gitea.example", TOKEN, "/x"),
    ).rejects.toThrow("connect ECONNREFUSED");
  });

  it("times out after 10 seconds with a TIMEOUT error", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    );
    const pending = caught(giteaFetch("https://gitea.example", TOKEN, "/x"));
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const error = await pending;
    expect(error).toMatchObject({ kind: "TIMEOUT", status: 408 });
  });

  it("propagates a caller abort as an AbortError, not as a timeout", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const fail = () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          };
          if (init.signal?.aborted) fail();
          init.signal?.addEventListener("abort", fail);
        }),
    );
    const controller = new AbortController();
    const pending = caught(
      giteaFetch("https://gitea.example", TOKEN, "/x", {
        signal: controller.signal,
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    const error = await pending;
    expect(error.name).toBe("AbortError");

    const already = new AbortController();
    already.abort();
    const early = await caught(
      giteaFetch("https://gitea.example", TOKEN, "/x", {
        signal: already.signal,
      }),
    );
    expect(early.name).toBe("AbortError");
  });
});

describe("createGiteaClient", () => {
  const client = createGiteaClient({
    baseUrl: "https://gitea.example",
    accessToken: TOKEN,
  });

  it("raises EMPTY_RESPONSE when Gitea answers 204 to a call that needs a body", async () => {
    const calls: Array<() => Promise<unknown>> = [
      () => client.getRepo("o", "r"),
      () => client.listUserRepos(),
      () => client.createIssue("o", "r", { title: "t" }),
      () => client.updateIssue("o", "r", 1, {}),
      () => client.listIssueComments("o", "r", 1, 1, 10),
      () => client.createIssueComment("o", "r", 1, "b"),
      () => client.listLabels("o", "r"),
      () => client.createLabel("o", "r", "n", "#fff"),
      () => client.getIssue("o", "r", 1),
      () => client.listIssues("o", "r", 1, "open"),
      () => client.listPulls("o", "r", 1),
      () => verifyGiteaToken("https://gitea.example", TOKEN),
    ];
    for (const run of calls) {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      const error = await caught(run());
      expect(error).toMatchObject({ kind: "EMPTY_RESPONSE", status: 500 });
    }
  });

  it("encodes owner and repository and sends the documented paths and bodies", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ id: 1 }));
    await client.getRepo("my org", "re/po");
    await client.listUserRepos(3, 20);
    await client.listIssues("o", "r", 2, "closed");
    await client.listPulls("o", "r", 4);
    await client.listIssueComments("o", "r", 9, 2, 100);
    await client.createLabel("o", "r", "bug", "#FF0000");
    await client.removeLabelFromIssue("o", "r", 3, 77);
    await client.replaceIssueLabels("o", "r", 3, [1, 2]);
    const seen = fetchMock.mock.calls.map(
      ([url, init]: [string, RequestInit]) => [
        init.method ?? "GET",
        url.replace("https://gitea.example/api/v1", ""),
        init.body,
      ],
    );
    expect(seen).toEqual([
      ["GET", "/repos/my%20org/re%2Fpo", undefined],
      ["GET", "/user/repos?page=3&limit=20", undefined],
      ["GET", "/repos/o/r/issues?state=closed&page=2&limit=100", undefined],
      ["GET", "/repos/o/r/pulls?state=open&page=4&limit=100", undefined],
      ["GET", "/repos/o/r/issues/9/comments?page=2&limit=100", undefined],
      [
        "POST",
        "/repos/o/r/labels",
        JSON.stringify({ name: "bug", color: "FF0000" }),
      ],
      ["DELETE", "/repos/o/r/issues/3/labels/77", undefined],
      ["PUT", "/repos/o/r/issues/3/labels", JSON.stringify({ labels: [1, 2] })],
    ]);
  });

  it("adds labels in chunks of 50 and sends nothing for an empty list", async () => {
    fetchMock.mockImplementation(async () => jsonResponse([]));
    await client.addLabelsToIssue("o", "r", 5, []);
    expect(fetchMock).not.toHaveBeenCalled();
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    await client.addLabelsToIssue("o", "r", 5, ids);
    const sizes = fetchMock.mock.calls.map(
      ([, init]: [string, RequestInit]) =>
        (JSON.parse(String(init.body)) as { labels: number[] }).labels.length,
    );
    expect(sizes).toEqual([50, 50, 20]);
  });

  it("returns the parsed values for successful calls", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, login: "u" }));
    expect(await verifyGiteaToken("https://gitea.example/", TOKEN)).toEqual({
      id: 1,
      login: "u",
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 4, name: "x" }));
    expect(await client.getIssue("o", "r", 4)).toEqual({ id: 4, name: "x" });
  });
});
