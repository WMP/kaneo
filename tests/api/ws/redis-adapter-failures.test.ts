import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/events", () => ({
  subscribeToEvent: vi.fn(),
  publishEvent: vi.fn(),
}));

type PMessage = (pattern: string, channel: string, data: string) => void;

const redis = vi.hoisted(() => ({
  publish: vi.fn(),
  listeners: [] as PMessage[],
  psubscribe: vi.fn(),
  punsubscribe: vi.fn(),
}));

const subscriber = {
  psubscribe: redis.psubscribe,
  punsubscribe: redis.punsubscribe,
  on: (event: string, fn: PMessage) => {
    if (event === "pmessage") redis.listeners.push(fn);
  },
  off: (_event: string, fn: PMessage) => {
    const index = redis.listeners.indexOf(fn);
    if (index >= 0) redis.listeners.splice(index, 1);
  },
};

vi.mock("../../../apps/api/src/redis", () => ({
  isRedisConfigured: () => true,
  getRedisPub: () => ({ publish: redis.publish }),
  getRedisSub: () => subscriber,
  closeRedis: vi.fn().mockResolvedValue(undefined),
}));

import {
  addUserConnection,
  broadcastToProject,
  broadcastToUser,
  initializeWebSocketAdapter,
  removeUserConnection,
  shutdownWebSocketAdapter,
} from "../../../apps/api/src/ws/index";
import { RedisBroadcastAdapter } from "../../../apps/api/src/ws/redis-broadcast-adapter";

const PROJECT_PATTERN = "kaneo:ws:*:broadcast";
const USER_PATTERN = "kaneo:ws-user:*:broadcast";

function fakeWs(send: () => void = () => {}) {
  return {
    send: vi.fn(send),
    close: vi.fn(),
    readyState: 1,
    raw: undefined,
    url: null,
    protocol: null,
  } as never;
}

function emit(pattern: string, channel: string, data: string) {
  for (const listener of [...redis.listeners]) listener(pattern, channel, data);
}

beforeEach(() => {
  redis.publish.mockReset().mockResolvedValue(1);
  redis.psubscribe.mockReset().mockResolvedValue(undefined);
  redis.punsubscribe.mockReset().mockResolvedValue(undefined);
  redis.listeners.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  await shutdownWebSocketAdapter();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RedisBroadcastAdapter with malformed or failing messages", () => {
  async function subscribed() {
    const adapter = new RedisBroadcastAdapter();
    const projectHandler = vi.fn();
    const userHandler = vi.fn();
    await adapter.subscribe(projectHandler);
    await adapter.subscribeToUser(userHandler);
    return { adapter, projectHandler, userHandler };
  }

  it("drops unparsable and invalid project messages with a log line and never calls the handler", async () => {
    const { projectHandler } = await subscribed();

    emit(PROJECT_PATTERN, "kaneo:ws:p1:broadcast", "{not json");
    emit(
      PROJECT_PATTERN,
      "kaneo:ws:p1:broadcast",
      JSON.stringify({ projectId: 7, message: {} }),
    );
    // A message for another pattern is not ours.
    emit(
      "other:*",
      "other:p1",
      JSON.stringify({
        projectId: "p1",
        message: { type: "x", projectId: "p1" },
      }),
    );

    expect(projectHandler).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "Failed to parse broadcast message:",
      expect.any(Error),
    );
    expect(console.error).toHaveBeenCalledWith(
      "Invalid broadcast message:",
      expect.any(Array),
    );
  });

  it("logs a delivery failure of a valid project message", async () => {
    const adapter = new RedisBroadcastAdapter();
    await adapter.subscribe(async () => {
      throw new Error("delivery failed");
    });

    emit(
      PROJECT_PATTERN,
      "kaneo:ws:p1:broadcast",
      JSON.stringify({
        projectId: "p1",
        message: { type: "TASK_UPDATED", projectId: "p1" },
      }),
    );
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "Failed to deliver project broadcast:",
        expect.objectContaining({ message: "delivery failed" }),
      ),
    );
  });

  it("drops unparsable and invalid user messages and ones for another pattern", async () => {
    const { userHandler } = await subscribed();

    emit(USER_PATTERN, "kaneo:ws-user:u1:broadcast", "][");
    emit(
      USER_PATTERN,
      "kaneo:ws-user:u1:broadcast",
      JSON.stringify({ userId: "u1", message: { noType: true } }),
    );
    emit(
      "other:*",
      "kaneo:ws-user:u1:broadcast",
      JSON.stringify({ userId: "u1", message: { type: "X" } }),
    );

    expect(userHandler).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "Failed to parse user broadcast message:",
      expect.any(Error),
    );
    expect(console.error).toHaveBeenCalledWith(
      "Invalid user broadcast message:",
      expect.any(Array),
    );
  });
});

