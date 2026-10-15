import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getDefaultGiteaConfig,
  normalizeGiteaBaseUrl,
  validateGiteaConfig,
} from "../../../apps/api/src/plugins/gitea/config";
import { repoOwnerLogin } from "../../../apps/api/src/plugins/gitea/services/integration-lookup";
import {
  extractTaskNumberFromBranchGitea,
  extractTaskNumberGitea,
} from "../../../apps/api/src/plugins/gitea/utils/branch-matcher";
import {
  OUTBOUND_STATE_ECHO_WINDOW_MS,
  parseIssueUpdatedAtMs,
} from "../../../apps/api/src/plugins/gitea/utils/outbound-echo";
import { isSystemLabelName } from "../../../apps/api/src/plugins/gitea/utils/system-labels";
import { verifyGiteaSignature } from "../../../apps/api/src/plugins/gitea/utils/verify-signature";
import { baseUrlFromRepositoryHtmlUrl } from "../../../apps/api/src/plugins/gitea/utils/webhook-repo";

const hmac = (body: string, secret: string) =>
  createHmac("sha256", secret).update(body).digest("hex");

describe("verifyGiteaSignature", () => {
  const body = '{"a":1}';
  // Hand-checked HMAC-SHA256 of '{"a":1}' with key "k" is computed by node:crypto
  // here only to build the fixture; acceptance rules are asserted literally.
  const good = hmac(body, "k");

  it("accepts the hex digest, with or without a case-insensitive sha256= prefix and surrounding spaces", () => {
    expect(verifyGiteaSignature(body, "k", good)).toBe(true);
    expect(verifyGiteaSignature(body, "k", `sha256=${good}`)).toBe(true);
    expect(verifyGiteaSignature(body, "k", `SHA256=${good}`)).toBe(true);
    expect(verifyGiteaSignature(body, "k", `  ${good}  `)).toBe(true);
    expect(verifyGiteaSignature(body, "k", good.toUpperCase())).toBe(true);
  });

  it("rejects missing, empty, wrong, truncated and non-hex signatures", () => {
    expect(verifyGiteaSignature(body, "k", undefined)).toBe(false);
    expect(verifyGiteaSignature(body, "k", "")).toBe(false);
    expect(verifyGiteaSignature(body, "", good)).toBe(false);
    expect(verifyGiteaSignature(body, "other", good)).toBe(false);
    expect(verifyGiteaSignature(`${body} `, "k", good)).toBe(false);
    expect(verifyGiteaSignature(body, "k", good.slice(0, -2))).toBe(false);
    expect(verifyGiteaSignature(body, "k", `${good}00`)).toBe(false);
    expect(verifyGiteaSignature(body, "k", "zz".repeat(32))).toBe(false);
    expect(verifyGiteaSignature(body, "k", `sha1=${good}`)).toBe(false);
  });
});

describe("outbound echo helpers", () => {
  it("uses a five second window", () => {
    expect(OUTBOUND_STATE_ECHO_WINDOW_MS).toBe(5000);
  });

  it("parses updated_at and rejects missing or invalid values", () => {
    expect(parseIssueUpdatedAtMs({ updated_at: "2026-01-01T00:00:00Z" })).toBe(
      Date.UTC(2026, 0, 1),
    );
    expect(parseIssueUpdatedAtMs({})).toBeNull();
    expect(parseIssueUpdatedAtMs({ updated_at: "" })).toBeNull();
    expect(parseIssueUpdatedAtMs({ updated_at: "garbage" })).toBeNull();
    expect(
      parseIssueUpdatedAtMs({ updated_at: 5 as unknown as string }),
    ).toBeNull();
  });
});

