import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { runMigrations } from "../../apps/api/src/database/run-migrations";

// Migration 20261001100317_ganttpro_adopt_upstream_assets copies project
// backgrounds and calendar feeds written by upstream Kaneo v2.28+
// (project.background_*, calendar_feed) into the columns and table this fork
// reads (project.ganttpro_background_*, ganttpro_calendar_feed). The scratch
// database is migrated to the previous newest entry
// (20261001090514_ganttpro_workspace_columns), receives the upstream objects
// with data exactly as upstream's migrations 0052 and 0053 define them, and is
// then upgraded with the runner that the API uses at start-up. A database
// without the upstream objects must upgrade untouched.

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../apps/api/drizzle");
const TARGET_TAG = "20261001100317_ganttpro_adopt_upstream_assets";
const PREVIOUS_TAG = "20261001090514_ganttpro_workspace_columns";

function withDatabase(connectionString: string, database: string) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

describe("migration ganttpro_adopt_upstream_assets", () => {
  const baseUrl = process.env.DATABASE_URL as string;
  const scratchName = `${new URL(baseUrl).pathname
    .replace(/^\//, "")
    .replace(/_test$/, "")}_upstream_assets_upgrade_test`;
  const scratchUrl = withDatabase(baseUrl, scratchName);
  let priorFolder = "";
  let targetWhen = 0;
  let pool: Pool | null = null;

  async function withAdmin<T>(fn: (client: Client) => Promise<T>) {
    const admin = new Client({
      connectionString: withDatabase(baseUrl, "postgres"),
    });
    await admin.connect();
    try {
      return await fn(admin);
    } finally {
      await admin.end();
    }
  }

  async function dropScratch() {
    if (!scratchName.endsWith("_upstream_assets_upgrade_test")) {
      throw new Error(`Refusing to drop "${scratchName}"`);
    }
    await withAdmin((admin) =>
      admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`),
    );
  }

  beforeAll(() => {
    priorFolder = mkdtempSync(
      join(tmpdir(), "kaneo-migrations-workspace-columns-"),
    );
    cpSync(migrationsFolder, priorFolder, { recursive: true });
    const journalPath = join(priorFolder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: { tag: string; when: number }[];
    };
    const cut = journal.entries.findIndex((entry) => entry.tag === TARGET_TAG);
    expect(cut).toBeGreaterThan(0);
    // The database to upgrade is at the workspace columns migration, the
    // previous newest entry.
    expect(journal.entries[cut - 1].tag).toBe(PREVIOUS_TAG);
    targetWhen = journal.entries[cut].when;
    journal.entries = journal.entries.slice(0, cut);
    writeFileSync(journalPath, JSON.stringify(journal));
  });

  afterAll(() => {
    if (priorFolder) rmSync(priorFolder, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await dropScratch();
    await withAdmin((admin) => admin.query(`CREATE DATABASE "${scratchName}"`));
  }, 120_000);

  afterEach(async () => {
    await pool?.end();
    pool = null;
    await dropScratch();
  }, 120_000);

  const now = new Date("2026-09-01T10:00:00.000Z");

  // Upstream migrations 0052_dear_beyonder and 0053_calendar_feeds, verbatim.
  async function createUpstreamObjects(scratch: Pool) {
    await scratch.query(`
      ALTER TABLE "project" ADD COLUMN "background_object_key" text;
      ALTER TABLE "project" ADD COLUMN "background_mime_type" text;
      ALTER TABLE "project" ADD COLUMN "background_version" text;
      CREATE TABLE "calendar_feed" (
        "id" text PRIMARY KEY NOT NULL,
        "project_id" text NOT NULL,
        "token" text NOT NULL,
        "label_ids" jsonb NOT NULL,
        "time_zone" text DEFAULT 'UTC' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "calendar_feed_token_unique" UNIQUE("token")
      );
      ALTER TABLE "calendar_feed" ADD CONSTRAINT "calendar_feed_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;
      CREATE INDEX "calendar_feed_project_id_idx" ON "calendar_feed" USING btree ("project_id");
    `);
  }

  async function seedWorkspace(scratch: Pool) {
    await scratch.query(
      `INSERT INTO workspace (id, name, slug, created_at) VALUES ('w1', 'w1', 'w1', $1)`,
      [now],
    );
    for (const id of ["p1", "p2", "p3", "p4"]) {
      await scratch.query(
        `INSERT INTO project (id, workspace_id, slug, name) VALUES ($1, 'w1', $1, $1)`,
        [id],
      );
    }
  }

  const keyOf = (projectId: string, version: string) =>
    `workspace/w1/project/${projectId}/backgrounds/background-${version}`;

  async function backgrounds(scratch: Pool) {
    const result = await scratch.query(
      `SELECT id, ganttpro_background_object_key AS key,
              ganttpro_background_mime_type AS mime,
              ganttpro_background_version AS version
       FROM project ORDER BY id`,
    );
    return result.rows;
  }

  async function feeds(scratch: Pool) {
    const result = await scratch.query(
      `SELECT id, project_id, token, label_ids, time_zone, created_at
       FROM ganttpro_calendar_feed ORDER BY id`,
    );
    return result.rows;
  }

  async function runMigrationSql(scratch: Pool) {
    const statements = readFileSync(
      join(migrationsFolder, `${TARGET_TAG}.sql`),
      "utf8",
    ).split("--> statement-breakpoint");
    for (const statement of statements) await scratch.query(statement);
  }

  it("copies upstream backgrounds and calendar feeds without overwriting fork data", async () => {
    const scratch = new Pool({ connectionString: scratchUrl });
    pool = scratch;
    const scratchDb = drizzle(scratch);
    await runMigrations(scratchDb, { migrationsFolder: priorFolder });
    await createUpstreamObjects(scratch);
    await seedWorkspace(scratch);

    // p1: upstream background only. p2: no background. p3: fork background
    // only. p4: upstream background and a different fork background.
    await scratch.query(
      `UPDATE project SET background_object_key = $1, background_mime_type = 'image/png', background_version = 'v1' WHERE id = 'p1'`,
      [keyOf("p1", "v1")],
    );
    await scratch.query(
      `UPDATE project SET ganttpro_background_object_key = $1, ganttpro_background_mime_type = 'image/webp', ganttpro_background_version = 'f3' WHERE id = 'p3'`,
      [keyOf("p3", "f3")],
    );
    await scratch.query(
      `UPDATE project SET background_object_key = $1, background_mime_type = 'image/png', background_version = 'u4',
              ganttpro_background_object_key = $2, ganttpro_background_mime_type = 'image/jpeg', ganttpro_background_version = 'f4' WHERE id = 'p4'`,
      [keyOf("p4", "u4"), keyOf("p4", "f4")],
    );
    await scratch.query(
      `INSERT INTO calendar_feed (id, project_id, token, label_ids, time_zone, created_at) VALUES
        ('cf1', 'p1', 'upstream-token-1', '["l1","l2"]', 'Europe/Warsaw', $1),
        ('cf2', 'p2', 'upstream-token-2', '[]', 'UTC', $1),
        ('cf3', 'p2', 'shared-token', '["l3"]', 'UTC', $1)`,
      [now],
    );

    // A fork feed that already owns one of the upstream tokens.
    await scratch.query(
      `INSERT INTO ganttpro_calendar_feed (id, project_id, token, label_ids, time_zone, created_at)
       VALUES ('ff1', 'p2', 'shared-token', '["fork"]', 'UTC', $1)`,
      [now],
    );

    await runMigrations(scratchDb, { migrationsFolder });

    expect(await backgrounds(scratch)).toEqual([
      {
        id: "p1",
        key: keyOf("p1", "v1"),
        mime: "image/png",
        version: "v1",
      },
      { id: "p2", key: null, mime: null, version: null },
      { id: "p3", key: keyOf("p3", "f3"), mime: "image/webp", version: "f3" },
      { id: "p4", key: keyOf("p4", "f4"), mime: "image/jpeg", version: "f4" },
    ]);
    expect(await feeds(scratch)).toEqual([
      {
        id: "cf1",
        project_id: "p1",
        token: "upstream-token-1",
        label_ids: ["l1", "l2"],
        time_zone: "Europe/Warsaw",
        created_at: now,
      },
      {
        id: "cf2",
        project_id: "p2",
        token: "upstream-token-2",
        label_ids: [],
        time_zone: "UTC",
        created_at: now,
      },
      {
        id: "ff1",
        project_id: "p2",
        token: "shared-token",
        label_ids: ["fork"],
        time_zone: "UTC",
        created_at: now,
      },
    ]);

    // The upstream data is left in place for a rollback to an upstream image.
    const upstream = await scratch.query(
      "SELECT count(*)::int AS n FROM calendar_feed",
    );
    expect(upstream.rows[0].n).toBe(3);
    const upstreamBackground = await scratch.query(
      `SELECT background_object_key FROM project WHERE id = 'p1'`,
    );
    expect(upstreamBackground.rows[0].background_object_key).toBe(
      keyOf("p1", "v1"),
    );

    // Running the migration statements again changes nothing.
    const backgroundsBefore = await backgrounds(scratch);
    const feedsBefore = await feeds(scratch);
    await runMigrationSql(scratch);
    expect(await backgrounds(scratch)).toEqual(backgroundsBefore);
    expect(await feeds(scratch)).toEqual(feedsBefore);

    // A copied feed behaves like a fork feed: deleting its project cascades.
    await scratch.query(`DELETE FROM project WHERE id = 'p1'`);
    expect(
      (await feeds(scratch)).map((feed: { id: string }) => feed.id),
    ).toEqual(["cf2", "ff1"]);
  });

  it("upgrades a database without the upstream objects untouched", async () => {
    const scratch = new Pool({ connectionString: scratchUrl });
    pool = scratch;
    const scratchDb = drizzle(scratch);
    await runMigrations(scratchDb, { migrationsFolder: priorFolder });
    await seedWorkspace(scratch);
    await scratch.query(
      `UPDATE project SET ganttpro_background_object_key = $1, ganttpro_background_mime_type = 'image/png', ganttpro_background_version = 'f1' WHERE id = 'p1'`,
      [keyOf("p1", "f1")],
    );
    await scratch.query(
      `INSERT INTO ganttpro_calendar_feed (id, project_id, token, label_ids) VALUES ('ff1', 'p1', 'fork-token', '[]')`,
    );
    const absent = await scratch.query(
      `SELECT to_regclass('public.calendar_feed') AS t,
              (SELECT count(*)::int FROM information_schema.columns
               WHERE table_name = 'project' AND column_name LIKE 'background\\_%') AS columns`,
    );
    expect(absent.rows[0]).toEqual({ t: null, columns: 0 });

    await runMigrations(scratchDb, { migrationsFolder });

    expect((await backgrounds(scratch))[0]).toEqual({
      id: "p1",
      key: keyOf("p1", "f1"),
      mime: "image/png",
      version: "f1",
    });
    expect(
      (await feeds(scratch)).map((feed: { id: string }) => feed.id),
    ).toEqual(["ff1"]);
    // The migration must not create the upstream objects itself.
    const created = await scratch.query(
      `SELECT to_regclass('public.calendar_feed') AS t`,
    );
    expect(created.rows[0].t).toBeNull();
  });

  it("adopts only the upstream background columns when the feed table is absent", async () => {
    const scratch = new Pool({ connectionString: scratchUrl });
    pool = scratch;
    const scratchDb = drizzle(scratch);
    await runMigrations(scratchDb, { migrationsFolder: priorFolder });
    await createUpstreamObjects(scratch);
    await scratch.query(`DROP TABLE "calendar_feed"`);
    await seedWorkspace(scratch);
    await scratch.query(
      `UPDATE project SET background_object_key = $1, background_mime_type = 'image/png', background_version = 'v1' WHERE id = 'p1'`,
      [keyOf("p1", "v1")],
    );

    await runMigrations(scratchDb, { migrationsFolder });

    expect((await backgrounds(scratch))[0]).toEqual({
      id: "p1",
      key: keyOf("p1", "v1"),
      mime: "image/png",
      version: "v1",
    });
    expect(await feeds(scratch)).toEqual([]);
  });

  it("adopts the data on a database that recorded a newer migration than this one", async () => {
    const scratch = new Pool({ connectionString: scratchUrl });
    pool = scratch;
    const scratchDb = drizzle(scratch);
    await runMigrations(scratchDb, { migrationsFolder: priorFolder });
    await createUpstreamObjects(scratch);
    await seedWorkspace(scratch);
    await scratch.query(
      `UPDATE project SET background_object_key = $1, background_mime_type = 'image/png', background_version = 'v1' WHERE id = 'p1'`,
      [keyOf("p1", "v1")],
    );
    await scratch.query(
      `INSERT INTO calendar_feed (id, project_id, token, label_ids, created_at) VALUES ('cf1', 'p1', 'upstream-token-1', '[]', $1)`,
      [now],
    );
    // A migration of a later upstream release is recorded with a `when` newer
    // than this migration's. Drizzle's own migrator would skip this migration
    // on such a database; the runner applies every entry whose `when` is not
    // recorded.
    await scratch.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('later-upstream-migration', $1)`,
      [targetWhen + 24 * 60 * 60 * 1000],
    );

    const applied = await runMigrations(scratchDb, { migrationsFolder });

    expect(applied).toEqual([TARGET_TAG]);
    expect((await backgrounds(scratch))[0]).toEqual({
      id: "p1",
      key: keyOf("p1", "v1"),
      mime: "image/png",
      version: "v1",
    });
    expect(
      (await feeds(scratch)).map((feed: { token: string }) => feed.token),
    ).toEqual(["upstream-token-1"]);
    expect(await runMigrations(scratchDb, { migrationsFolder })).toEqual([]);
  });
});
