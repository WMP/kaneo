import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  checkRegistrationAllowed,
  getInvitationDetails,
} from "../../apps/api/src/utils/check-registration-allowed";
import { verifyApiKey } from "../../apps/api/src/utils/verify-api-key";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

describe("verifyApiKey stored permissions", () => {
  async function storeKey(
    userId: string,
    rawKey: string,
    permissions: string | null,
  ) {
    await db.insert(schema.apikeyTable).values({
      referenceId: userId,
      userId,
      key: createHash("sha256").update(rawKey).digest("base64url"),
      name: "scoped",
      start: rawKey.slice(0, 6),
      prefix: "kaneo",
      permissions,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it("treats a key without stored permissions as unrestricted and reads valid scopes as written", async () => {
    const { user } = await createWorkspaceMember();
    await storeKey(user.id, "kaneo_unrestricted_key", null);
    await storeKey(
      user.id,
      "kaneo_scoped_key",
      JSON.stringify({ task: ["read"], label: [] }),
    );

    const unrestricted = await verifyApiKey("kaneo_unrestricted_key");
    const scoped = await verifyApiKey("kaneo_scoped_key");

    expect(unrestricted?.key.permissions).toBeNull();
    expect(scoped?.key.permissions).toEqual({ task: ["read"], label: [] });
    expect(scoped?.key.userId).toBe(user.id);
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["a JSON array", '["task:read"]'],
    ["a JSON string", '"task"'],
    ["JSON null", "null"],
    ["a resource whose actions are not a list", '{"task":"read"}'],
    ["an action that is not text", '{"task":["read",7]}'],
  ])(
    "denies everything (empty scope, never unrestricted) for %s",
    async (_name, stored) => {
      const { user } = await createWorkspaceMember();
      await storeKey(user.id, "kaneo_broken_scope", stored);

      const result = await verifyApiKey("kaneo_broken_scope");

      expect(result?.valid).toBe(true);
      expect(result?.key.permissions).toEqual({});
    },
  );

  it("rejects an unknown key, a disabled key, an expired key and a key of a deleted user", async () => {
    const { user } = await createWorkspaceMember();
    await storeKey(user.id, "kaneo_disabled", null);
    await storeKey(user.id, "kaneo_expired", null);
    await storeKey(user.id, "kaneo_ok", null);
    const hash = (raw: string) =>
      createHash("sha256").update(raw).digest("base64url");
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.apikeyTable)
      .set({ enabled: false })
      .where(eq(schema.apikeyTable.key, hash("kaneo_disabled")));
    await db
      .update(schema.apikeyTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.apikeyTable.key, hash("kaneo_expired")));

    expect(await verifyApiKey("kaneo_unknown")).toBeNull();
    expect(await verifyApiKey("kaneo_disabled")).toBeNull();
    expect(await verifyApiKey("kaneo_expired")).toBeNull();
    expect((await verifyApiKey("kaneo_ok"))?.valid).toBe(true);

    await db.delete(schema.userTable).where(eq(schema.userTable.id, user.id));
    expect(await verifyApiKey("kaneo_ok")).toBeNull();
  });
});

describe("registration by invitation", () => {
  async function invitation(
    overrides: Partial<typeof schema.invitationTable.$inferInsert> = {},
  ) {
    const inviter = await createWorkspaceMember({ role: "owner" });
    const [row] = await db
      .insert(schema.invitationTable)
      .values({
        email: "invitee@example.com",
        workspaceId: inviter.workspace.id,
        inviterId: inviter.user.id,
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 60_000),
        ...overrides,
      })
      .returning();
    return row;
  }

  it("describes a pending invitation and refuses accepted, canceled, expired and unknown ones with the right message", async () => {
    const pending = await invitation();
    const accepted = await invitation({
      status: "accepted",
      email: "a@example.com",
    });
    const canceled = await invitation({
      status: "canceled",
      email: "c@example.com",
    });
    const expired = await invitation({
      email: "e@example.com",
      expiresAt: new Date(Date.now() - 60_000),
    });

    const valid = await getInvitationDetails(pending.id);
    expect(valid.valid).toBe(true);
    expect(valid.invitation).toMatchObject({
      email: "invitee@example.com",
      status: "pending",
      expired: false,
    });

    const acceptedResult = await getInvitationDetails(accepted.id);
    expect(acceptedResult).toEqual({
      valid: false,
      error: "This invitation has already been accepted",
    });
    expect(await getInvitationDetails(canceled.id)).toEqual({
      valid: false,
      error: "This invitation has been canceled",
    });
    const expiredResult = await getInvitationDetails(expired.id);
    expect(expiredResult.valid).toBe(false);
    expect(expiredResult.error).toBe("This invitation has expired");
    expect(expiredResult.invitation?.expired).toBe(true);
    expect(await getInvitationDetails("missing")).toEqual({
      valid: false,
      error: "Invitation not found",
    });
  });

  describe("with registration disabled", () => {
    beforeEach(() => {
      process.env.DISABLE_REGISTRATION = "true";
      return () => {
        delete process.env.DISABLE_REGISTRATION;
      };
    });

    it("allows an invitation id that is pending and not expired, and nothing else", async () => {
      const ok = await invitation();
      const expired = await invitation({
        email: "late@example.com",
        expiresAt: new Date(Date.now() - 1000),
      });
      const canceled = await invitation({
        email: "gone@example.com",
        status: "canceled",
      });

      const allowed = await checkRegistrationAllowed(
        "invitee@example.com",
        ok.id,
      );
      expect(allowed.allowed).toBe(true);
      expect(allowed.invitation?.id).toBe(ok.id);
      // An invitation is bound to its address: another email cannot use it.
      expect(
        (await checkRegistrationAllowed("any@example.com", ok.id)).allowed,
      ).toBe(false);

      for (const row of [expired, canceled]) {
        const refused = await checkRegistrationAllowed(undefined, row.id);
        expect(refused.allowed).toBe(false);
        expect(refused.reason).toBe(
          "Registration is currently disabled. You need a valid invitation to create an account.",
        );
      }
      expect((await checkRegistrationAllowed(undefined, "nope")).allowed).toBe(
        false,
      );
      expect(
        (await checkRegistrationAllowed("invitee@example.com")).reason,
      ).toBe(
        "Registration is currently disabled. Please use a valid invitation link to create an account.",
      );
    });

    it("matches an invitation by email only for a verified address when the caller allows it, ignoring case", async () => {
      await invitation({ email: "invitee@example.com" });
      const byEmail = (
        emailVerified?: boolean,
        address = "Invitee@Example.com",
      ) =>
        checkRegistrationAllowed(address, undefined, {
          allowInvitationByEmail: true,
          emailVerified,
        });

      expect((await byEmail(true)).allowed).toBe(true);
      expect((await byEmail(false)).allowed).toBe(false);
      expect((await byEmail(undefined)).allowed).toBe(false);
      expect((await byEmail(true, "stranger@example.com")).allowed).toBe(false);
      expect(
        (
          await checkRegistrationAllowed("invitee@example.com", undefined, {
            emailVerified: true,
          })
        ).allowed,
      ).toBe(false);
    });
  });

  it("allows everything while registration is enabled", async () => {
    expect((await checkRegistrationAllowed("x@example.com")).allowed).toBe(
      true,
    );
  });
});