describe("ws module delivery failures", () => {
  it("drops a user socket whose send throws and stops delivering to it", async () => {
    await initializeWebSocketAdapter();
    const broken = fakeWs(() => {
      throw new Error("socket closed");
    });
    const healthy = fakeWs();
    addUserConnection("u1", broken);
    const keep = addUserConnection("u1", healthy);

    emit(
      USER_PATTERN,
      "kaneo:ws-user:u1:broadcast",
      JSON.stringify({
        userId: "u1",
        message: { type: "N" },
        origin: "other-instance",
      }),
    );
    emit(
      USER_PATTERN,
      "kaneo:ws-user:u1:broadcast",
      JSON.stringify({
        userId: "u1",
        message: { type: "N" },
        origin: "other-instance",
      }),
    );

    expect(
      (broken as unknown as { send: ReturnType<typeof vi.fn> }).send,
    ).toHaveBeenCalledTimes(1);
    expect(
      (healthy as unknown as { send: ReturnType<typeof vi.fn> }).send,
    ).toHaveBeenCalledTimes(2);
    removeUserConnection("u1", keep);
  });

  it("forgets a user whose only socket failed", async () => {
    await initializeWebSocketAdapter();
    const broken = fakeWs(() => {
      throw new Error("socket closed");
    });
    addUserConnection("u2", broken);

    broadcastToUser("u2", { type: "N" });
    broadcastToUser("u2", { type: "N" });

    expect(
      (broken as unknown as { send: ReturnType<typeof vi.fn> }).send,
    ).toHaveBeenCalledTimes(1);
  });

  it("logs a failed publish of a batched project broadcast", async () => {
    vi.useFakeTimers();
    await initializeWebSocketAdapter();
    redis.publish.mockRejectedValue(new Error("redis is down"));

    broadcastToProject("p9", { type: "TASK_UPDATED", projectId: "p9" });
    await vi.advanceTimersByTimeAsync(150);

    expect(console.error).toHaveBeenCalledWith(
      "Failed to publish broadcast for project p9:",
      expect.objectContaining({ message: "redis is down" }),
    );
  });

  it("publishes queued broadcasts on shutdown instead of losing them", async () => {
    vi.useFakeTimers();
    await initializeWebSocketAdapter();

    broadcastToProject("p10", { type: "TASK_UPDATED", projectId: "p10" });
    expect(redis.publish).not.toHaveBeenCalled();
    await shutdownWebSocketAdapter();

    expect(redis.publish).toHaveBeenCalledTimes(1);
    expect(redis.publish.mock.calls[0]?.[0]).toBe("kaneo:ws:p10:broadcast");
    expect(JSON.parse(redis.publish.mock.calls[0]?.[1])).toMatchObject({
      projectId: "p10",
      message: { type: "TASK_UPDATED", projectId: "p10" },
    });
  });

  it("shuts the adapter down and reports the error when subscribing fails, so a later start can retry", async () => {
    redis.psubscribe.mockRejectedValueOnce(new Error("redis unreachable"));

    await expect(initializeWebSocketAdapter()).rejects.toThrow(
      "redis unreachable",
    );
    expect(redis.punsubscribe).toHaveBeenCalled();

    redis.punsubscribe.mockClear();
    await expect(initializeWebSocketAdapter()).resolves.toBeUndefined();
    await shutdownWebSocketAdapter();
    expect(redis.punsubscribe).toHaveBeenCalled();
  });
});
