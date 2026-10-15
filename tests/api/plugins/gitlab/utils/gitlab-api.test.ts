import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGitlabClient,
  GitlabApiError,
  gitlabFetch,
  tokenTypeOf,
  verifyGitlabToken,
} from "../../../../../apps/api/src/plugins/gitlab/utils/gitlab-api";

// A documentation address: public for the SSRF guard, never contacted because
// fetch is replaced below.
const BASE_URL = "https://203.0.113.10";
const TOKEN = "glpat-unit-token";
const config = { baseUrl: BASE_URL, accessToken: TOKEN };

const fetchMock = vi.fn();

function reply(body: unknown, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });
}

const lockBody = JSON.stringify({ message: "409 Conflict: Resource lock" });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("gitlabFetch", () => {
  it("sends the token in the header that matches its type and never in the URL", async () => {
    fetchMock.mockImplementation(async () => reply({ ok: true }));

    await gitlabFetch(BASE_URL, TOKEN, "private", "/user");
    await gitlabFetch(BASE_URL, TOKEN, "bearer", "user");

    const [privateCall, bearerCall] = fetchMock.mock.calls;
    expect(privateCall[0]).toBe(`${BASE_URL}/api/v4/user`);
    expect(bearerCall[0]).toBe(`${BASE_URL}/api/v4/user`);
    expect(privateCall[1].headers).toMatchObject({ "PRIVATE-TOKEN": TOKEN });
    expect(privateCall[1].headers.Authorization).toBeUndefined();
    expect(bearerCall[1].headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
    });
    expect(bearerCall[1].headers["PRIVATE-TOKEN"]).toBeUndefined();
    expect(privateCall[1].redirect).toBe("manual");
  });

  it("returns undefined for an empty or 204 answer", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(reply("", 200));

    expect(await gitlabFetch(BASE_URL, TOKEN, "private", "/x")).toBeUndefined();
    expect(await gitlabFetch(BASE_URL, TOKEN, "private", "/x")).toBeUndefined();
  });

  it("reports a redirect without following it", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/" },
      }),
    );

    await expect(
      gitlabFetch(BASE_URL, TOKEN, "private", "/user"),
    ).rejects.toMatchObject({ kind: "REDIRECT", status: 302 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the response body on an HTTP error and flags invalid JSON", async () => {
    fetchMock
      .mockResolvedValueOnce(reply("nope", 403))
      .mockResolvedValueOnce(reply("<html>", 200));

    const forbidden = await gitlabFetch(BASE_URL, TOKEN, "private", "/a").catch(
      (error) => error,
    );
    const html = await gitlabFetch(BASE_URL, TOKEN, "private", "/b").catch(
      (error) => error,
    );

    expect(forbidden).toBeInstanceOf(GitlabApiError);
    expect(forbidden).toMatchObject({
      kind: "HTTP_ERROR",
      status: 403,
      body: "nope",
    });
    expect(forbidden.message).not.toContain(TOKEN);
    expect(html).toMatchObject({ kind: "INVALID_JSON", status: 200 });
  });

  it("turns a stalled request into a timeout error after 10 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );

    const pending = gitlabFetch(BASE_URL, TOKEN, "private", "/slow").catch(
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    const error = await pending;
    expect(error).toBeInstanceOf(GitlabApiError);
    expect(error).toMatchObject({ kind: "TIMEOUT", status: 408 });
  });

  it("rethrows an abort that the caller asked for instead of calling it a timeout", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );

    const pending = gitlabFetch(BASE_URL, TOKEN, "private", "/x", {
      signal: controller.signal,
    }).catch((error) => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    controller.abort();

    const error = await pending;
    expect(error).not.toBeInstanceOf(GitlabApiError);
    expect(error.name).toBe("AbortError");
  });

  it("aborts at once when the caller's signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      expect(init.signal?.aborted).toBe(true);
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });

    await expect(
      gitlabFetch(BASE_URL, TOKEN, "private", "/x", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("passes other network failures through unchanged", async () => {
    const failure = new TypeError("fetch failed");
    fetchMock.mockRejectedValue(failure);

    await expect(gitlabFetch(BASE_URL, TOKEN, "private", "/x")).rejects.toBe(
      failure,
    );
  });

  it("refuses a private destination before any request is made", async () => {
    await expect(
      gitlabFetch("https://10.0.0.5", TOKEN, "private", "/user"),
    ).rejects.toThrow(/non-routable/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("tokenTypeOf", () => {
  it("only accepts bearer explicitly", () => {
    expect(tokenTypeOf({ tokenType: "bearer" })).toBe("bearer");
    expect(tokenTypeOf({ tokenType: "private" })).toBe("private");
    expect(tokenTypeOf({})).toBe("private");
  });
});

describe("verifyGitlabToken", () => {
  it("returns the token's user", async () => {
    fetchMock.mockResolvedValue(reply({ id: 7, username: "bot" }));

    expect(await verifyGitlabToken(`${BASE_URL}/`, TOKEN, "private")).toEqual({
      id: 7,
      username: "bot",
    });
  });

  it("treats an empty answer as an error", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      verifyGitlabToken(BASE_URL, TOKEN, "private"),
    ).rejects.toMatchObject({
      kind: "EMPTY_RESPONSE",
      status: 500,
    });
  });
});

describe("createGitlabClient", () => {
  it("url-encodes the project path and rejects unsafe paths before any request", async () => {
    fetchMock.mockImplementation(async () => reply({ id: 1 }));
    const client = createGitlabClient(config);

    await client.getProject("/group/sub/project/");

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BASE_URL}/api/v4/projects/group%2Fsub%2Fproject`,
    );
    await expect(client.getProject("group/../other")).rejects.toThrow(
      /relative segments/,
    );
    await expect(client.getIssue("single", 1)).rejects.toThrow(/namespace/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "getProject",
      (c: ReturnType<typeof createGitlabClient>) => c.getProject("a/b"),
    ],
    [
      "listMemberProjects",
      (c: ReturnType<typeof createGitlabClient>) => c.listMemberProjects(),
    ],
    [
      "createIssue",
      (c: ReturnType<typeof createGitlabClient>) =>
        c.createIssue("a/b", { title: "t" }),
    ],
    [
      "updateIssue",
      (c: ReturnType<typeof createGitlabClient>) => c.updateIssue("a/b", 1, {}),
    ],
    [
      "getIssue",
      (c: ReturnType<typeof createGitlabClient>) => c.getIssue("a/b", 1),
    ],
    [
      "listIssues",
      (c: ReturnType<typeof createGitlabClient>) =>
        c.listIssues("a/b", 1, "all"),
    ],
    [
      "listIssueNotes",
      (c: ReturnType<typeof createGitlabClient>) =>
        c.listIssueNotes("a/b", 1, 1, 10),
    ],
    [
      "createIssueNote",
      (c: ReturnType<typeof createGitlabClient>) =>
        c.createIssueNote("a/b", 1, "x"),
    ],
    [
      "listLabels",
      (c: ReturnType<typeof createGitlabClient>) => c.listLabels("a/b"),
    ],
    [
      "createLabel",
      (c: ReturnType<typeof createGitlabClient>) =>
        c.createLabel("a/b", "n", "fff"),
    ],
    [
      "listMergeRequests",
      (c: ReturnType<typeof createGitlabClient>) =>
        c.listMergeRequests("a/b", 1),
    ],
  ])(
    "%s fails loudly on an empty answer instead of returning undefined",
    async (_name, call) => {
      fetchMock.mockImplementation(
        async () => new Response(null, { status: 204 }),
      );

      await expect(call(createGitlabClient(config))).rejects.toMatchObject({
        kind: "EMPTY_RESPONSE",
        status: 500,
      });
    },
  );

  it("builds the documented request for each operation", async () => {
    fetchMock.mockImplementation(async () => reply({ id: 1, iid: 1 }));
    const client = createGitlabClient(config);

    await client.createIssue("a/b", { title: "T", description: null });
    await client.getIssue("a/b", 4);
    await client.listIssues("a/b", 2, "closed");
    await client.listIssueNotes("a/b", 4, 3, 25);
    await client.createIssueNote("a/b", 4, "hello");
    await client.createLabel("a/b", "bug", "#ff0000");
    await client.createLabel("a/b", "bug2", "00ff00");
    await client.listMergeRequests("a/b", 5);
    await client.listMemberProjects(2, 10);

    const summary = fetchMock.mock.calls.map(([url, init]) => [
      init.method ?? "GET",
      String(url).replace(`${BASE_URL}/api/v4`, ""),
      init.body ? JSON.parse(init.body) : undefined,
    ]);
    expect(summary).toEqual([
      ["POST", "/projects/a%2Fb/issues", { title: "T", description: null }],
      ["GET", "/projects/a%2Fb/issues/4", undefined],
      [
        "GET",
        "/projects/a%2Fb/issues?state=closed&order_by=created_at&sort=asc&per_page=100&page=2",
        undefined,
      ],
      [
        "GET",
        "/projects/a%2Fb/issues/4/notes?sort=asc&order_by=created_at&per_page=25&page=3",
        undefined,
      ],
      ["POST", "/projects/a%2Fb/issues/4/notes", { body: "hello" }],
      ["POST", "/projects/a%2Fb/labels", { name: "bug", color: "#ff0000" }],
      ["POST", "/projects/a%2Fb/labels", { name: "bug2", color: "#00ff00" }],
      [
        "GET",
        "/projects/a%2Fb/merge_requests?state=opened&per_page=100&page=5",
        undefined,
      ],
      [
        "GET",
        "/projects?membership=true&simple=true&order_by=last_activity_at&per_page=10&page=2",
        undefined,
      ],
    ]);
  });

  it("reads every page of labels until a short page, and stops at 20 pages", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      name: `l${i}`,
    }));
    fetchMock
      .mockResolvedValueOnce(reply(full))
      .mockResolvedValueOnce(reply([{ id: 500, name: "last" }]));

    const labels = await createGitlabClient(config).listLabels("a/b");

    expect(labels).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => reply(full));
    const capped = await createGitlabClient(config).listLabels("a/b");
    expect(capped).toHaveLength(2000);
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  describe("updateIssue resource-lock retry", () => {
    it("retries a locked update and then succeeds", async () => {
      fetchMock
        .mockResolvedValueOnce(reply(lockBody, 409))
        .mockResolvedValueOnce(reply(lockBody, 409))
        .mockResolvedValueOnce(reply({ iid: 1, title: "ok" }));

      const issue = await createGitlabClient(config).updateIssue("a/b", 1, {
        title: "ok",
      });

      expect(issue).toMatchObject({ title: "ok" });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(
        fetchMock.mock.calls.every(([, init]) => init.method === "PUT"),
      ).toBe(true);
    }, 10_000);

    it("gives up after four attempts", async () => {
      fetchMock.mockImplementation(async () => reply(lockBody, 409));

      await expect(
        createGitlabClient(config).updateIssue("a/b", 1, {}),
      ).rejects.toMatchObject({ status: 409, kind: "HTTP_ERROR" });
      expect(fetchMock).toHaveBeenCalledTimes(4);
    }, 10_000);

    it.each([
      {
        name: "a different 409",
        body: JSON.stringify({ message: "409 Conflict: other" }),
      },
      { name: "a 409 without JSON", body: "conflict" },
      { name: "a 409 with an empty JSON null", body: "null" },
    ])("does not retry $name", async ({ body }) => {
      fetchMock.mockImplementation(async () => reply(body, 409));

      await expect(
        createGitlabClient(config).updateIssue("a/b", 1, {}),
      ).rejects.toMatchObject({ status: 409 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry other failures or a lock on creating an issue", async () => {
      fetchMock.mockImplementation(async () => reply(lockBody, 500));
      await expect(
        createGitlabClient(config).updateIssue("a/b", 1, {}),
      ).rejects.toMatchObject({ status: 500 });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => reply(lockBody, 409));
      await expect(
        createGitlabClient(config).createIssue("a/b", { title: "t" }),
      ).rejects.toMatchObject({ status: 409 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
