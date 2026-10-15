import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { migrateApiKeyReferenceId } from "../../apps/api/src/utils/migrate-apikey-reference-id";
import { migrateNotificationPreferencesSchema } from "../../apps/api/src/utils/migrate-notification-preferences-schema";
import { migrateSessionColumn } from "../../apps/api/src/utils/migrate-session-column";
import { migrateWorkspaceUserEmail } from "../../apps/api/src/utils/migrate-workspace-user-email";
import { seedDefaultWorkspaceRoles } from "../../apps/api/src/utils/seed-default-workspace-roles";
import { defaultRolePayloads } from "../../packages/permissions/src";
import { resetTestDatabase } from "./helpers/database";

// The startup helpers (docs/agent-guide/database.md, "How migrations apply")
// work on the shared `db` and on tables of the real schema. To give them a
// legacy-shaped database without damaging the shared test database, every
// scenario rebuilds the legacy shape inside one transaction and rolls it back.
// The helpers keep using `db`, which delegates to that transaction.
const state = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../../apps/api/src/database", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/api/src/database")>();
  const proxy = new Proxy(actual.default, {
    get(target, prop) {
      const active = (state.current ?? target) as typeof target;
      const value = Reflect.get(active, prop);
      return typeof value === "function" ? value.bind(active) : value;
    },
  });
  return { ...actual, default: proxy };
});

