import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => {
  class FakeClient {
    static instances: FakeClient[] = [];
    handlers = new Map<string, (error: Error) => void>();
    quit = vi.fn(async () => "OK");
    constructor(
      public readonly arg: unknown,
      public readonly options?: unknown,
    ) {
      FakeClient.instances.push(this);
    }
    on(event: string, handler: (error: Error) => void) {
      this.handlers.set(event, handler);
      return this;
    }
  }
  class FakeCluster extends FakeClient {
    static clusters: FakeCluster[] = [];
    constructor(nodes: unknown, options?: unknown) {
      super(nodes, options);
      FakeCluster.clusters.push(this);
    }
  }
  return Object.assign(FakeClient, { Cluster: FakeCluster });
});

// ioredis is installed under apps/api only (not resolvable from tests/), so
// mock the module file that the source resolves.
vi.mock("../../../apps/api/node_modules/ioredis/built/index.js", () => ({
  default: redis,
  Cluster: redis.Cluster,
}));

import {
  closeRedis,
  getRedisPub,
  getRedisSub,
  isRedisConfigured,
} from "../../../apps/api/src/redis/index";

const saved = { ...process.env };

beforeEach(() => {
  for (const key of [
    "REDIS_URL",
    "REDIS_SENTINELS",
    "REDIS_CLUSTER_NODES",
    "REDIS_PASSWORD",
    "REDIS_SENTINEL_MASTER_NAME",
    "REDIS_SENTINEL_PASSWORD",
    "REDIS_SENTINEL_TLS",
  ]) {
    delete process.env[key];
  }
  redis.instances.length = 0;
  redis.Cluster.clusters.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await closeRedis();
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe("isRedisConfigured", () => {
  it("is false without any Redis variable and true for each of the three", () => {
    expect(isRedisConfigured()).toBe(false);
    for (const key of ["REDIS_URL", "REDIS_SENTINELS", "REDIS_CLUSTER_NODES"]) {
      process.env[key] = "x:1";
      expect(isRedisConfigured()).toBe(true);
      delete process.env[key];
    }
  });
});

describe("Redis client creation", () => {
  it("connects to the URL in standalone mode and reuses one client per role", () => {
    process.env.REDIS_URL = "redis://cache.internal:6380/2";

    const pub = getRedisPub();
    const sub = getRedisSub();

    expect(pub).not.toBe(sub);
    expect(getRedisPub()).toBe(pub);
    expect(getRedisSub()).toBe(sub);
    expect(redis.instances.map((client) => client.arg)).toEqual([
      "redis://cache.internal:6380/2",
      "redis://cache.internal:6380/2",
    ]);
  });

  it("builds a cluster client with the password and a capped retry delay", () => {
    process.env.REDIS_CLUSTER_NODES = "node-1:7000,node-2";
    process.env.REDIS_PASSWORD = "s3cret";

    getRedisPub();

    const [cluster] = redis.Cluster.clusters;
    expect(cluster.arg).toEqual([
      { host: "node-1", port: 7000 },
      { host: "node-2", port: 6379 },
    ]);
    const options = cluster.options as {
      redisOptions: { password: string };
      clusterRetryStrategy: (times: number) => number;
    };
    expect(options.redisOptions).toEqual({ password: "s3cret" });
    expect(options.clusterRetryStrategy(1)).toBe(100);
    expect(options.clusterRetryStrategy(10)).toBe(1000);
    expect(options.clusterRetryStrategy(30)).toBe(3000);
    expect(options.clusterRetryStrategy(500)).toBe(3000);
  });

  it("builds a sentinel client with the master name, passwords and TLS flag", () => {
    process.env.REDIS_SENTINELS = "s1:26380,s2";
    process.env.REDIS_SENTINEL_MASTER_NAME = "primary";
    process.env.REDIS_PASSWORD = "data-pw";
    process.env.REDIS_SENTINEL_PASSWORD = "sentinel-pw";
    process.env.REDIS_SENTINEL_TLS = "true";

    getRedisSub();

    expect(redis.instances[0].arg).toEqual({
      sentinels: [
        { host: "s1", port: 26380 },
        { host: "s2", port: 26379 },
      ],
      name: "primary",
      password: "data-pw",
      sentinelPassword: "sentinel-pw",
      enableTLSForSentinelMode: true,
    });
  });

  it("defaults the sentinel master name and keeps TLS off unless it is exactly true", () => {
    process.env.REDIS_SENTINELS = "s1";
    process.env.REDIS_SENTINEL_TLS = "yes";

    getRedisPub();

    expect(redis.instances[0].arg).toMatchObject({
      name: "mymaster",
      enableTLSForSentinelMode: false,
    });
  });

  it("fails clearly when no Redis variable is set", () => {
    expect(() => getRedisPub()).toThrow(
      "REDIS_URL, REDIS_SENTINELS, or REDIS_CLUSTER_NODES must be set",
    );
    expect(redis.instances).toHaveLength(0);
  });

  it("logs pub and sub client errors with their role instead of crashing", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const pub = redis.instances.length;
    getRedisPub();
    getRedisSub();
    const [pubClient, subClient] = redis.instances.slice(pub);
    const error = new Error("ECONNREFUSED");

    pubClient.handlers.get("error")?.(error);
    subClient.handlers.get("error")?.(error);

    expect(console.error).toHaveBeenCalledWith(
      "Redis pub client error:",
      error,
    );
    expect(console.error).toHaveBeenCalledWith(
      "Redis sub client error:",
      error,
    );
  });
});

describe("closeRedis", () => {
  it("quits both clients, forgets them and tolerates a second call", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const pub = getRedisPub();
    const sub = getRedisSub();

    await closeRedis();

    expect(pub.quit).toHaveBeenCalledTimes(1);
    expect(sub.quit).toHaveBeenCalledTimes(1);
    await closeRedis();
    expect(pub.quit).toHaveBeenCalledTimes(1);
    expect(getRedisPub()).not.toBe(pub);
  });

  it("does nothing when no client was created", async () => {
    await expect(closeRedis()).resolves.toBeUndefined();
  });
});
