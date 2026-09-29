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
vi.mock("../../../apps/api/src/database", () => ({
  default: {
    // The delivery path looks up the project's workspace.
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ workspaceId: "ws-1" }] }),
      }),
    }),
  },
  schema: {},
}));
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

// The Redis subscriber callback the adapter registered.
function redisHandler() {
  return m.on.mock.calls[0][1] as (
    pattern: string,
    channel: string,
    data: string,
  ) => void;
}
function receive(envelope: unknown, channel = "kaneo:ws:p1:broadcast") {
  redisHandler()("kaneo:ws:*:broadcast", channel, JSON.stringify(envelope));
}
function published(index = 0) {
  const [channel, data] = m.publish.mock.calls[index];
  return { channel, envelope: JSON.parse(data as string) };
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
    expect(target.close).toHaveBeenCalledTimes(1);
    expect(target.close).toHaveBeenCalledWith(1008, "Project access revoked");
    expect(otherProject.close).not.toHaveBeenCalled();
    expect(otherUser.close).not.toHaveBeenCalled();
    // Control messages are not client payloads: nothing is ever sent.
    expect(target.send).not.toHaveBeenCalled();
    expect(otherUser.send).not.toHaveBeenCalled();
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
  it("publishes a control envelope, apart from the client payload, naming the issuing instance", async () => {
    m.redis = true;
    await initializeWebSocketAdapter();
    const local = connect("p1", "alice");
    await closeUserProjectConnections("alice", "p1");
    expect(local.close).toHaveBeenCalledTimes(1);
    const { channel, envelope } = published();
    expect(channel).toBe("kaneo:ws:p1:broadcast");
    expect(envelope).toEqual({
      projectId: "p1",
      control: {
        kind: "access-revoked",
        userId: "alice",
        origin: expect.any(String),
      },
    });
    expect(envelope).not.toHaveProperty("message");
  });

  it("ignores its own echo but applies a peer's message", async () => {
    m.redis = true;
    await initializeWebSocketAdapter();
    connect("p1", "alice");
    await closeUserProjectConnections("alice", "p1");
    const { envelope } = published();

    // A socket opened after the local pass survives the echo of our own message.
    const late = connect("p1", "alice");
    receive(envelope);
    expect(late.close).not.toHaveBeenCalled();

    // The same instruction from another instance closes it.
    receive({
      projectId: "p1",
      control: { ...envelope.control, origin: "another-instance" },
    });
    expect(late.close).toHaveBeenCalledWith(1008, "Project access revoked");
  });

  it("closes only the named user's sockets for a peer's message", async () => {
    m.redis = true;
    await initializeWebSocketAdapter();
    const target = connect("p1", "alice");
    const otherUser = connect("p1", "bob");
    receive({
      projectId: "p1",
      control: {
        kind: "access-revoked",
        userId: "alice",
        origin: "another-instance",
      },
    });
    expect(target.close).toHaveBeenCalledWith(1008, "Project access revoked");
    expect(otherUser.close).not.toHaveBeenCalled();
  });

  it("closes every project socket of a user in a workspace when the control names the workspace", async () => {
    m.redis = true;
    await initializeWebSocketAdapter();
    const first = connect("p1", "alice");
    const second = connect("p2", "alice");
    const foreign = connect("p9", "alice", "ws-2");
    await closeUserWorkspaceConnections("alice", "ws-1");
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(foreign.close).not.toHaveBeenCalled();
    const { channel, envelope } = published();
    expect(channel).toBe("kaneo:ws::broadcast");
    expect(envelope.projectId).toBe("");
    expect(envelope.control).toMatchObject({
      kind: "access-revoked",
      userId: "alice",
      workspaceId: "ws-1",
    });

    const late = connect("p3", "alice");
    receive(
      {
        projectId: "",
        control: { ...envelope.control, origin: "another-instance" },
      },
      "kaneo:ws::broadcast",
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

  it("strips control-like fields from a client message that arrives through Redis", async () => {
    m.redis = true;
    await initializeWebSocketAdapter();
    const socket = connect("p1", "alice");
    // A fresh socket is not revalidated, so no access lookup is needed here.
    receive({
      projectId: "p1",
      message: {
        type: "TASK_UPDATED",
        projectId: "p1",
        taskId: "t1",
        userId: "alice",
        workspaceId: "ws-1",
      },
    });
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled());
    expect(JSON.parse(socket.send.mock.calls[0][0] as string)).toEqual({
      type: "TASK_UPDATED",
      projectId: "p1",
      taskId: "t1",
    });
  });
});
