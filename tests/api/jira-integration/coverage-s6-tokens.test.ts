import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertJiraEncryptionKey,
  decryptJiraToken,
  type JiraUserTokenRow,
} from "../../../apps/api/src/jira-integration/tokens";
import { encryptSecret } from "../../../apps/api/src/notification-preferences/secrets";

afterEach(() => vi.unstubAllEnvs());

const rowWith = (encryptedToken: string) =>
  ({ encryptedToken }) as JiraUserTokenRow;

async function codeOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    const { status, res } = error as { status: number; res: Response };
    return { status, code: ((await res.json()) as { code: string }).code };
  }
  throw new Error("expected a throw");
}

describe("decryptJiraToken", () => {
  it("returns the token that was encrypted with the configured key", () => {
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "key-one");
    const stored = encryptSecret("jira-pat-123") as string;
    expect(stored).not.toContain("jira-pat-123");
    expect(decryptJiraToken(rowWith(stored))).toBe("jira-pat-123");
  });

  it("refuses a value that is not encrypted, so a plaintext token is never used", async () => {
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "key-one");
    expect(
      await codeOf(() => decryptJiraToken(rowWith("plain-token"))),
    ).toEqual({
      status: 422,
      code: "JIRA_TOKEN_INVALID",
    });
  });

  it("refuses a token encrypted with another key", async () => {
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "key-one");
    const stored = encryptSecret("jira-pat-123") as string;
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "key-two");
    expect(await codeOf(() => decryptJiraToken(rowWith(stored)))).toEqual({
      status: 422,
      code: "JIRA_TOKEN_INVALID",
    });
  });

  it("answers 503 without any key, for both the guard and the decryption", async () => {
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "   ");
    expect(await codeOf(() => assertJiraEncryptionKey())).toEqual({
      status: 503,
      code: "JIRA_ENCRYPTION_KEY_MISSING",
    });
    expect(
      await codeOf(() => decryptJiraToken(rowWith("enc:v1:a.b.c"))),
    ).toEqual({
      status: 503,
      code: "JIRA_ENCRYPTION_KEY_MISSING",
    });
  });
});