class Rollback extends Error {}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function inRollback(scenario: (tx: Tx) => Promise<void>) {
  let failure: { error: unknown } | null = null;
  try {
    await db.transaction(async (tx) => {
      state.current = tx;
      try {
        await scenario(tx);
      } catch (error) {
        failure = { error };
      } finally {
        state.current = null;
      }
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  if (failure) throw (failure as { error: unknown }).error;
}

async function rows<T = Record<string, unknown>>(
  tx: Tx,
  query: ReturnType<typeof sql>,
) {
  const result = await tx.execute(query);
  return result.rows as T[];
}

async function columnNames(tx: Tx, table: string) {
  const result = await rows<{ column_name: string }>(
    tx,
    sql`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}
        ORDER BY column_name`,
  );
  return result.map((r) => r.column_name);
}

beforeEach(async () => {
  await resetTestDatabase();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function insertUser(tx: Tx, id: string, email: string) {
  await tx.execute(
    sql`INSERT INTO "user" (id, name, email, email_verified) VALUES (${id}, ${id}, ${email}, true)`,
  );
}

async function insertWorkspace(tx: Tx, id: string) {
  await tx.execute(
    sql`INSERT INTO workspace (id, name, slug, created_at) VALUES (${id}, ${id}, ${id}, now())`,
  );
}

describe("migrateWorkspaceUserEmail on legacy workspace_member", () => {
  async function legacyTable(tx: Tx, withUserId: boolean) {
    await tx.execute(sql`DROP TABLE workspace_member CASCADE`);
    await tx.execute(
      withUserId
        ? sql`CREATE TABLE workspace_member (id text PRIMARY KEY, workspace_id text NOT NULL, role text NOT NULL DEFAULT 'member', joined_at timestamp NOT NULL DEFAULT now(), user_email text, user_id text)`
        : sql`CREATE TABLE workspace_member (id text PRIMARY KEY, workspace_id text NOT NULL, role text NOT NULL DEFAULT 'member', joined_at timestamp NOT NULL DEFAULT now(), user_email text)`,
    );
  }

  it("maps user_email to user_id, drops unmatched rows and the old column, and is idempotent", async () => {
    await inRollback(async (tx) => {
      await legacyTable(tx, false);
      await insertUser(tx, "u-alice", "alice@example.test");
      await insertUser(tx, "u-bob", "bob@example.test");
      await tx.execute(sql`
        INSERT INTO workspace_member (id, workspace_id, role, user_email) VALUES
          ('m-alice', 'w1', 'owner', 'alice@example.test'),
          ('m-bob', 'w1', 'member', 'bob@example.test'),
          ('m-ghost', 'w1', 'member', 'nobody@example.test'),
          ('m-blank', 'w1', 'member', ''),
          ('m-null', 'w1', 'member', NULL)`);

      await migrateWorkspaceUserEmail();

      expect(await columnNames(tx, "workspace_member")).not.toContain(
        "user_email",
      );
      const after = await rows(
        tx,
        sql`SELECT id, user_id, role FROM workspace_member ORDER BY id`,
      );
      expect(after).toEqual([
        { id: "m-alice", user_id: "u-alice", role: "owner" },
        { id: "m-bob", user_id: "u-bob", role: "member" },
      ]);

      await migrateWorkspaceUserEmail();
      expect(
        await rows(
          tx,
          sql`SELECT id, user_id, role FROM workspace_member ORDER BY id`,
        ),
      ).toEqual(after);
    });
  });

  it("keeps a user_id that is already set and removes rows with no user identification", async () => {
    await inRollback(async (tx) => {
      await legacyTable(tx, true);
      await insertUser(tx, "u-carol", "carol@example.test");
      await insertUser(tx, "u-dave", "dave@example.test");
      await tx.execute(sql`
        INSERT INTO workspace_member (id, workspace_id, user_email, user_id) VALUES
          ('m-set', 'w1', 'carol@example.test', 'u-dave'),
          ('m-unset', 'w1', 'carol@example.test', NULL),
          ('m-none', 'w1', NULL, NULL)`);

      await migrateWorkspaceUserEmail();

      expect(await columnNames(tx, "workspace_member")).not.toContain(
        "user_email",
      );
      expect(
        await rows(
          tx,
          sql`SELECT id, user_id FROM workspace_member ORDER BY id`,
        ),
      ).toEqual([
        { id: "m-set", user_id: "u-dave" },
        { id: "m-unset", user_id: "u-carol" },
      ]);
    });
  });

  it("adds user_id when neither column exists and removes rows without an owner", async () => {
    await inRollback(async (tx) => {
      await tx.execute(sql`DROP TABLE workspace_member CASCADE`);
      await tx.execute(
        sql`CREATE TABLE workspace_member (id text PRIMARY KEY, workspace_id text NOT NULL)`,
      );
      await tx.execute(
        sql`INSERT INTO workspace_member (id, workspace_id) VALUES ('m1', 'w1')`,
      );

      await migrateWorkspaceUserEmail();

      expect(await columnNames(tx, "workspace_member")).toContain("user_id");
      expect(await rows(tx, sql`SELECT id FROM workspace_member`)).toEqual([]);
    });
  });

  it("leaves an up-to-date table untouched", async () => {
    await inRollback(async (tx) => {
      await insertUser(tx, "u-erin", "erin@example.test");
      await insertWorkspace(tx, "w-erin");
      await tx.execute(
        sql`INSERT INTO workspace_member (id, workspace_id, user_id, joined_at) VALUES ('m-erin', 'w-erin', 'u-erin', now())`,
      );

      await migrateWorkspaceUserEmail();

      expect(
        await rows(tx, sql`SELECT id, user_id FROM workspace_member`),
      ).toEqual([{ id: "m-erin", user_id: "u-erin" }]);
    });
  });

  it("skips a database without the workspace_member table", async () => {
    await inRollback(async (tx) => {
      await tx.execute(sql`DROP TABLE workspace_member CASCADE`);
      await expect(migrateWorkspaceUserEmail()).resolves.toBeUndefined();
      expect(
        await rows(tx, sql`SELECT to_regclass('public.workspace_member') AS t`),
      ).toEqual([{ t: null }]);
    });
  });

  it("logs and rethrows when the user table is gone", async () => {
    await inRollback(async (tx) => {
      await legacyTable(tx, false);
      await tx.execute(
        sql`INSERT INTO workspace_member (id, workspace_id, user_email) VALUES ('m1', 'w1', 'x@example.test')`,
      );
      await tx.execute(sql`DROP TABLE "user" CASCADE`);

      await expect(migrateWorkspaceUserEmail()).rejects.toThrow();
      expect(console.error).toHaveBeenCalled();
    });
  });
});

describe("migrateApiKeyReferenceId on a legacy apikey table", () => {
  async function legacyApiKey(tx: Tx, extraColumns = "") {
    await tx.execute(sql`DROP TABLE apikey CASCADE`);
    await tx.execute(
      sql.raw(
        `CREATE TABLE apikey (id text PRIMARY KEY, key text NOT NULL, user_id text NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()${extraColumns})`,
      ),
    );
  }

  async function indexNames(tx: Tx) {
    const result = await rows<{ indexname: string }>(
      tx,
      sql`SELECT indexname FROM pg_indexes WHERE tablename = 'apikey' ORDER BY indexname`,
    );
    return result.map((r) => r.indexname);
  }

  it("copies user_id to reference_id, defaults config_id, relaxes user_id and creates indexes once", async () => {
    await inRollback(async (tx) => {
      await legacyApiKey(tx);
      await tx.execute(sql`
        INSERT INTO apikey (id, key, user_id) VALUES
          ('k1', 'hash-1', 'user-1'), ('k2', 'hash-2', 'user-2')`);

      await migrateApiKeyReferenceId();

      expect(
        await rows(
          tx,
          sql`SELECT id, user_id, reference_id, config_id FROM apikey ORDER BY id`,
        ),
      ).toEqual([
        {
          id: "k1",
          user_id: "user-1",
          reference_id: "user-1",
          config_id: "default",
        },
        {
          id: "k2",
          user_id: "user-2",
          reference_id: "user-2",
          config_id: "default",
        },
      ]);
      // Better Auth inserts reference_id and leaves user_id null.
      await tx.execute(
        sql`INSERT INTO apikey (id, key, user_id, reference_id) VALUES ('k3', 'hash-3', NULL, 'user-3')`,
      );
      const indexes = await indexNames(tx);
      expect(indexes).toEqual(
        expect.arrayContaining([
          "apikey_configId_idx",
          "apikey_key_idx",
          "apikey_referenceId_idx",
        ]),
      );

      await migrateApiKeyReferenceId();
      expect(await indexNames(tx)).toEqual(indexes);
      expect(
        await rows(tx, sql`SELECT id, reference_id FROM apikey ORDER BY id`),
      ).toEqual([
        { id: "k1", reference_id: "user-1" },
        { id: "k2", reference_id: "user-2" },
        { id: "k3", reference_id: "user-3" },
      ]);
    });
  });

  it("does not overwrite an existing reference_id and fills a null config_id", async () => {
    await inRollback(async (tx) => {
      await legacyApiKey(tx, ", reference_id text, config_id text");
      await tx.execute(sql`
        INSERT INTO apikey (id, key, user_id, reference_id, config_id) VALUES
          ('k1', 'hash-1', 'old-owner', 'new-owner', NULL),
          ('k2', 'hash-2', 'user-2', NULL, 'custom')`);

      await migrateApiKeyReferenceId();

      expect(
        await rows(
          tx,
          sql`SELECT id, reference_id, config_id FROM apikey ORDER BY id`,
        ),
      ).toEqual([
        { id: "k1", reference_id: "new-owner", config_id: "default" },
        { id: "k2", reference_id: "user-2", config_id: "custom" },
      ]);
    });
  });

  it("works on a table that has no user_id column", async () => {
    await inRollback(async (tx) => {
      await tx.execute(sql`DROP TABLE apikey CASCADE`);
      await tx.execute(
        sql`CREATE TABLE apikey (id text PRIMARY KEY, key text NOT NULL, reference_id text)`,
      );
      await tx.execute(
        sql`INSERT INTO apikey (id, key, reference_id) VALUES ('k1', 'hash-1', 'user-1')`,
      );

      await migrateApiKeyReferenceId();

      expect(
        await rows(tx, sql`SELECT id, reference_id, config_id FROM apikey`),
      ).toEqual([{ id: "k1", reference_id: "user-1", config_id: "default" }]);
    });
  });

  it("skips a database without the apikey table", async () => {
    await inRollback(async (tx) => {
      await tx.execute(sql`DROP TABLE apikey CASCADE`);
      await expect(migrateApiKeyReferenceId()).resolves.toBeUndefined();
      expect(
        await rows(tx, sql`SELECT to_regclass('public.apikey') AS t`),
      ).toEqual([{ t: null }]);
    });
  });

  it("logs and rethrows when an index cannot be created", async () => {
    await inRollback(async (tx) => {
      await tx.execute(sql`DROP TABLE apikey CASCADE`);
      await tx.execute(
        sql`CREATE TABLE apikey (id text PRIMARY KEY, user_id text)`,
      );

      await expect(migrateApiKeyReferenceId()).rejects.toThrow();
      expect(console.error).toHaveBeenCalled();
    });
  });
});

describe("migrateSessionColumn on legacy session and invitation tables", () => {
  it("renames active_workspace_id and keeps the stored value", async () => {
    await inRollback(async (tx) => {
      await insertUser(tx, "u-s", "s@example.test");
      await tx.execute(
        sql`ALTER TABLE session RENAME COLUMN active_organization_id TO active_workspace_id`,
      );
      await tx.execute(sql`
        INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at, active_workspace_id)
        VALUES ('s1', 'tok-1', 'u-s', now() + interval '1 day', now(), now(), 'workspace-7')`);

      await migrateSessionColumn();

      const columns = await columnNames(tx, "session");
      expect(columns).toContain("active_organization_id");
      expect(columns).not.toContain("active_workspace_id");
      expect(
        await rows(tx, sql`SELECT active_organization_id AS org FROM session`),
      ).toEqual([{ org: "workspace-7" }]);

      await migrateSessionColumn();
      expect(
        await rows(tx, sql`SELECT active_organization_id AS org FROM session`),
      ).toEqual([{ org: "workspace-7" }]);
    });
  });

  it("does not rename when both columns exist", async () => {
    await inRollback(async (tx) => {
      await tx.execute(
        sql`ALTER TABLE session ADD COLUMN active_workspace_id text`,
      );

      await migrateSessionColumn();

      const columns = await columnNames(tx, "session");
      expect(columns).toContain("active_organization_id");
      expect(columns).toContain("active_workspace_id");
    });
  });

  it("changes nothing when neither session column exists", async () => {
    await inRollback(async (tx) => {
      await tx.execute(
        sql`ALTER TABLE session DROP COLUMN active_organization_id`,
      );

      await migrateSessionColumn();

      const columns = await columnNames(tx, "session");
      expect(columns).not.toContain("active_organization_id");
      expect(columns).not.toContain("active_workspace_id");
    });
  });

  it("adds invitation.created_at from expires_at minus one month, then NOT NULL with a default", async () => {
    await inRollback(async (tx) => {
      await insertUser(tx, "u-i", "i@example.test");
      await insertWorkspace(tx, "w-i");
      await tx.execute(sql`ALTER TABLE invitation DROP COLUMN created_at`);
      await tx.execute(
        sql`ALTER TABLE invitation ALTER COLUMN expires_at DROP NOT NULL`,
      );
      await tx.execute(sql`
        INSERT INTO invitation (id, workspace_id, email, status, expires_at, inviter_id) VALUES
          ('i1', 'w-i', 'a@example.test', 'pending', '2026-03-31 12:00:00', 'u-i'),
          ('i2', 'w-i', 'b@example.test', 'pending', NULL, 'u-i')`);

      await migrateSessionColumn();

      const [first] = await rows<{ created_at: string }>(
        tx,
        sql`SELECT to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at FROM invitation WHERE id = 'i1'`,
      );
      // Postgres subtracts calendar months: 31 March minus one month is 28 February.
      expect(first.created_at).toBe("2026-02-28 12:00:00");
      const [second] = await rows<{ recent: boolean }>(
        tx,
        sql`SELECT created_at > now() - interval '5 minutes' AS recent FROM invitation WHERE id = 'i2'`,
      );
      expect(second.recent).toBe(true);
      const [column] = await rows<{
        is_nullable: string;
        column_default: string;
      }>(
        tx,
        sql`SELECT is_nullable, column_default FROM information_schema.columns
            WHERE table_name = 'invitation' AND column_name = 'created_at'`,
      );
      expect(column.is_nullable).toBe("NO");
      expect(column.column_default).toMatch(/now\(\)/i);

      await migrateSessionColumn();
      const [again] = await rows<{ created_at: string }>(
        tx,
        sql`SELECT to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at FROM invitation WHERE id = 'i1'`,
      );
      expect(again.created_at).toBe("2026-02-28 12:00:00");
    });
  });

  it("skips databases without the session and invitation tables", async () => {
    await inRollback(async (tx) => {
      await tx.execute(sql`DROP TABLE session CASCADE`);
      await tx.execute(sql`DROP TABLE invitation CASCADE`);
      await expect(migrateSessionColumn()).resolves.toBeUndefined();
    });
  });

  it("logs and rethrows when the invitation backfill fails", async () => {
    await inRollback(async (tx) => {
      await tx.execute(sql`DROP TABLE invitation CASCADE`);
      await tx.execute(sql`CREATE TABLE invitation (id text PRIMARY KEY)`);
      await tx.execute(sql`INSERT INTO invitation (id) VALUES ('i1')`);

      await expect(migrateSessionColumn()).rejects.toThrow();
      expect(console.error).toHaveBeenCalled();
    });
  });
});

describe("migrateNotificationPreferencesSchema on a partially applied schema", () => {
  async function constraintNames(tx: Tx) {
    const result = await rows<{ conname: string }>(
      tx,
      sql`SELECT conname FROM pg_constraint
          WHERE conrelid IN (
            'user_notification_preference'::regclass,
            'user_notification_workspace_rule'::regclass,
            'user_notification_workspace_project'::regclass)
          ORDER BY conname`,
    );
    return result.map((r) => r.conname);
  }

  async function dropNotificationTables(tx: Tx) {
    await tx.execute(
      sql`DROP TABLE user_notification_workspace_project, user_notification_workspace_rule, user_notification_preference CASCADE`,
    );
  }

  it("creates the missing tables, columns, indexes and foreign keys and keeps stored rows", async () => {
    await inRollback(async (tx) => {
      await insertUser(tx, "u-n", "n@example.test");
      await insertWorkspace(tx, "w-n");
      await dropNotificationTables(tx);
      // Drift: only part of the first table exists, with one stored row.
      await tx.execute(
        sql`CREATE TABLE user_notification_preference (id text PRIMARY KEY NOT NULL, user_id text NOT NULL, email_enabled boolean DEFAULT true NOT NULL)`,
      );
      await tx.execute(
        sql`INSERT INTO user_notification_preference (id, user_id, email_enabled) VALUES ('p1', 'u-n', true)`,
      );

      await migrateNotificationPreferencesSchema();

      const [preference] = await rows(
        tx,
        sql`SELECT email_enabled, ntfy_enabled, task_assignment_enabled,
                   due_date_reminder_lead_time_minutes, webhook_secret
            FROM user_notification_preference WHERE id = 'p1'`,
      );
      expect(preference).toEqual({
        email_enabled: true,
        ntfy_enabled: false,
        task_assignment_enabled: true,
        due_date_reminder_lead_time_minutes: 1440,
        webhook_secret: null,
      });
      expect(await columnNames(tx, "user_notification_workspace_rule")).toEqual(
        [
          "created_at",
          "email_enabled",
          "gotify_enabled",
          "id",
          "is_active",
          "ntfy_enabled",
          "project_mode",
          "updated_at",
          "user_id",
          "webhook_enabled",
          "workspace_id",
        ],
      );
      expect(await constraintNames(tx)).toEqual(
        expect.arrayContaining([
          "user_notification_preference_user_id_user_id_fk",
          "user_notification_workspace_project_workspace_id_workspace_id_f",
          "user_notification_workspace_rule_user_id_user_id_fk",
          "user_notification_workspace_rule_workspace_id_workspace_id_fk",
        ]),
      );
      const before = await constraintNames(tx);

      // The unique indexes and foreign keys are enforced.
      await expect(
        tx.transaction((nested) =>
          nested.execute(
            sql`INSERT INTO user_notification_preference (id, user_id) VALUES ('p2', 'u-n')`,
          ),
        ),
      ).rejects.toThrow();
      await expect(
        tx.transaction((nested) =>
          nested.execute(
            sql`INSERT INTO user_notification_preference (id, user_id) VALUES ('p3', 'no-such-user')`,
          ),
        ),
      ).rejects.toThrow();
      await tx.execute(
        sql`INSERT INTO user_notification_workspace_rule (id, user_id, workspace_id) VALUES ('r1', 'u-n', 'w-n')`,
      );
      await expect(
        tx.transaction((nested) =>
          nested.execute(
            sql`INSERT INTO user_notification_workspace_rule (id, user_id, workspace_id) VALUES ('r2', 'u-n', 'w-n')`,
          ),
        ),
      ).rejects.toThrow();

      await migrateNotificationPreferencesSchema();
      expect(await constraintNames(tx)).toEqual(before);
      expect(
        await rows(tx, sql`SELECT id FROM user_notification_preference`),
      ).toEqual([{ id: "p1" }]);
    });
  });

  it("recreates all three tables when none exist", async () => {
    await inRollback(async (tx) => {
      await dropNotificationTables(tx);

      await migrateNotificationPreferencesSchema();

      for (const table of [
        "user_notification_preference",
        "user_notification_workspace_rule",
        "user_notification_workspace_project",
      ]) {
        expect((await columnNames(tx, table)).length).toBeGreaterThan(3);
      }
    });
  });

  it("logs and rethrows when stored duplicates block the unique index", async () => {
    await inRollback(async (tx) => {
      await dropNotificationTables(tx);
      await tx.execute(
        sql`CREATE TABLE user_notification_preference (id text PRIMARY KEY NOT NULL, user_id text NOT NULL)`,
      );
      await tx.execute(
        sql`INSERT INTO user_notification_preference (id, user_id) VALUES ('p1', 'dup'), ('p2', 'dup')`,
      );

      await expect(migrateNotificationPreferencesSchema()).rejects.toThrow(
        /duplicate|unique/i,
      );
      expect(console.error).toHaveBeenCalled();
    });
  });
});

describe("seedDefaultWorkspaceRoles", () => {
  async function createWorkspaces(count: number) {
    const ids = Array.from({ length: count }, () => `ws-${randomUUID()}`);
    await db.insert(schema.workspaceTable).values(
      ids.map((id) => ({
        id,
        name: id,
        slug: id,
        createdAt: new Date(),
      })),
    );
    return ids;
  }

  async function rolesOf(workspaceId: string) {
    const stored = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, workspaceId));
    return Object.fromEntries(stored.map((r) => [r.role, r.permission]));
  }

  it("seeds the missing default roles, keeps edited ones and custom roles, and is idempotent", async () => {
    const [bare, partial] = await createWorkspaces(2);
    const editedAdmin = JSON.stringify({ task: ["read"] });
    await db.insert(schema.workspaceRoleTable).values([
      {
        workspaceId: partial,
        role: "admin",
        permission: editedAdmin,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        workspaceId: partial,
        role: "auditor",
        permission: JSON.stringify({ task: ["read"] }),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await seedDefaultWorkspaceRoles();

    const bareRoles = await rolesOf(bare);
    expect(Object.keys(bareRoles).sort()).toEqual([
      "admin",
      "member",
      "viewer",
    ]);
    expect(JSON.parse(bareRoles.viewer)).toEqual(defaultRolePayloads.viewer);
    expect(JSON.parse(bareRoles.member)).toEqual(defaultRolePayloads.member);
    expect(JSON.parse(bareRoles.admin)).toEqual(defaultRolePayloads.admin);
    // The three payloads differ: a copy-paste of one payload would fail here.
    expect(new Set(Object.values(bareRoles)).size).toBe(3);

    const partialRoles = await rolesOf(partial);
    expect(Object.keys(partialRoles).sort()).toEqual([
      "admin",
      "auditor",
      "member",
      "viewer",
    ]);
    expect(partialRoles.admin).toBe(editedAdmin);
    expect(JSON.parse(partialRoles.member)).toEqual(defaultRolePayloads.member);

    const countBefore = (await db.select().from(schema.workspaceRoleTable))
      .length;
    expect(countBefore).toBe(7);
    await seedDefaultWorkspaceRoles();
    expect((await db.select().from(schema.workspaceRoleTable)).length).toBe(
      countBefore,
    );
    expect((await rolesOf(partial)).admin).toBe(editedAdmin);
  });

  it("inserts in batches when more than 1000 rows are missing", async () => {
    const ids = await createWorkspaces(400);

    await seedDefaultWorkspaceRoles();

    const stored = await db.select().from(schema.workspaceRoleTable);
    expect(stored).toHaveLength(1200);
    const perWorkspace = new Map<string, string[]>();
    for (const row of stored) {
      perWorkspace.set(row.workspaceId, [
        ...(perWorkspace.get(row.workspaceId) ?? []),
        row.role,
      ]);
    }
    expect(perWorkspace.size).toBe(ids.length);
    for (const roles of perWorkspace.values()) {
      expect(roles.sort()).toEqual(["admin", "member", "viewer"]);
    }
  });

  it("does nothing without workspaces", async () => {
    await seedDefaultWorkspaceRoles();
    expect(await db.select().from(schema.workspaceRoleTable)).toEqual([]);
  });

  it("skips a database without the workspace_role table", async () => {
    await inRollback(async (tx) => {
      await tx.execute(sql`DROP TABLE workspace_role CASCADE`);
      await expect(seedDefaultWorkspaceRoles()).resolves.toBeUndefined();
    });
  });

  it("logs and rethrows when the workspace list cannot be read", async () => {
    await inRollback(async (tx) => {
      await tx.execute(sql`DROP TABLE workspace CASCADE`);
      await expect(seedDefaultWorkspaceRoles()).rejects.toThrow();
      expect(console.error).toHaveBeenCalled();
    });
  });
});
