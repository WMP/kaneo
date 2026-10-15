import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  httpIntegration: vi.fn((options: unknown) => ({ name: "http", options })),
  nativeNodeFetchIntegration: vi.fn((options: unknown) => ({
    name: "fetch",
    options,
  })),
}));
const profiling = vi.hoisted(() => ({
  nodeProfilingIntegration: vi.fn(() => ({ name: "profiling" })),
}));

// Both packages are installed under apps/api only, so mock their ES module
// entries by path.
vi.mock(
  "../../../apps/api/node_modules/@sentry/node/build/esm/index.js",
  () => sentry,
);
vi.mock(
  "../../../apps/api/node_modules/@sentry/profiling-node/build/esm/index.js",
  () => profiling,
);

const ENV_KEYS = [
  "SENTRY_DSN",
  "SENTRY_ENVIRONMENT",
  "SENTRY_RELEASE",
  "SENTRY_TRACES_SAMPLE_RATE",
  "SENTRY_PROFILES_SAMPLE_RATE",
  "NODE_ENV",
];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  vi.resetModules();
  sentry.init.mockClear();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.doUnmock("node:fs");
});

async function load() {
  await import("../../../apps/api/src/instrument");
}

describe("Sentry instrumentation", () => {
  it("does not start Sentry without a DSN", async () => {
    await load();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("initializes with the DSN, the repository version as release and no PII", async () => {
    process.env.SENTRY_DSN = "https://key@sentry.example.test/1";
    process.env.NODE_ENV = "staging";

    await load();

    const rootVersion = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ).version;
    expect(typeof rootVersion).toBe("string");
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init.mock.calls[0]?.[0]).toMatchObject({
      dsn: "https://key@sentry.example.test/1",
      environment: "staging",
      release: rootVersion,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      profilesSampleRate: 0,
    });
  });

  it("prefers the explicit environment and release, and defaults the environment to production", async () => {
    process.env.SENTRY_DSN = "https://key@sentry.example.test/1";
    process.env.SENTRY_RELEASE = "kaneo@9.9.9";
    await load();
    expect(sentry.init.mock.calls[0]?.[0]).toMatchObject({
      environment: "production",
      release: "kaneo@9.9.9",
    });

    vi.resetModules();
    sentry.init.mockClear();
    process.env.SENTRY_ENVIRONMENT = "preview";
    process.env.NODE_ENV = "development";
    await load();
    expect(sentry.init.mock.calls[0]?.[0]).toMatchObject({
      environment: "preview",
    });
  });

  it.each([
    ["0.25", 0.25],
    ["1", 1],
    ["0", 0],
    ["1.5", 0],
    ["-0.1", 0],
    ["abc", 0],
    ["", 0],
  ])("reads the sample rate %j as %d", async (raw, expected) => {
    process.env.SENTRY_DSN = "https://key@sentry.example.test/1";
    process.env.SENTRY_TRACES_SAMPLE_RATE = raw;
    process.env.SENTRY_PROFILES_SAMPLE_RATE = raw;

    await load();

    expect(sentry.init.mock.calls[0]?.[0]).toMatchObject({
      tracesSampleRate: expected,
      profilesSampleRate: expected,
    });
  });

  it("keeps credentials out of outgoing-request telemetry through the sensitive-request filter", async () => {
    process.env.SENTRY_DSN = "https://key@sentry.example.test/1";

    await load();

    const [httpOptions] = sentry.httpIntegration.mock.calls.at(-1) as [
      { ignoreOutgoingRequests: unknown },
    ];
    const [fetchOptions] = sentry.nativeNodeFetchIntegration.mock.calls.at(
      -1,
    ) as [{ ignoreOutgoingRequests: unknown }];
    expect(typeof httpOptions.ignoreOutgoingRequests).toBe("function");
    expect(fetchOptions.ignoreOutgoingRequests).toBe(
      httpOptions.ignoreOutgoingRequests,
    );
    expect(sentry.init.mock.calls[0]?.[0].integrations).toHaveLength(3);
  });

  it("still starts when the package version cannot be read", async () => {
    process.env.SENTRY_DSN = "https://key@sentry.example.test/1";
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      readFileSync: () => {
        throw new Error("ENOENT");
      },
    }));

    await load();

    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init.mock.calls[0]?.[0].release).toBeUndefined();
  });
});
