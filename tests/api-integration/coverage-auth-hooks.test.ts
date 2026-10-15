import * as email from "@kaneo/email";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as seatSync from "../../apps/api/src/billing/controllers/sync-seats";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { drainPasswordResetDeliveries } from "../../apps/api/src/utils/password-reset-delivery";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

// Better Auth hooks of apps/api/src/auth.ts, exercised through the real
// `/api/auth` routes with real sessions.
const origin = "http://localhost:5173";
const password = "long-password-for-tests";

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return createApp().app.request(`/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: origin, ...headers },
    body: JSON.stringify(body),
  });
}

function cookieOf(response: Response) {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
}

async function signUp(address: string, extra: Record<string, unknown> = {}) {
  const response = await post("/sign-up/email", {
    name: address.split("@")[0],
    email: address,
    password,
    ...extra,
  });
  return response;
}

async function userCount() {
  return (await db.select().from(schema.userTable)).length;
}

beforeEach(async () => {
  await resetTestDatabase();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cloud sign-up abuse protection", () => {
  it("refuses a disposable email domain once the instance has users, and creates nothing", async () => {
    vi.stubEnv("KANEO_CLOUD", "true");
    await createWorkspaceMember();
    const before = await userCount();

    const response = await signUp("burner@dwv.dropmail.me");

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe(
      "Sign-up with disposable email addresses is not allowed.",
    );
    expect(await userCount()).toBe(before);
  });

  it("lets the very first account set the instance up even with a disposable domain", async () => {
    vi.stubEnv("KANEO_CLOUD", "true");

    const response = await signUp("first@dropmail.me");

    expect(response.status).toBe(200);
    expect(await userCount()).toBe(1);
  });

  it("accepts a disposable domain on a self-hosted instance", async () => {
    await createWorkspaceMember();

    const response = await signUp("burner@dropmail.me");

    expect(response.status).toBe(200);
  });
});

describe("cloud invitation abuse protection", () => {
  async function session(address: string) {
    const response = await signUp(address);
    expect(response.status).toBe(200);
    return cookieOf(response);
  }

  async function guestSession() {
    const response = await post("/sign-in/anonymous", {});
    expect(response.status).toBe(200);
    return cookieOf(response);
  }

  const invite = (cookie: string | null, body: Record<string, unknown>) =>
    post("/organization/invite-member", body, cookie ? { Cookie: cookie } : {});

  it("refuses invitations from a guest account and writes none", async () => {
    await createWorkspaceMember();
    vi.stubEnv("KANEO_CLOUD", "true");
    const cookie = await guestSession();

    const response = await invite(cookie, {
      email: "friend@example.com",
      role: "member",
    });

    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe(
      "Guest accounts may not send workspace invitations.",
    );
    expect(await db.select().from(schema.invitationTable)).toEqual([]);
  });

  it("refuses an invitation to a disposable address and writes none", async () => {
    const cookie = await session("inviter@example.com");
    vi.stubEnv("KANEO_CLOUD", "true");

    const response = await invite(cookie, {
      email: "burner@dropmail.me",
      role: "member",
    });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe(
      "Invitations to disposable-email addresses are not allowed.",
    );
    expect(await db.select().from(schema.invitationTable)).toEqual([]);
  });

  it("leaves a request without a session to Better Auth, which answers 401", async () => {
    vi.stubEnv("KANEO_CLOUD", "true");

    const response = await invite(null, {
      email: "friend@example.com",
      role: "member",
    });

    expect(response.status).toBe(401);
  });

  it("does not apply the guest and disposable rules off the cloud", async () => {
    await createWorkspaceMember();
    const guest = await guestSession();

    const response = await invite(guest, {
      email: "burner@dropmail.me",
      role: "member",
    });

    // Better Auth itself refuses (no workspace to invite to), with another message.
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).not.toBe(
      "Guest accounts may not send workspace invitations.",
    );
    expect(body.message).not.toBe(
      "Invitations to disposable-email addresses are not allowed.",
    );
  });
});

describe("invitation re-send pre-check", () => {
  it("answers 401 without a session and 400 for a body without an email", async () => {
    const anonymous = await post("/organization/invite-member", {
      resend: true,
      email: "someone@example.com",
      role: "member",
      organizationId: "w1",
    });
    expect(anonymous.status).toBe(401);

    const signedUp = await signUp("resender@example.com");
    const cookie = cookieOf(signedUp);
    const malformed = await post(
      "/organization/invite-member",
      { resend: true, role: "member" },
      { Cookie: cookie },
    );
    expect(malformed.status).toBe(400);
  });
});

describe("password reset email language", () => {
  beforeEach(() => {
    vi.spyOn(email, "isSmtpConfigured").mockReturnValue(true);
    vi.spyOn(email, "sendPasswordResetEmail").mockResolvedValue();
  });

  it.each([
    ["vi-VN", "Đặt lại mật khẩu Kaneo"],
    ["ja", "Kaneo のパスワードをリセット"],
    ["de-AT", "Kaneo-Passwort zurücksetzen"],
    ["fr", "Reset your Kaneo password"],
  ])("sends the subject for the stored locale %s", async (locale, subject) => {
    const address = `reset-${locale.toLowerCase()}@example.com`;
    expect((await signUp(address, { locale })).status).toBe(200);

    const response = await post("/request-password-reset", {
      email: address,
      redirectTo: `${origin}/auth/reset-password`,
    });
    expect(response.status).toBe(200);
    await drainPasswordResetDeliveries();

    expect(vi.mocked(email.sendPasswordResetEmail).mock.calls.at(-1)?.[1]).toBe(
      subject,
    );
  });
});

describe("account deletion", () => {
  it("removes the account and its sessions through the delete-user route", async () => {
    const signedUp = await signUp("leaver@example.com");
    const cookie = cookieOf(signedUp);
    const { user } = (await signedUp.json()) as { user: { id: string } };

    const response = await post(
      "/delete-user",
      { password },
      { Cookie: cookie },
    );

    expect(response.status).toBe(200);
    expect(
      await db
        .select()
        .from(schema.userTable)
        .where(eq(schema.userTable.id, user.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, user.id)),
    ).toEqual([]);
  });

  it("keeps the account when the password is wrong", async () => {
    const signedUp = await signUp("stayer@example.com");
    const cookie = cookieOf(signedUp);

    const response = await post(
      "/delete-user",
      { password: "not-the-password-at-all" },
      { Cookie: cookie },
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await userCount()).toBe(1);
  });
});

describe("workspace membership hooks", () => {
  it("logs a failed seat sync after a member was added and still adds them", async () => {
    vi.spyOn(seatSync, "syncWorkspaceSeats").mockRejectedValue(
      new Error("creem unavailable"),
    );
    const owner = await createWorkspaceMember({ role: "owner" });
    const other = await createWorkspaceMember();
    const { auth } = await import("../../apps/api/src/auth");

    await auth.api.addMember({
      body: {
        userId: other.user.id,
        organizationId: owner.workspace.id,
        role: "member",
      },
    });

    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "Seat sync after member add failed:",
        expect.any(Error),
      ),
    );
    const members = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, owner.workspace.id));
    expect(members.map((m) => m.userId).sort()).toEqual(
      [owner.user.id, other.user.id].sort(),
    );
  });
});

describe("device authorization client ids", () => {
  const requestCode = (clientId: string) =>
    post("/device/code", { client_id: clientId, scope: "openid" });

  it("accepts only the built-in CLI and MCP clients by default", async () => {
    vi.stubEnv("DEVICE_AUTH_CLIENT_IDS", "");

    for (const clientId of ["kaneo-cli", "kaneo-mcp"]) {
      const response = await requestCode(clientId);
      expect(response.status, clientId).toBe(200);
      expect((await response.json()).device_code).toEqual(expect.any(String));
    }
    const refused = await requestCode("some-other-client");
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe("invalid_client");
  });

  it("replaces the defaults with the configured, trimmed list", async () => {
    vi.stubEnv("DEVICE_AUTH_CLIENT_IDS", " tool-a , tool-b ,, ");

    expect((await requestCode("tool-a")).status).toBe(200);
    expect((await requestCode("tool-b")).status).toBe(200);
    expect((await requestCode("kaneo-cli")).status).toBe(400);
  });
});
