import { afterEach, describe, expect, it, vi } from "vitest";
import { KaneoClient, normalizeBaseUrl } from "./kaneo.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

type Seen = { url: string; init: RequestInit; headers: Headers };

function stubFetch(responder: () => Response) {
  const seen: Seen[] = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    seen.push({
      url: String(url),
      init: init ?? {},
      headers: new Headers(init?.headers),
    });
    return responder();
  }) as unknown as typeof fetch;
  return seen;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const client = () =>
  new KaneoClient({ baseUrl: "https://kaneo.example.com/", apiKey: "key-1" });

describe("normalizeBaseUrl", () => {
  it.each([
    ["https://kaneo.example.com", "https://kaneo.example.com"],
    ["https://kaneo.example.com/", "https://kaneo.example.com"],
    ["https://kaneo.example.com/api", "https://kaneo.example.com"],
    ["https://kaneo.example.com/api/", "https://kaneo.example.com"],
    ["https://example.com/kaneo/api", "https://example.com/kaneo"],
    ["https://example.com/kaneo", "https://example.com/kaneo"],
    ["  https://kaneo.example.com:8443/  ", "https://kaneo.example.com:8443"],
    ["not a url/api/", "not a url"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected);
  });
});

describe("KaneoClient requests", () => {
  it("lists workspaces with bearer auth and no body", async () => {
    const seen = stubFetch(() => json([{ id: "w1", name: "W" }]));
    const result = await client().listWorkspaces();
    expect(result).toEqual([{ id: "w1", name: "W" }]);
    expect(seen[0]?.url).toBe(
      "https://kaneo.example.com/api/auth/organization/list",
    );
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer key-1");
    expect(seen[0]?.headers.get("accept")).toBe("application/json");
    expect(seen[0]?.headers.get("content-type")).toBeNull();
    expect(seen[0]?.init.method).toBeUndefined();
  });

  it("encodes ids in list endpoints", async () => {
    const seen = stubFetch(() => json([]));
    const kaneo = client();
    await kaneo.listProjects("w/1 x");
    await kaneo.listMembers("w/1");
    await kaneo.listColumns("p/1");
    expect(seen.map((s) => s.url)).toEqual([
      "https://kaneo.example.com/api/project?workspaceId=w%2F1%20x",
      "https://kaneo.example.com/api/workspace/w%2F1/members",
      "https://kaneo.example.com/api/column/p%2F1",
    ]);
  });

  it("creates a project with a JSON body", async () => {
    const seen = stubFetch(() => json({ id: "p1", name: "N", slug: "NN" }));
    const input = { name: "N", workspaceId: "w1", icon: "Layout", slug: "NN" };
    await client().createProject(input);
    expect(seen[0]?.url).toBe("https://kaneo.example.com/api/project");
    expect(seen[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual(input);
    expect(seen[0]?.headers.get("content-type")).toBe("application/json");
  });

  it("creates and deletes columns", async () => {
    const seen = stubFetch(() => json({ id: "c1", name: "A", slug: "a" }));
    const kaneo = client();
    await kaneo.createColumn("p1", { name: "A", isFinal: true });
    await kaneo.deleteColumn("c/1");
    expect(seen[0]?.url).toBe("https://kaneo.example.com/api/column/p1");
    expect(seen[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({
      name: "A",
      isFinal: true,
    });
    expect(seen[1]?.url).toBe("https://kaneo.example.com/api/column/c%2F1");
    expect(seen[1]?.init.method).toBe("DELETE");
  });

  it("creates tasks, labels and relations", async () => {
    const seen = stubFetch(() => json({ id: "x" }));
    const kaneo = client();
    const task = {
      title: "T",
      description: "D",
      status: "to-do",
      priority: "medium",
      dueDate: "2025-01-02T00:00:00.000Z",
      userId: "u1",
    };
    await kaneo.createTask("p1", task);
    await kaneo.createLabel({
      name: "bug",
      color: "#ff0000",
      workspaceId: "w1",
      taskId: "t1",
    });
    await kaneo.createTaskRelation({
      sourceTaskId: "t1",
      targetTaskId: "t2",
      relationType: "subtask",
    });
    expect(seen.map((s) => [s.init.method, s.url])).toEqual([
      ["POST", "https://kaneo.example.com/api/task/p1"],
      ["POST", "https://kaneo.example.com/api/label"],
      ["POST", "https://kaneo.example.com/api/task-relation"],
    ]);
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual(task);
    expect(JSON.parse(String(seen[1]?.init.body))).toEqual({
      name: "bug",
      color: "#ff0000",
      workspaceId: "w1",
      taskId: "t1",
    });
    expect(JSON.parse(String(seen[2]?.init.body))).toEqual({
      sourceTaskId: "t1",
      targetTaskId: "t2",
      relationType: "subtask",
    });
  });

  it("tags imported comments with the external author and source", async () => {
    const seen = stubFetch(() => json({}));
    const kaneo = client();
    await kaneo.createComment("t/1", "hello", "Jane");
    await kaneo.createComment("t1", "anonymous");
    expect(seen[0]?.url).toBe("https://kaneo.example.com/api/comment/t%2F1");
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({
      content: "hello",
      externalUserName: "Jane",
      externalSource: "planka",
    });
    expect(JSON.parse(String(seen[1]?.init.body))).toEqual({
      content: "anonymous",
    });
  });
});

describe("KaneoClient errors", () => {
  it("reports 401 with an API key hint", async () => {
    stubFetch(() => json({ message: "nope" }, 401));
    await expect(client().listWorkspaces()).rejects.toThrow(
      "Kaneo /api/auth/organization/list: unauthorized (HTTP 401), check your Kaneo API key",
    );
  });

  it.each([
    [json({ message: "bad input" }, 400), "bad input"],
    [json({ error: "forbidden" }, 403), "forbidden"],
    [json({ other: true }, 500), "HTTP 500"],
    [new Response("boom", { status: 500 }), "boom"],
    [new Response("y".repeat(301), { status: 500 }), `${"y".repeat(300)}…`],
    [new Response("", { status: 504 }), "HTTP 504"],
  ])("describes error response %#", async (response, expected) => {
    stubFetch(() => response);
    await expect(client().listProjects("w")).rejects.toThrow(
      `Kaneo /api/project?workspaceId=w: ${expected}`,
    );
  });

  it("wraps network failures with the path", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    await expect(client().listWorkspaces()).rejects.toThrow(
      "Kaneo /api/auth/organization/list: socket hang up",
    );
    globalThis.fetch = vi.fn(async () => {
      throw "weird";
    }) as unknown as typeof fetch;
    await expect(client().listWorkspaces()).rejects.toThrow(
      "Kaneo /api/auth/organization/list: weird",
    );
  });

  it("returns the raw text when a successful body is not JSON", async () => {
    stubFetch(() => new Response("OK"));
    await expect(client().deleteColumn("c")).resolves.toBe("OK");
  });
});
