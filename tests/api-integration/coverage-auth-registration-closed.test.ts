import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Both settings are read when apps/api/src/auth.ts is loaded.
vi.hoisted(() => {
  process.env.DISABLE_REGISTRATION = "true";
  process.env.DISABLE_WORKSPACE_CREATION = "true";
});

import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

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

const signUp = (address: string, headers: Record<string, string> = {}) =>
  post(
    "/sign-up/email",
    { name: address.split("@")[0], email: address, password },
    headers,
  );

const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");

beforeEach(async () => {
  await resetTestDatabase();
});

describe("registration disabled", () => {
  it("lets the first account set the instance up and makes it the administrator", async () => {
    const response = await signUp("first@example.com");

    expect(response.status).toBe(200);
    const [user] = await db.select().from(schema.userTable);
    expect(user?.email).toBe("first@example.com");
    expect(user?.role).toBe("admin");
  });

  it("refuses an uninvited sign-up with the invitation message and creates no account", async () => {
    await createWorkspaceMember();

    const response = await signUp("stranger@example.com");

    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe(
      "Registration is currently disabled. Please use a valid invitation link to create an account.",
    );
    expect(
      await db
        .select()
        .from(schema.userTable)
        .where(eq(schema.userTable.email, "stranger@example.com")),
    ).toEqual([]);
  });

  it("accepts a sign-up that carries a pending invitation for the same address and refuses one for another address", async () => {
    const inviter = await createWorkspaceMember({ role: "owner" });
    const [invitation] = await db
      .insert(schema.invitationTable)
      .values({
        email: "invitee@example.com",
        workspaceId: inviter.workspace.id,
        inviterId: inviter.user.id,
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();

    const wrongAddress = await signUp("other@example.com", {
      "x-invitation-id": invitation.id,
    });
    expect(wrongAddress.status).toBe(403);

    const invited = await signUp("invitee@example.com", {
      "x-invitation-id": invitation.id,
    });
    expect(invited.status).toBe(200);
  });
});

describe("workspace creation disabled", () => {
  async function createWorkspace(cookie: string, name: string) {
    return post(
      "/organization/create",
      { name, slug: `ws-${Math.random().toString(36).slice(2, 10)}` },
      { Cookie: cookie },
    );
  }

  it("lets an instance administrator create a workspace and seeds its default roles", async () => {
    const admin = await signUp("admin@example.com");
    expect(admin.status).toBe(200);
    const response = await createWorkspace(cookieOf(admin), "Admin Space");
    expect(response.status).toBe(200);
    const created = (await response.json()) as { id: string };
    const roles = await db
      .select({ role: schema.workspaceRoleTable.role })
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, created.id));
    expect(roles.map((r) => r.role).sort()).toEqual([
      "admin",
      "member",
      "viewer",
    ]);
  });

  it("refuses a regular account the right to create a workspace", async () => {
    const admin = await signUp("admin2@example.com");
    expect(admin.status).toBe(200);
    // A regular account can only register with an invitation.
    const [adminRow] = await db.select().from(schema.userTable);
    const [invitation] = await db
      .insert(schema.invitationTable)
      .values({
        email: "regular@example.com",
        workspaceId: (await createWorkspaceMember({ role: "owner" })).workspace
          .id,
        inviterId: adminRow.id,
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    const regular = await signUp("regular@example.com", {
      "x-invitation-id": invitation.id,
    });
    expect(regular.status).toBe(200);

    const response = await createWorkspace(
      cookieOf(regular),
      "Forbidden Space",
    );

    expect(response.status).toBe(403);
    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.name, "Forbidden Space")),
    ).toEqual([]);
  });

  it("rejects a workspace name that contains a URL", async () => {
    const admin = await signUp("admin3@example.com");
    expect(admin.status).toBe(200);

    const response = await createWorkspace(
      cookieOf(admin),
      "Visit https://spam.example now",
    );

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe(
      "Workspace name may not contain URLs.",
    );
  });
});
