import { afterEach, describe, expect, it, vi } from "vitest";
import {
  creemApiBaseUrl,
  creemApiKey,
  creemWebhookSecret,
} from "../../../apps/api/src/billing/config";

afterEach(() => vi.unstubAllEnvs());

describe("Creem environment readers", () => {
  it("selects the sandbox host only in test mode", () => {
    vi.stubEnv("CREEM_TEST_MODE", "true");
    expect(creemApiBaseUrl()).toBe("https://test-api.creem.io");
    vi.stubEnv("CREEM_TEST_MODE", "false");
    expect(creemApiBaseUrl()).toBe("https://api.creem.io");
    vi.stubEnv("CREEM_TEST_MODE", "");
    expect(creemApiBaseUrl()).toBe("https://api.creem.io");
  });

  it("reads the key and webhook secret, and is empty when they are unset", () => {
    vi.stubEnv("CREEM_API_KEY", "key-1");
    vi.stubEnv("CREEM_WEBHOOK_SECRET", "whsec-1");
    expect(creemApiKey()).toBe("key-1");
    expect(creemWebhookSecret()).toBe("whsec-1");
    vi.unstubAllEnvs();
    delete process.env.CREEM_API_KEY;
    delete process.env.CREEM_WEBHOOK_SECRET;
    expect(creemApiKey()).toBe("");
    expect(creemWebhookSecret()).toBe("");
  });
});
