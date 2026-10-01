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
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  LEGACY_WATERMARK_LAST_TAG,
  runMigrations,
} from "../../apps/api/src/database/run-migrations";
import { reconcileMigrationJournal } from "../../apps/api/src/utils/adopt-existing-database";

// The startup migrator (apps/api/src/database/run-migrations.ts) on real
// PostgreSQL databases. It records every applied entry and runs an entry that
// is not recorded, whatever its `when`, except for the legacy entries up to
// LEGACY_WATERMARK_LAST_TAG, which keep Drizzle's watermark rule. Each test
// works on scratch databases that are dropped afterwards.

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../apps/api/drizzle");

// The `when` values of upstream's own 0051 to 0055 (0055_huge_sue_storm is the
// newest, 2026-09-30). A database created by upstream records them; this
// fork's journal has other entries with other `when` values at those places.
const UPSTREAM_0051_TO_0055 = [
  1790370789562, 1790405156847, 1790406015959, 1790438033113, 1790763801959,
];
const UPSTREAM_0045_TAG = "0045_fantastic_princess_powerful";

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};
type Journal = { version: string; dialect: string; entries: JournalEntry[] };

function readJournal(folder: string): Journal {
  return JSON.parse(
    readFileSync(join(folder, "meta", "_journal.json"), "utf8"),
  ) as Journal;
}

function writeJournal(folder: string, journal: Journal) {
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify(journal));
}

const entries = readJournal(migrationsFolder).entries;
const tags = entries.map((entry) => entry.tag);
const cutoffIndex = tags.indexOf(LEGACY_WATERMARK_LAST_TAG);
const tagsAfterCutoff = tags.slice(cutoffIndex + 1);

function withDatabase(connectionString: string, database: string) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

