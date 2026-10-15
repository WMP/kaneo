import { afterEach, describe, expect, it, vi } from "vitest";
import { PlankaClient, PlankaHttpError } from "./planka.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

type Seen = { url: string; init: RequestInit; headers: Headers };

function stubFetch(
  responder: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const seen: Seen[] = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    seen.push({
      url: String(url),
      init: init ?? {},
      headers: new Headers(init?.headers),
    });
    return responder(String(url), init ?? {});
  }) as unknown as typeof fetch;
  return seen;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const client = () =>
  new PlankaClient({ baseUrl: "https://planka.example.com/" });

describe("PlankaClient.login", () => {
  it("posts the credentials and uses the returned token as a bearer afterwards", async () => {
    const seen = stubFetch((url) =>
      url.endsWith("/api/access-tokens")
        ? json({ item: "tok-1" })
        : json({ items: [], included: {} }),
    );
    const planka = client();
    expect(planka.isAuthenticated).toBe(false);

    await planka.login("jane@example.test", "pw");
    expect(planka.isAuthenticated).toBe(true);
    expect(seen[0]?.url).toBe("https://planka.example.com/api/access-tokens");
    expect(seen[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({
      emailOrUsername: "jane@example.test",
      password: "pw",
    });
    expect(seen[0]?.headers.get("content-type")).toBe("application/json");
    expect(seen[0]?.headers.get("authorization")).toBeNull();

    await planka.listProjects();
    expect(seen[1]?.headers.get("authorization")).toBe("Bearer tok-1");
    expect(seen[1]?.headers.get("accept")).toBe("application/json");
  });

  it.each([{}, { item: "" }, { item: 5 }])(
    "fails when PLANKA returns no usable token (%j)",
    async (body) => {
      stubFetch(() => new Response(JSON.stringify(body)));
      const planka = client();
      await expect(planka.login("u", "p")).rejects.toThrow(
        "PLANKA did not return an access token. Pass --planka-token instead.",
      );
      expect(planka.isAuthenticated).toBe(false);
    },
  );

  it("characterization: a null/empty login body fails with a TypeError instead of the friendly message", async () => {
    stubFetch(() => new Response("null"));
    await expect(client().login("u", "p")).rejects.toThrow(TypeError);
  });

  it("explains the accept-terms step", async () => {
    stubFetch(() => json({ code: "E_FORBIDDEN", step: "accept-terms" }, 403));
    await expect(client().login("u", "p")).rejects.toThrow(
      /requires you to accept its terms/,
    );
  });

  it("explains the verify-totp step and points to API keys", async () => {
    stubFetch(() => json({ step: "verify-totp" }, 403));
    await expect(client().login("u", "p")).rejects.toThrow(
      /two-factor authentication.*--planka-api-key/,
    );
  });

  it("reports unauthorized credentials with the HTTP status hint", async () => {
    stubFetch(() => json({ message: "Invalid credentials" }, 401));
    await expect(client().login("u", "wrong")).rejects.toThrow(
      "PLANKA /api/access-tokens: unauthorized (HTTP 401), check your PLANKA credentials or token",
    );
  });

  it("falls back to the HTTP error message for a body without a step", async () => {
    stubFetch(() => new Response("plain text", { status: 500 }));
    await expect(client().login("u", "p")).rejects.toThrow(
      "PLANKA /api/access-tokens: plain text",
    );
  });

  it("passes network failures through as plain errors", async () => {
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    await expect(client().login("u", "p")).rejects.toThrow(
      "PLANKA /api/access-tokens: ECONNREFUSED",
    );
  });
});

describe("PlankaClient reads", () => {
  it("defaults missing items and included in listProjects", async () => {
    stubFetch(() => json({}));
    expect(await client().listProjects()).toEqual({ items: [], included: {} });
  });

  it("returns the item and included bundle for a board and encodes the id", async () => {
    const seen = stubFetch(() =>
      json({ item: { id: "b/1", projectId: "p", name: "B", position: 1 } }),
    );
    const bundle = await client().getBoard("b/1");
    expect(seen[0]?.url).toBe("https://planka.example.com/api/boards/b%2F1");
    expect(bundle.item.name).toBe("B");
    expect(bundle.included).toEqual({});
  });

  it("pages through comments, merges users and returns oldest first", async () => {
    const comment = (id: string) => ({
      id,
      cardId: "c1",
      userId: "u1",
      text: id,
      createdAt: null,
    });
    const seen = stubFetch((url) => {
      if (url.endsWith("/comments")) {
        return json({
          items: [comment("m3"), comment("m2")],
          included: { users: [{ id: "u1", name: "A", username: "a" }] },
        });
      }
      if (url.endsWith("beforeId=m2")) {
        return json({
          items: [comment("m1")],
          included: { users: [{ id: "u1", name: "A2", username: "a" }] },
        });
      }
      return json({ items: [] });
    });

    const result = await client().listComments("c1");

    expect(seen.map((s) => s.url)).toEqual([
      "https://planka.example.com/api/cards/c1/comments",
      "https://planka.example.com/api/cards/c1/comments?beforeId=m2",
      "https://planka.example.com/api/cards/c1/comments?beforeId=m1",
    ]);
    expect(result.comments.map((c) => c.id)).toEqual(["m1", "m2", "m3"]);
    expect(result.users).toEqual([{ id: "u1", name: "A2", username: "a" }]);
  });

  it("stops when a page repeats the previous cursor", async () => {
    const seen = stubFetch(() =>
      json({
        items: [{ id: "m1", cardId: "c", userId: null, text: "x" }],
      }),
    );
    const result = await client().listComments("c");
    // second page returns the same oldest id, so the loop ends after it
    expect(seen).toHaveLength(2);
    expect(result.users).toEqual([]);
  });

  it("treats a page without items as the end", async () => {
    stubFetch(() => json({}));
    expect(await client().listComments("c")).toEqual({
      comments: [],
      users: [],
    });
  });
});

describe("PlankaClient errors", () => {
  it("throws PlankaHttpError carrying status and parsed body", async () => {
    stubFetch(() => json({ problem: "Board not found" }, 404));
    const error = await client()
      .getBoard("x")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlankaHttpError);
    expect((error as PlankaHttpError).status).toBe(404);
    expect((error as PlankaHttpError).body).toEqual({
      problem: "Board not found",
    });
    expect((error as PlankaHttpError).name).toBe("PlankaHttpError");
    expect((error as Error).message).toBe(
      "PLANKA /api/boards/x: Board not found",
    );
  });

  it.each([
    [{ message: "m" }, "m"],
    [{ error: "e" }, "e"],
    [{ other: 1 }, "HTTP 500"],
    [{ message: "" }, "HTTP 500"],
  ])("describes body %j as %s", async (body, expected) => {
    stubFetch(() => json(body, 500));
    await expect(client().listProjects()).rejects.toThrow(
      `PLANKA /api/projects: ${expected}`,
    );
  });

  it("truncates long text bodies to 300 characters", async () => {
    stubFetch(() => new Response("x".repeat(400), { status: 502 }));
    await expect(client().listProjects()).rejects.toThrow(
      `PLANKA /api/projects: ${"x".repeat(300)}…`,
    );
  });

  it("uses the HTTP status for an empty error body", async () => {
    stubFetch(() => new Response("", { status: 503 }));
    await expect(client().listProjects()).rejects.toThrow(
      "PLANKA /api/projects: HTTP 503",
    );
  });

  it("wraps non-Error rejections from fetch", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw "offline";
    }) as unknown as typeof fetch;
    await expect(client().listProjects()).rejects.toThrow(
      "PLANKA /api/projects: offline",
    );
  });

  it("characterization: an empty successful body makes listProjects throw a TypeError", async () => {
    stubFetch(() => new Response("", { status: 200 }));
    await expect(client().listProjects()).rejects.toThrow(TypeError);
  });
});
