import { randomUUID } from "node:crypto";
import type { User } from "better-auth/types";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

vi.mock("../../apps/api/src/events", async (original) => ({
  ...(await original<object>()),
  publishEvent: vi.fn(async () => undefined),
}));

// The user directory (`GET /api/workspace/{id}/user-directory?q=`): a search
// over ALL accounts of the instance for people who may add workspace members.
// It reveals that an account exists, so it needs `member:create` in the
// WORKSPACE role, can be switched off (DISABLE_USER_DIRECTORY, off on cloud
// unless ENABLE_USER_DIRECTORY) and is narrow (2+ characters, 20 results, four
// fields, no guests, no banned accounts, nobody who is in the workspace).

const { app } = createApp();

const FLAGS = [
  "DISABLE_USER_DIRECTORY",
  "ENABLE_USER_DIRECTORY",
  "KANEO_CLOUD",
] as const;
const savedEnv: Record<string, string | undefined> = {};

function as(user: unknown) {
  mockAuthenticatedSession(user as User);
}

function search(workspaceId: string, q: string) {
  return app.request(
    `/api/workspace/${workspaceId}/user-directory?q=${encodeURIComponent(q)}`,
  );
}

async function createAccount(
  name: string,
  overrides: Partial<typeof schema.userTable.$inferInsert> = {},
) {
  const id = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      name,
      email: `${id}@example.com`,
      emailVerified: true,
      ...overrides,
    })
    .returning();
  return user;
}

type Hit = { id: string; name: string; email: string; image: string | null };

async function names(response: Response) {
  expect(response.status).toBe(200);
  return ((await response.json()) as Hit[]).map((hit) => hit.name);
}

async function buildWorld() {
  const owner = await createWorkspaceMember({
    role: "owner",
    userName: "Olivia Owner",
  });
  const workspaceId = owner.workspace.id;
  await db.insert(schema.workspaceRoleTable).values([
    {
      workspaceId,
      role: "adder",
      permission: JSON.stringify({ member: ["create"], task: ["read"] }),
    },
  ]);
  const adder = await addWorkspaceMember(workspaceId, "adder");
  const plainMember = await addWorkspaceMember(workspaceId, "member");
  return { owner, workspaceId, adder, plainMember };
}