describe("baseUrlFromRepositoryHtmlUrl", () => {
  it("strips the owner/repo segments and keeps a sub-path install", () => {
    expect(baseUrlFromRepositoryHtmlUrl("https://gitea.example/o/r")).toBe(
      "https://gitea.example",
    );
    expect(baseUrlFromRepositoryHtmlUrl("https://gitea.example/git/o/r/")).toBe(
      "https://gitea.example/git",
    );
    expect(baseUrlFromRepositoryHtmlUrl("http://host:3000/a/b/o/r")).toBe(
      "http://host:3000/a/b",
    );
  });

  it("returns an empty string for unusable URLs", () => {
    expect(baseUrlFromRepositoryHtmlUrl("not a url")).toBe("");
    expect(baseUrlFromRepositoryHtmlUrl("https://gitea.example/only")).toBe("");
    expect(baseUrlFromRepositoryHtmlUrl("https://gitea.example/")).toBe("");
    expect(baseUrlFromRepositoryHtmlUrl("ftp://gitea.example/o/r")).toBe("");
  });
});

describe("repoOwnerLogin", () => {
  it("prefers login, then username, then empty", () => {
    expect(repoOwnerLogin({ owner: { login: "a", username: "b" } })).toBe("a");
    expect(repoOwnerLogin({ owner: { username: "b" } })).toBe("b");
    expect(repoOwnerLogin({ owner: {} })).toBe("");
    expect(repoOwnerLogin({})).toBe("");
  });
});

describe("isSystemLabelName", () => {
  it("recognises only priority: and status: prefixes", () => {
    expect(isSystemLabelName("priority:high")).toBe(true);
    expect(isSystemLabelName("status:done")).toBe(true);
    expect(isSystemLabelName("my priority:high")).toBe(false);
    expect(isSystemLabelName("bug")).toBe(false);
  });
});

describe("gitea config", () => {
  const valid = {
    baseUrl: "https://gitea.example",
    accessToken: "t",
    repositoryOwner: "o",
    repositoryName: "r",
  };

  it("validates a minimal config and reports one message per problem", async () => {
    expect(await validateGiteaConfig(valid)).toEqual({ valid: true });
    const bad = await validateGiteaConfig({
      baseUrl: "nope",
      accessToken: "  ",
      repositoryOwner: "",
      repositoryName: "r",
    });
    expect(bad.valid).toBe(false);
    expect(bad.errors).toHaveLength(3);
    expect((await validateGiteaConfig(null)).valid).toBe(false);
  });

  it("builds the default config with a normalized URL and the documented defaults", () => {
    expect(
      getDefaultGiteaConfig("https://gitea.example/", "tok", "o", "r", "sec"),
    ).toEqual({
      baseUrl: "https://gitea.example",
      accessToken: "tok",
      repositoryOwner: "o",
      repositoryName: "r",
      webhookSecret: "sec",
      branchPattern: "{slug}-{number}",
      commentTaskLinkOnGiteaIssue: true,
      statusTransitions: {
        onBranchPush: "in-progress",
        onPROpen: "in-review",
        onPRMerge: "done",
      },
    });
  });

  it("normalizes trailing slashes and keeps the port", () => {
    expect(normalizeGiteaBaseUrl(" http://h:3000/// ")).toBe("http://h:3000");
  });
});

describe("gitea branch matcher wrappers", () => {
  const config = {
    baseUrl: "https://gitea.example",
    accessToken: "t",
    repositoryOwner: "o",
    repositoryName: "r",
  };

  it("extracts the task number from branch names, titles and bodies", () => {
    expect(extractTaskNumberFromBranchGitea("kan-12-fix", config, "kan")).toBe(
      12,
    );
    expect(extractTaskNumberFromBranchGitea("other-12", config, "kan")).toBe(
      null,
    );
    expect(
      extractTaskNumberGitea(
        "feature",
        "KAN-7 does things",
        undefined,
        config,
        "kan",
      ),
    ).toBe(7);
    expect(
      extractTaskNumberGitea("kan-3-x", "title", "body", config, "kan"),
    ).toBe(3);
  });
});
