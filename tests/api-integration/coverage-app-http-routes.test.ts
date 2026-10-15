import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serve } from "../../apps/api/node_modules/@hono/node-server";
import type { NodeWebSocket } from "../../apps/api/node_modules/@hono/node-ws";
import { auth } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const { readObject } = vi.hoisted(() => ({
  readObject: vi.fn(),
}));
vi.mock("../../apps/api/src/storage/s3", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPrivateObject: readObject,
}));

beforeEach(async () => {
  await resetTestDatabase();
  readObject.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("instance status route", () => {
  it("reports whether the instance has users and an administrator", async () => {
    const { app } = createApp();
    const empty = await app.request("/api/instance/status");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ hasUsers: false, hasAdmin: false });

    await createWorkspaceMember();
    expect(await (await app.request("/api/instance/status")).json()).toEqual({
      hasUsers: true,
      hasAdmin: false,
    });

    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.name, "Integration Test User"));
    expect(await (await app.request("/api/instance/status")).json()).toEqual({
      hasUsers: true,
      hasAdmin: true,
    });
  });
});

describe("public project route", () => {
  it("rejects malformed pagination with 400 before loading anything", async () => {
    const { app } = createApp();
    mockAnonymousSession();
    const response = await app.request(
      "/api/public-project/some-project?page=not-a-number",
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid task pagination or filters");
  });
});

describe("asset download route", () => {
  async function seedAsset(filename: string, mimeType = "image/png") {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [asset] = await db
      .insert(schema.assetTable)
      .values({
        workspaceId: member.workspace.id,
        projectId: project.id,
        objectKey: randomUUID(),
        filename,
        mimeType,
        size: 3,
        surface: "description",
        createdBy: member.user.id,
      })
      .returning();
    mockAuthenticatedSession(member.user);
    return asset;
  }

  it("returns 404 for an unknown asset id without touching storage", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const response = await createApp().app.request("/api/asset/unknown1");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Asset not found");
    expect(readObject).not.toHaveBeenCalled();
  });

  it("returns 404 and logs when the stored object is missing", async () => {
    const asset = await seedAsset("photo.png");
    readObject.mockRejectedValue(new Error("NoSuchKey"));

    const response = await createApp().app.request(`/api/asset/${asset.id}`);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Asset object not found");
    expect(console.error).toHaveBeenCalledWith(
      "Failed to stream asset:",
      expect.any(Error),
    );
  });

  it("serves a safe image inline using the stored content type without parameters", async () => {
    const asset = await seedAsset("photo.png", "application/octet-stream");
    readObject.mockResolvedValue({
      body: new Uint8Array([1, 2, 3]),
      contentType: "IMAGE/PNG; charset=binary",
      contentLength: 3,
      etag: '"abc"',
      lastModified: new Date("2026-01-02T03:04:05Z"),
    });

    const response = await createApp().app.request(`/api/asset/${asset.id}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="photo.png"; filename*=UTF-8''photo.png`,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("etag")).toBe('"abc"');
    expect(response.headers.get("last-modified")).toBe(
      "Fri, 02 Jan 2026 03:04:05 GMT",
    );
    expect(response.headers.get("cache-control")).toBe("private, max-age=120");
  });

  it.each([
    [
      "image/svg+xml",
      "x.svg",
      `attachment; filename="x.svg"; filename*=UTF-8''x.svg`,
    ],
    [
      "text/html",
      `Résumé (final)*'.pdf`,
      `attachment; filename="Resume (final)*'.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%28final%29%2A%27.pdf`,
    ],
    [
      "application/pdf",
      "日本語.pdf",
      `attachment; filename="_.pdf"; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E.pdf`,
    ],
    [
      "application/pdf",
      `a/b\\c "q".txt`,
      `attachment; filename="a-b-c q.txt"; filename*=UTF-8''a%2Fb%5Cc%20q.txt`,
    ],
    [
      "application/pdf",
      ` "\r\n" `,
      `attachment; filename="file"; filename*=UTF-8''file`,
    ],
  ])(
    "forces download of %s as octet-stream and encodes %j safely",
    async (mime, filename, disposition) => {
      const asset = await seedAsset(filename, mime);
      readObject.mockResolvedValue({
        body: new Uint8Array([1]),
        contentType: mime,
      });

      const response = await createApp().app.request(`/api/asset/${asset.id}`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "application/octet-stream",
      );
      expect(response.headers.get("content-disposition")).toBe(disposition);
    },
  );
});

describe("avatar route", () => {
  it("answers 304 only for the matching ETag and 404 for an unknown avatar", async () => {
    const member = await createWorkspaceMember();
    const [avatar] = await db
      .insert(schema.userAvatarTable)
      .values({
        userId: member.user.id,
        mimeType: "image/png",
        size: 3,
        data: Buffer.from([1, 2, 3]),
      })
      .returning();
    const { app } = createApp();

    const full = await app.request(`/api/user/avatar/${avatar.id}`);
    expect(full.status).toBe(200);
    expect(full.headers.get("etag")).toBe(`"${avatar.id}"`);
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );

    const cached = await app.request(`/api/user/avatar/${avatar.id}`, {
      headers: { "If-None-Match": `"${avatar.id}"` },
    });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");

    const stale = await app.request(`/api/user/avatar/${avatar.id}`, {
      headers: { "If-None-Match": '"other"' },
    });
    expect(stale.status).toBe(200);

    expect((await app.request("/api/user/avatar/nope")).status).toBe(404);
  });
});