beforeEach(async () => {
  for (const key of FLAGS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  await resetTestDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of FLAGS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("user directory: who may search", () => {
  it("answers the owner and a role that grants member:create", async () => {
    const w = await buildWorld();
    await createAccount("Zofia Nowak");

    as(w.owner.user);
    expect(await names(await search(w.workspaceId, "zofia"))).toEqual([
      "Zofia Nowak",
    ]);
    as(w.adder);
    expect(await names(await search(w.workspaceId, "zofia"))).toEqual([
      "Zofia Nowak",
    ]);
  });

  it("refuses a member whose workspace role lacks member:create", async () => {
    const w = await buildWorld();
    await createAccount("Zofia Nowak");
    as(w.plainMember);
    const response = await search(w.workspaceId, "zofia");
    expect(response.status).toBe(403);
    // Nothing of the directory is in the body.
    expect(await response.text()).not.toContain("Zofia");
  });

  it("refuses a project role: only the WORKSPACE role counts", async () => {
    const w = await buildWorld();
    await createAccount("Zofia Nowak");
    // A project admin holds member:create in the project, but the directory is
    // a workspace-level feature.
    const { project } = await createProjectFixture({
      workspaceId: w.workspaceId,
      members: "none",
    });
    await addProjectMember(project.id, w.plainMember.id, "admin");
    as(w.plainMember);
    expect((await search(w.workspaceId, "zofia")).status).toBe(403);
  });

  it("refuses somebody from another workspace and an anonymous caller", async () => {
    const w = await buildWorld();
    const outsider = await createWorkspaceMember({ role: "owner" });
    as(outsider.user);
    expect((await search(w.workspaceId, "zofia")).status).toBe(403);

    vi.restoreAllMocks();
    expect((await search(w.workspaceId, "zofia")).status).toBe(401);
  });

  it("refuses a guest account on every instance, whatever its role", async () => {
    const w = await buildWorld();
    await createAccount("Zofia Nowak");
    const guest = await addWorkspaceMember(w.workspaceId, "adder");
    await db
      .update(schema.userTable)
      .set({ isAnonymous: true })
      .where(eq(schema.userTable.id, guest.id));
    as({ ...guest, isAnonymous: true });
    const response = await search(w.workspaceId, "zofia");
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      "GUEST_NOT_ALLOWED",
    );
  });

  it("intersects the scope of an API key", async () => {
    const w = await buildWorld();
    await createAccount("Zofia Nowak");
    const createKey = async (permissions: Record<string, string[]>) =>
      (
        await auth.api.createApiKey({
          body: { userId: w.owner.user.id, name: "scope", permissions },
        })
      ).key;
    const withKey = (key: string) =>
      app.request(`/api/workspace/${w.workspaceId}/user-directory?q=zofia`, {
        headers: { "x-api-key": key },
      });

    expect((await withKey(await createKey({ task: ["read"] }))).status).toBe(
      403,
    );
    expect(
      (await withKey(await createKey({ invitation: ["create"] }))).status,
    ).toBe(403);
    const allowed = await withKey(await createKey({ member: ["create"] }));
    expect(allowed.status).toBe(200);
  });
});

describe("user directory: the feature flag", () => {
  it("is on by default on a self-hosted instance and reported by /config", async () => {
    const w = await buildWorld();
    as(w.owner.user);
    expect((await search(w.workspaceId, "olivia")).status).toBe(200);
    vi.restoreAllMocks();
    const config = (await (await app.request("/api/config")).json()) as {
      userDirectoryEnabled: boolean;
    };
    expect(config.userDirectoryEnabled).toBe(true);
  });

  it("DISABLE_USER_DIRECTORY=true answers 403 USER_DIRECTORY_DISABLED, even to the owner", async () => {
    const w = await buildWorld();
    await createAccount("Zofia Nowak");
    process.env.DISABLE_USER_DIRECTORY = "true";
    as(w.owner.user);
    const response = await search(w.workspaceId, "zofia");
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      "USER_DIRECTORY_DISABLED",
    );
    vi.restoreAllMocks();
    const config = (await (await app.request("/api/config")).json()) as {
      userDirectoryEnabled: boolean;
    };
    expect(config.userDirectoryEnabled).toBe(false);
  });

  it("is off on cloud unless ENABLE_USER_DIRECTORY=true", async () => {
    const w = await buildWorld();
    await createAccount("Zofia Nowak");
    process.env.KANEO_CLOUD = "true";
    as(w.owner.user);
    const off = await search(w.workspaceId, "zofia");
    expect(off.status).toBe(403);
    expect(((await off.json()) as { code: string }).code).toBe(
      "USER_DIRECTORY_DISABLED",
    );

    process.env.ENABLE_USER_DIRECTORY = "true";
    expect(await names(await search(w.workspaceId, "zofia"))).toEqual([
      "Zofia Nowak",
    ]);

    // The disabling flag wins over the enabling one.
    process.env.DISABLE_USER_DIRECTORY = "true";
    expect((await search(w.workspaceId, "zofia")).status).toBe(403);
  });
});

describe("user directory: what it returns", () => {
  it("needs at least two characters after trimming", async () => {
    const w = await buildWorld();
    await createAccount("Zofia Nowak");
    as(w.owner.user);
    for (const q of ["", "z", "  z  ", "   "]) {
      const response = await search(w.workspaceId, q);
      expect(response.status, `q=${JSON.stringify(q)}`).toBe(400);
      expect(((await response.json()) as { code: string }).code).toBe(
        "QUERY_TOO_SHORT",
      );
    }
    expect(await names(await search(w.workspaceId, " zo "))).toEqual([
      "Zofia Nowak",
    ]);
  });

  it("matches name and email case-insensitively and treats % and _ literally", async () => {
    const w = await buildWorld();
    const byEmail = await createAccount("Completely Different", {
      email: `zebra-${randomUUID().slice(0, 6)}@example.com`,
    });
    await createAccount("Percent 100% Person");
    await createAccount("Plain Person");
    as(w.owner.user);

    expect(await names(await search(w.workspaceId, "ZEBRA"))).toEqual([
      "Completely Different",
    ]);
    expect(await names(await search(w.workspaceId, byEmail.email))).toEqual([
      "Completely Different",
    ]);
    expect(await names(await search(w.workspaceId, "100%"))).toEqual([
      "Percent 100% Person",
    ]);
    // `%%` would match everything if it were a wildcard.
    expect(await names(await search(w.workspaceId, "%%"))).toEqual([]);
    expect(await names(await search(w.workspaceId, "__"))).toEqual([]);
  });

  it("returns at most 20 accounts with only id, name, email and image", async () => {
    const w = await buildWorld();
    for (let i = 0; i < 25; i += 1) {
      await createAccount(`Crowd ${String(i).padStart(2, "0")}`, {
        image: "https://example.com/a.png",
      });
    }
    as(w.owner.user);
    const response = await search(w.workspaceId, "crowd");
    expect(response.status).toBe(200);
    const hits = (await response.json()) as Record<string, unknown>[];
    expect(hits).toHaveLength(20);
    for (const hit of hits) {
      expect(Object.keys(hit).sort()).toEqual(["email", "id", "image", "name"]);
    }
    // Ordered by name, so the first page is stable.
    expect((hits[0] as Hit).name).toBe("Crowd 00");
  });

  it("leaves out guests, banned accounts and people already in the workspace", async () => {
    const w = await buildWorld();
    await createAccount("Visible Person");
    await createAccount("Visible Guest", { isAnonymous: true });
    await createAccount("Visible Banned", { banned: true });
    await createAccount("Visible Expired Ban", {
      banned: true,
      banExpires: new Date(Date.now() - 60_000),
    });
    await createAccount("Visible Current Ban", {
      banned: true,
      banExpires: new Date(Date.now() + 60_000 * 60),
    });
    const member = await createAccount("Visible Member");
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: w.workspaceId,
      userId: member.id,
      role: "member",
      joinedAt: new Date(),
    });
    // A member of ANOTHER workspace is still found.
    const other = await createWorkspaceMember({
      userName: "Visible Elsewhere",
      role: "owner",
    });
    expect(other.user.name).toBe("Visible Elsewhere");

    as(w.owner.user);
    expect(await names(await search(w.workspaceId, "visible"))).toEqual([
      "Visible Elsewhere",
      "Visible Expired Ban",
      "Visible Person",
    ]);
  });
});