describe("migration runner", () => {
  const baseUrl = process.env.DATABASE_URL as string;
  const scratchPrefix = `${new URL(baseUrl).pathname
    .replace(/^\//, "")
    .replace(/_test$/, "")}_migration_runner_`;
  const scratchNames: string[] = [];
  const pools: Pool[] = [];
  const folders: string[] = [];

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

  async function dropScratch(name: string) {
    if (!name.startsWith(scratchPrefix) || !name.endsWith("_test")) {
      throw new Error(`Refusing to drop "${name}"`);
    }
    await withAdmin((admin) =>
      admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
    );
  }

  function openPool(name: string) {
    const pool = new Pool({ connectionString: withDatabase(baseUrl, name) });
    pools.push(pool);
    return pool;
  }

  async function createScratch(label: string) {
    const name = `${scratchPrefix}${label}_test`;
    await dropScratch(name);
    scratchNames.push(name);
    await withAdmin((admin) => admin.query(`CREATE DATABASE "${name}"`));
    const pool = openPool(name);
    return { name, pool, db: drizzle(pool) };
  }

  function tempFolder() {
    const folder = mkdtempSync(join(tmpdir(), "kaneo-migration-runner-"));
    folders.push(folder);
    return folder;
  }

  // A copy of the migration folder whose journal ends after `lastTag`.
  function truncatedFolder(lastTag: string) {
    const folder = tempFolder();
    cpSync(migrationsFolder, folder, { recursive: true });
    const journal = readJournal(folder);
    const index = journal.entries.findIndex((entry) => entry.tag === lastTag);
    expect(index).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, index + 1);
    writeJournal(folder, journal);
    return folder;
  }

  function fullFolder() {
    return truncatedFolder(tags[tags.length - 1] as string);
  }

  function appendEntry(
    folder: string,
    entry: { tag: string; when: number; sql: string },
  ) {
    const journal = readJournal(folder);
    journal.entries.push({
      idx: journal.entries.length,
      version: "7",
      when: entry.when,
      tag: entry.tag,
      breakpoints: true,
    });
    writeJournal(folder, journal);
    writeFileSync(join(folder, `${entry.tag}.sql`), entry.sql);
  }

  async function recordedRows(pool: Pool) {
    const result = await pool.query<{ hash: string; created_at: string }>(
      "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id",
    );
    return result.rows;
  }

  async function recordedWhens(pool: Pool) {
    return (await recordedRows(pool)).map((row) => Number(row.created_at));
  }

  async function exists(pool: Pool, query: string) {
    return (await pool.query(query)).rowCount === 1;
  }

  const tableExists = (pool: Pool, table: string) =>
    exists(
      pool,
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}'`,
    );
  const columnExists = (pool: Pool, table: string, column: string) =>
    exists(
      pool,
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}'`,
    );
  const indexExists = (pool: Pool, index: string) =>
    exists(
      pool,
      `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = '${index}'`,
    );

  beforeAll(() => {
    // The scenarios below rely on these facts about the real journal.
    expect(cutoffIndex).toBeGreaterThan(0);
    expect(tagsAfterCutoff.length).toBeGreaterThanOrEqual(9);
    const whens = new Set(entries.map((entry) => entry.when));
    for (const when of UPSTREAM_0051_TO_0055) {
      expect(whens.has(when)).toBe(false);
    }
  });

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
    for (const name of scratchNames.splice(0)) {
      await dropScratch(name);
    }
  });

  afterAll(() => {
    for (const folder of folders.splice(0)) {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("applies every entry on a fresh database and nothing on the second call", async () => {
    const scratch = await createScratch("fresh");

    const applied = await runMigrations(scratch.db, { migrationsFolder });
    expect(applied).toEqual(tags);

    const again = await runMigrations(scratch.db, { migrationsFolder });
    expect(again).toEqual([]);

    const rows = await recordedRows(scratch.pool);
    expect(rows).toHaveLength(entries.length);
    expect(rows.map((row) => Number(row.created_at))).toEqual(
      entries.map((entry) => entry.when),
    );
    expect(await tableExists(scratch.pool, "task")).toBe(true);
    expect(await columnExists(scratch.pool, "activity", "actor_via")).toBe(
      true,
    );
  }, 120_000);

  it("records the same rows and builds the same tables as Drizzle's migrator", async () => {
    const runner = await createScratch("same_runner");
    const drizzleOwn = await createScratch("same_drizzle");

    await runMigrations(runner.db, { migrationsFolder });
    await migrate(drizzleOwn.db, { migrationsFolder });

    expect(await recordedRows(runner.pool)).toEqual(
      await recordedRows(drizzleOwn.pool),
    );
    const tableQuery = `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name`;
    expect((await runner.pool.query(tableQuery)).rows).toEqual(
      (await drizzleOwn.pool.query(tableQuery)).rows,
    );
  }, 120_000);

  it("leaves a fresh database to the runner when reconciling", async () => {
    const scratch = await createScratch("fresh_reconcile");

    await reconcileMigrationJournal(migrationsFolder, scratch.db);

    expect(await recordedRows(scratch.pool)).toEqual([]);
    expect(await tableExists(scratch.pool, "account")).toBe(false);
  });

  it("refuses a journal without the legacy cutoff entry", async () => {
    const scratch = await createScratch("no_cutoff");
    const folder = truncatedFolder("0045_fantastic_princess_powerful");

    await expect(
      runMigrations(scratch.db, { migrationsFolder: folder }),
    ).rejects.toThrow(/no entry "0050_resumable_github_import"/);
    expect(await tableExists(scratch.pool, "account")).toBe(false);

    const applied = await runMigrations(scratch.db, {
      migrationsFolder: folder,
      legacyWatermarkLastTag: UPSTREAM_0045_TAG,
    });
    expect(applied).toEqual(tags.slice(0, tags.indexOf(UPSTREAM_0045_TAG) + 1));
  }, 120_000);

  describe("a migration merged late", () => {
    const LATE_TAG = "20260930120000_ganttpro_late_probe";
    const LATE_SQL = `CREATE TABLE "ganttpro_late_probe" ("id" text PRIMARY KEY NOT NULL);\n`;
    const newestWhen = Math.max(...entries.map((entry) => entry.when));
    // Older than the newest entry, newer than the legacy cutoff.
    const lateWhen = newestWhen - 1;

    it("runs with the runner and is skipped by Drizzle's migrator", async () => {
      const runner = await createScratch("late_runner");
      const drizzleOwn = await createScratch("late_drizzle");
      await runMigrations(runner.db, { migrationsFolder });
      await migrate(drizzleOwn.db, { migrationsFolder });

      const withLate = fullFolder();
      appendEntry(withLate, { tag: LATE_TAG, when: lateWhen, sql: LATE_SQL });
      expect(lateWhen).toBeLessThan(newestWhen);
      expect(lateWhen).toBeGreaterThan(entries[cutoffIndex]?.when as number);

      expect(
        await runMigrations(runner.db, { migrationsFolder: withLate }),
      ).toEqual([LATE_TAG]);
      expect(await tableExists(runner.pool, "ganttpro_late_probe")).toBe(true);
      expect(await recordedWhens(runner.pool)).toContain(lateWhen);
      expect(
        await runMigrations(runner.db, { migrationsFolder: withLate }),
      ).toEqual([]);
      expect(await recordedRows(runner.pool)).toHaveLength(entries.length + 1);

      await migrate(drizzleOwn.db, { migrationsFolder: withLate });
      expect(await tableExists(drizzleOwn.pool, "ganttpro_late_probe")).toBe(
        false,
      );
      expect(await recordedRows(drizzleOwn.pool)).toHaveLength(entries.length);
    }, 120_000);

    it("rolls the whole run back when a later migration fails", async () => {
      const scratch = await createScratch("late_failure");
      await runMigrations(scratch.db, { migrationsFolder });
      const before = await recordedRows(scratch.pool);

      const broken = fullFolder();
      appendEntry(broken, { tag: LATE_TAG, when: lateWhen, sql: LATE_SQL });
      appendEntry(broken, {
        tag: "20260930120100_ganttpro_broken",
        when: newestWhen + 1,
        sql: "CREATE TABLE ganttpro_broken (id text);\n--> statement-breakpoint\nSELECT * FROM table_that_does_not_exist;\n",
      });

      await expect(
        runMigrations(scratch.db, { migrationsFolder: broken }),
      ).rejects.toThrow(/table_that_does_not_exist/);

      expect(await recordedRows(scratch.pool)).toEqual(before);
      expect(await tableExists(scratch.pool, "ganttpro_late_probe")).toBe(
        false,
      );
      expect(await tableExists(scratch.pool, "ganttpro_broken")).toBe(false);
    }, 120_000);
  });

  describe("a database created by upstream", () => {
    it("at upstream's 0055 applies the fork migrations 0051 to 0059", async () => {
      const scratch = await createScratch("upstream_0055");
      // Upstream's schema up to 0050, which is what this journal shares.
      await runMigrations(scratch.db, {
        migrationsFolder: truncatedFolder(LEGACY_WATERMARK_LAST_TAG),
      });
      // Emulate upstream's newest state: its rows for 0051 to 0055.
      for (const when of UPSTREAM_0051_TO_0055) {
        await scratch.pool.query(
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
          [`upstream-${when}`, when],
        );
      }
      expect(await tableExists(scratch.pool, "ganttpro_resource")).toBe(false);
      const before = await recordedRows(scratch.pool);

      await reconcileMigrationJournal(migrationsFolder, scratch.db);
      expect(await recordedRows(scratch.pool)).toEqual(before);

      const applied = await runMigrations(scratch.db, { migrationsFolder });

      expect(applied).toEqual(tagsAfterCutoff);
      expect(applied).toEqual(
        expect.arrayContaining([
          "0051_ganttpro_additions",
          "0055_ganttpro_resources",
          "0058_ganttpro_resource_invitation",
          "0059_ganttpro_actor_source",
        ]),
      );
      // 0055 creates the resource table, 0059 the actor columns.
      expect(await tableExists(scratch.pool, "ganttpro_resource")).toBe(true);
      expect(await columnExists(scratch.pool, "activity", "actor_via")).toBe(
        true,
      );
      expect(await columnExists(scratch.pool, "session", "auth_via")).toBe(
        true,
      );
      const whens = await recordedWhens(scratch.pool);
      expect(whens).toHaveLength(entries.length + UPSTREAM_0051_TO_0055.length);
      for (const when of [
        ...entries.map((entry) => entry.when),
        ...UPSTREAM_0051_TO_0055,
      ]) {
        expect(whens.filter((recorded) => recorded === when)).toHaveLength(1);
      }
      expect(await runMigrations(scratch.db, { migrationsFolder })).toEqual([]);
    }, 120_000);

    it("at upstream's 0055 is skipped by Drizzle's migrator up to the fork's 0058", async () => {
      const scratch = await createScratch("upstream_0055_drizzle");
      await migrate(scratch.db, {
        migrationsFolder: truncatedFolder(LEGACY_WATERMARK_LAST_TAG),
      });
      for (const when of UPSTREAM_0051_TO_0055) {
        await scratch.pool.query(
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
          [`upstream-${when}`, when],
        );
      }

      await migrate(scratch.db, { migrationsFolder });

      // Only the fork's 0059 is newer than upstream's newest row.
      expect(await tableExists(scratch.pool, "ganttpro_resource")).toBe(false);
      expect(await columnExists(scratch.pool, "activity", "actor_via")).toBe(
        true,
      );
    }, 120_000);

    it("at 0045 applies 0046 to 0050 and the fork migrations", async () => {
      const scratch = await createScratch("upstream_0045");
      await runMigrations(scratch.db, {
        migrationsFolder: truncatedFolder(UPSTREAM_0045_TAG),
        legacyWatermarkLastTag: UPSTREAM_0045_TAG,
      });
      // A project whose task counter is behind its tasks: 0046 repairs it.
      await scratch.pool.query(
        `INSERT INTO workspace (id, name, slug, created_at) VALUES ('w1', 'w1', 'w1', now())`,
      );
      await scratch.pool.query(
        `INSERT INTO project (id, workspace_id, slug, name) VALUES ('p1', 'w1', 'p1', 'p1')`,
      );
      await scratch.pool.query(
        `INSERT INTO task (id, project_id, title, status, priority, number, position)
         VALUES ('t1', 'p1', 't1', 'to-do', 'medium', 5, 1)`,
      );
      const counterBefore = await scratch.pool.query(
        `SELECT last_task_number FROM project WHERE id = 'p1'`,
      );
      expect(counterBefore.rows[0].last_task_number).toBeLessThan(5);
      expect(await tableExists(scratch.pool, "github_import")).toBe(false);
      expect(
        await columnExists(scratch.pool, "label", "deletion_started_at"),
      ).toBe(false);
      expect(
        await indexExists(scratch.pool, "label_workspace_cascade_idx"),
      ).toBe(false);
      const before = await recordedRows(scratch.pool);

      await reconcileMigrationJournal(migrationsFolder, scratch.db);
      expect(await recordedRows(scratch.pool)).toEqual(before);

      const applied = await runMigrations(scratch.db, { migrationsFolder });

      expect(applied).toEqual(tags.slice(tags.indexOf(UPSTREAM_0045_TAG) + 1));
      expect(applied.slice(0, 5)).toEqual([
        "0046_repair_task_number_counters",
        "0047_repair_legacy_auth_ownership",
        "0048_resumable_label_deletion",
        "0049_label_cascade_index",
        "0050_resumable_github_import",
      ]);
      // 0046 repaired the counter, 0048 to 0050 created their objects.
      const counterAfter = await scratch.pool.query(
        `SELECT last_task_number FROM project WHERE id = 'p1'`,
      );
      expect(counterAfter.rows[0].last_task_number).toBe(5);
      expect(await tableExists(scratch.pool, "github_import")).toBe(true);
      expect(
        await columnExists(scratch.pool, "label", "deletion_started_at"),
      ).toBe(true);
      expect(
        await indexExists(scratch.pool, "label_workspace_cascade_idx"),
      ).toBe(true);
      // The fork's migrations ran as well.
      expect(await tableExists(scratch.pool, "ganttpro_resource")).toBe(true);
      expect(await recordedRows(scratch.pool)).toHaveLength(entries.length);
    }, 120_000);
  });

  describe("reconcileMigrationJournal on an older fork database", () => {
    // A fork installation built from a regenerated baseline: the schema is at
    // 0050 but no recorded `created_at` equals a baseline entry's `when`.
    async function databaseWithForeignJournal(
      label: string,
      rewrite: (pool: Pool) => Promise<unknown>,
    ) {
      const scratch = await createScratch(label);
      await runMigrations(scratch.db, {
        migrationsFolder: truncatedFolder(LEGACY_WATERMARK_LAST_TAG),
      });
      await rewrite(scratch.pool);
      return scratch;
    }

    const baselineWhens = entries
      .filter((entry) => !entry.tag.includes("ganttpro"))
      .map((entry) => entry.when);

    it("rewrites the baseline rows when none of them matches", async () => {
      const scratch = await databaseWithForeignJournal("foreign", (pool) =>
        pool.query(
          "UPDATE drizzle.__drizzle_migrations SET created_at = id * 1000",
        ),
      );
      expect(
        (await recordedWhens(scratch.pool)).some((when) =>
          baselineWhens.includes(when),
        ),
      ).toBe(false);

      await reconcileMigrationJournal(migrationsFolder, scratch.db);
      expect(await recordedWhens(scratch.pool)).toEqual(baselineWhens);

      const applied = await runMigrations(scratch.db, { migrationsFolder });
      expect(applied).toEqual(tagsAfterCutoff);
      expect(await tableExists(scratch.pool, "ganttpro_resource")).toBe(true);
    }, 120_000);

    it("rewrites the baseline rows when the journal table has no rows", async () => {
      const scratch = await databaseWithForeignJournal("empty", (pool) =>
        pool.query("DELETE FROM drizzle.__drizzle_migrations"),
      );
      expect(await recordedRows(scratch.pool)).toEqual([]);

      await reconcileMigrationJournal(migrationsFolder, scratch.db);
      expect(await recordedWhens(scratch.pool)).toEqual(baselineWhens);

      const applied = await runMigrations(scratch.db, { migrationsFolder });
      expect(applied).toEqual(tagsAfterCutoff);
    }, 120_000);
  });

  it("applies each entry once when two instances start together", async () => {
    const first = await createScratch("concurrent");
    const secondPool = openPool(first.name);
    const second = drizzle(secondPool);

    const [appliedFirst, appliedSecond] = await Promise.all([
      runMigrations(first.db, { migrationsFolder }),
      runMigrations(second, { migrationsFolder }),
    ]);

    expect([...appliedFirst, ...appliedSecond].sort()).toEqual(
      [...tags].sort(),
    );
    expect(appliedFirst.length === 0 || appliedSecond.length === 0).toBe(true);
    const whens = await recordedWhens(first.pool);
    expect(whens).toHaveLength(entries.length);
    expect(new Set(whens).size).toBe(entries.length);
  }, 120_000);
});