describe("device authorization page route", () => {
  it("redirects a forced UI request to the client device screen with the user code", async () => {
    vi.stubEnv("KANEO_CLIENT_URL", "https://kaneo.example.test/");
    const response = await createApp().app.request(
      "/api/auth/device?ui=1&user_code=ABCD-EFGH",
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://kaneo.example.test/device?user_code=ABCD-EFGH",
    );
  });

  it("redirects a top-level navigation without a code and falls back to localhost", async () => {
    vi.stubEnv("KANEO_CLIENT_URL", "");
    const response = await createApp().app.request("/api/auth/device", {
      headers: { "Sec-Fetch-Dest": "document" },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:5173/device",
    );
  });
});

describe("application error handling", () => {
  it("maps an estimate/date-range check violation to the 400 of the validation", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        userId: member.user.id,
        title: "Estimated",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 1,
        position: 1,
        estimateMinutes: 60,
        startDate: new Date("2026-03-02T00:00:00Z"),
      })
      .returning();
    const { app } = createApp();
    app.get("/__violate-estimate", async () => {
      await db
        .update(schema.taskTable)
        .set({ dueDate: new Date("2026-03-05T00:00:00Z") })
        .where(eq(schema.taskTable.id, task.id));
      return new Response("unreachable");
    });
    app.get("/__crash", () => {
      throw new Error("secret internal detail");
    });
    app.get("/__server-error", () => {
      throw new HTTPException(503, { message: "upstream gone" });
    });

    const violation = await app.request("/__violate-estimate");
    expect(violation.status).toBe(400);
    expect(await violation.text()).toBe(
      "A task with an effort estimate cannot have both a start date and a due date. Remove the estimate or clear one of the dates.",
    );
    const [stored] = await db
      .select({ dueDate: schema.taskTable.dueDate })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    expect(stored.dueDate).toBeNull();

    const crash = await app.request("/__crash");
    expect(crash.status).toBe(500);
    expect(await crash.json()).toEqual({ message: "Internal Server Error" });

    const unavailable = await app.request("/__server-error");
    expect(unavailable.status).toBe(503);
  });
});

describe("API authentication middleware", () => {
  it("answers 500 without leaking details when the session lookup itself fails", async () => {
    vi.spyOn(auth.api, "getSession").mockRejectedValue(
      new Error("database down: password=hunter2"),
    );

    const response = await createApp().app.request("/api/user/me");

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("hunter2");
    expect(console.error).toHaveBeenCalledWith(
      "API authentication failed:",
      expect.any(Error),
    );
  });

  it("does not require authentication for the well-known and MCP prefixes", async () => {
    mockAnonymousSession();
    const { app } = createApp();
    const wellKnown = await app.request("/api/.well-known/does-not-exist");
    expect(wellKnown.status).toBe(404);
    const protectedRoute = await app.request("/api/user/me");
    expect(protectedRoute.status).toBe(401);
  });
});

type Socket = NodeWebSocket["wss"]["clients"] extends Set<infer S> ? S : never;
const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const nodeWsRequire = createRequire(apiRequire.resolve("@hono/node-ws"));
const WebSocket: new (
  url: string,
  options: { headers: Record<string, string> },
) => Socket = nodeWsRequire("ws").WebSocket;

describe("WebSocket upgrade routes", () => {
  let server: ReturnType<typeof serve>;
  let baseUrl: string;
  const sockets: Socket[] = [];

  async function connect(path: string) {
    const socket = new WebSocket(`${baseUrl}/api/ws/${path}`, {
      headers: { origin: "http://localhost:5173", cookie: "s=1" },
    });
    sockets.push(socket);
    socket.on("error", () => {});
    return new Promise<number>((resolve) => {
      socket.once("open", () => resolve(101));
      socket.once(
        "unexpected-response",
        (_request: unknown, response: IncomingMessage) => {
          response.resume();
          resolve(response.statusCode ?? 0);
          socket.terminate();
        },
      );
    });
  }

  beforeEach(async () => {
    const created = createApp();
    server = serve({
      fetch: created.app.fetch,
      hostname: "127.0.0.1",
      port: 0,
    });
    created.injectWebSocket(server);
    if (!server.listening) await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    baseUrl = `ws://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it.each(["user", "some-project"])(
    "answers 500 on /ws/%s when the session lookup fails",
    async (path) => {
      vi.spyOn(auth.api, "getSession").mockRejectedValue(new Error("db down"));
      expect(await connect(path)).toBe(500);
      expect(console.error).toHaveBeenCalledWith(
        "API authentication failed:",
        expect.any(Error),
      );
    },
  );

  it("answers 401 for a project that does not exist, like an inaccessible one", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    expect(await connect("missing-project")).toBe(401);
  });
});
