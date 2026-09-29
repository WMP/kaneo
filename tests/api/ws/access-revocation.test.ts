import type { WSContext } from "hono/ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addConnection,
  closeUserProjectConnections,
  closeUserWorkspaceConnections,
  initializeWebSocketAdapter,
  removeConnection,
  shutdownWebSocketAdapter,
} from "../../../apps/api/src/ws";

const m = vi.hoisted(() => ({
  redis: false,
  publish: vi.fn(),
  on: vi.fn(),
}));
vi.mock("../../../apps/api/src/database", () => ({ default: {}, schema: {} }));
vi.mock("../../../apps/api/src/events", () => ({ subscribeToEvent: vi.fn() }));
vi.mock("../../../apps/api/src/redis", () => ({
  isRedisConfigured: () => m.redis,
  getRedisPub: () => ({ publish: m.publish }),
  getRedisSub: () => ({
    on: m.on,
    off: vi.fn(),
    psubscribe: vi.fn(),
    punsubscribe: vi.fn(),
  }),
  closeRedis: vi.fn(),
}));

const tracked: Array<[string, ReturnType<typeof addConnection>]> = [];
function connect(projectId: string, userId: string, workspaceId = "ws-1") {
  const ws = { send: vi.fn(), close: vi.fn() };
  tracked.push([
    projectId,
    addConnection(
      projectId,
      ws as unknown as WSContext,
      userId,
      `${userId}-window`,
      workspaceId,
    ),
  ]);
  return ws;
}

beforeEach(() => {
  m.redis = false;
  m.publish.mockResolvedValue(1);
});
afterEach(async () => {
  await shutdownWebSocketAdapter();
  for (const [id, conn] of tracked.splice(0)) removeConnection(id, conn);
  vi.clearAllMocks();
});

describe("access revocation without Redis", () => {
  it("closes one user's sockets on one project and leaves the rest", async () => {
    await initializeWebSocketAdapter();
    const target = connect("p1", "alice");
    const otherProject = connect("p2", "alice");
    const otherUser = connect("p1", "bob");
    await closeUserProjectConnections("alice", "p1");
    expect(target.close).toHaveBeenCalledWith(1008, "Project access revoked");
    expect(otherProject.close).not.toHaveBeenCalled();
    expect(otherUser.close).not.toHaveBeenCalled();
  });

  it("works before the adapter is initialised", async () => {
    const target = connect("p1", "alice");
    await expect(
      closeUserProjectConnections("alice", "p1"),
    ).resolves.toBeUndefined();
    expect(target.close).toHaveBeenCalled();
  });
});

describe("access revocation through Redis", () => {
  it("publishes the user id so other instances can close their sockets", async () => {
    m.redis = true;
    await initializeWebSocketAdapter();
    const local = connect("p1", "alice");
    await closeUserProjectConnections("alice", "p1");
    expect(local.close).toHaveBeenCalled();
    expect(m.publish).toHaveBeenCalledWith(
      "kaneo:ws:p1:broadcast",
      JSON.stringify({
        projectId: "p1",
        message: { type: "ACCESS_REVOKED", projectId: "p1", userId: "alice" },
      }),
    );
  });

  it("closes matching sockets when a revocation arrives from another instance", async () => {
    m.redis = true;
    await initializeWebSocketAdapter();
    const target = connect("p1", "alice");
    const otherUser = connect("p1", "bob");
    const handler = m.on.mock.calls[0][1];
    handler(
      "kaneo:ws:*:broadcast",
      "kaneo:ws:p1:broadcast",
      JSON.stringify({
        projectId: "p1",
        message: { type: "ACCESS_REVOKED", projectId: "p1", userId: "alice" },
      }),
    );
    expect(target.close).toHaveBeenCalledWith(1008, "Project access revoked");
    expect(otherUser.close).not.toHaveBeenCalled();
  });

  it("closes every project socket of a user in a workspace when the revocation names the workspace", async () => {
    m.redis = true;
    await initializeWebSocketAdapter();
    const first = connect("p1", "alice");
    const second = connect("p2", "alice");
    const foreign = connect("p9", "alice", "ws-2");
    await closeUserWorkspaceConnections("alice", "ws-1");
    expect(first.close).toHaveBeenCalled();
    expect(second.close).toHaveBeenCalled();
    expect(foreign.close).not.toHaveBeenCalled();
    expect(m.publish).toHaveBeenCalledWith(
      "kaneo:ws::broadcast",
      JSON.stringify({
        projectId: "",
        message: {
          type: "ACCESS_REVOKED",
          projectId: "",
          userId: "alice",
          workspaceId: "ws-1",
        },
      }),
    );

    // The same message arriving from a peer closes the local sockets too.
    const late = connect("p3", "alice");
    const handler = m.on.mock.calls[0][1];
    handler(
      "kaneo:ws:*:broadcast",
      "kaneo:ws::broadcast",
      JSON.stringify({
        projectId: "",
        message: {
          type: "ACCESS_REVOKED",
          projectId: "",
          userId: "alice",
          workspaceId: "ws-1",
        },
      }),
    );
    expect(late.close).toHaveBeenCalled();
  });

  it("closes local sockets even if Redis publication fails", async () => {
    m.redis = true;
    await initializeWebSocketAdapter();
    const target = connect("p1", "alice");
    m.publish.mockRejectedValueOnce(new Error("Redis unavailable"));
    await expect(
      closeUserProjectConnections("alice", "p1"),
    ).resolves.toBeUndefined();
    expect(target.close).toHaveBeenCalled();
  });
});
