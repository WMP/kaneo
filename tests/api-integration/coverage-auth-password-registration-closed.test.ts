import { beforeEach, describe, expect, it, vi } from "vitest";

// Read when apps/api/src/auth.ts is loaded.
vi.hoisted(() => {
  process.env.DISABLE_PASSWORD_REGISTRATION = "true";
});

import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

const signUp = (address: string) =>
  createApp().app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: "http://localhost:5173",
    },
    body: JSON.stringify({
      name: "Person",
      email: address,
      password: "long-password-for-tests",
    }),
  });

beforeEach(async () => {
  await resetTestDatabase();
});

describe("password registration disabled", () => {
  it("refuses password sign-up once the instance has users, and creates no account", async () => {
    await createWorkspaceMember();

    const response = await signUp("late@example.com");

    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe(
      "Password registration is currently disabled. Please use a configured social or OIDC sign-in method.",
    );
    expect(await db.select().from(schema.userTable)).toHaveLength(1);
  });

  it("still lets the first account set the instance up", async () => {
    const response = await signUp("first@example.com");

    expect(response.status).toBe(200);
    const [user] = await db.select().from(schema.userTable);
    expect(user?.role).toBe("admin");
  });
});
