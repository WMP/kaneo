import {
  cpSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../apps/api/src/database/run-migrations";

// The Jira migration was first shipped as 0059_ganttpro_jira_integration (image
// sha-ad61d23). It is now 20260930053654_ganttpro_jira_integration, because
// main's 0059_ganttpro_actor_source keeps the number. The runner identifies an
// applied entry by its `when`, so the re-issued entry must keep the `when` that
// such a database recorded, and its SQL must stay what that database ran.

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../apps/api/drizzle");

const JIRA_TAG = "20260930053654_ganttpro_jira_integration";
const JIRA_WHEN = 1790746614721;
const OLD_JIRA_TAG = "0059_ganttpro_jira_integration";
const ACTOR_SOURCE_TAG = "0059_ganttpro_actor_source";

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

function withDatabase(connectionString: string, database: string) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

const JIRA_TABLES = [
  "ganttpro_jira_connection",
  "ganttpro_jira_issue_link",
  "ganttpro_jira_mapping",
  "ganttpro_jira_status_proposal",
  "ganttpro_jira_user_token",
];

describe("Jira migration upgrade", () => {
  const baseUrl = process.env.DATABASE_URL as string;
  const scratchPrefix = `${new URL(baseUrl).pathname
    .replace(/^\//, "")
    .replace(/_test$/, "")}_jira_migration_`;
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

  async function createScratch(label: string) {
    const name = `${scratchPrefix}${label}_test`;
    await dropScratch(name);
    scratchNames.push(name);
    await withAdmin((admin) => admin.query(`CREATE DATABASE "${name}"`));
    const pool = new Pool({ connectionString: withDatabase(baseUrl, name) });
    pools.push(pool);
    return { pool, db: drizzle(pool) };
  }

  // The scenarios below describe the state of the branch when the Jira
  // migration was its newest entry, so a copy ends at that entry: later
  // migrations are neither applied nor expected in the results.
  function copyFolder() {
    const folder = mkdtempSync(join(tmpdir(), "kaneo-jira-migration-"));
    folders.push(folder);
    cpSync(migrationsFolder, folder, { recursive: true });
    const journal = readJournal(folder);
    const jiraIdx = journal.entries.findIndex(({ tag }) => tag === JIRA_TAG);
    expect(jiraIdx).toBeGreaterThan(0);
    for (const later of journal.entries.slice(jiraIdx + 1)) {
      rmSync(join(folder, `${later.tag}.sql`));
    }
    journal.entries = journal.entries.slice(0, jiraIdx + 1);
    writeJournal(folder, journal);
    return folder;
  }

  // The folder that image sha-ad61d23 shipped: the Jira migration is 0059 and
  // main's actor-source migration does not exist yet.
  function imageFolder() {
    const folder = copyFolder();
    const journal = readJournal(folder);
    journal.entries = journal.entries
      .filter((entry) => entry.tag !== ACTOR_SOURCE_TAG)
      .map((entry) =>
        entry.tag === JIRA_TAG ? { ...entry, tag: OLD_JIRA_TAG } : entry,
      )
      .map((entry, idx) => ({ ...entry, idx }));
    writeJournal(folder, journal);
    renameSync(
      join(folder, `${JIRA_TAG}.sql`),
      join(folder, `${OLD_JIRA_TAG}.sql`),
    );
    rmSync(join(folder, `${ACTOR_SOURCE_TAG}.sql`));
    return folder;
  }

  // The folder of a database that is on main: no Jira migration.
  function mainFolder() {
    const folder = copyFolder();
    const journal = readJournal(folder);
    journal.entries = journal.entries.filter((entry) => entry.tag !== JIRA_TAG);
    writeJournal(folder, journal);
    rmSync(join(folder, `${JIRA_TAG}.sql`));
    return folder;
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

  async function recordedWhens(pool: Pool) {
    const result = await pool.query<{ created_at: string }>(
      "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY id",
    );
    return result.rows.map((row) => Number(row.created_at));
  }

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

  it("keeps the `when` and the SQL of the migration that image sha-ad61d23 applied", () => {
    const journal = readJournal(migrationsFolder);
    const entry = journal.entries.find(({ tag }) => tag === JIRA_TAG);
    expect(entry?.when).toBe(JIRA_WHEN);
    // The SQL only touches the five Jira tables, so it cannot collide with a
    // table that main's migrations own, whatever order they run in.
    const sqlText = readFileSync(
      join(migrationsFolder, `${JIRA_TAG}.sql`),
      "utf8",
    );
    const touched = new Set(
      [...sqlText.matchAll(/(?:CREATE TABLE|ALTER TABLE) "([a-z_]+)"/g)].map(
        (match) => match[1],
      ),
    );
    expect([...touched].sort()).toEqual([...JIRA_TABLES].sort());
  });

  it("does not run again on a database that applied it as 0059 from the image", async () => {
    const scratch = await createScratch("from_image");
    const image = imageFolder();
    const firstRun = await runMigrations(scratch.db, {
      migrationsFolder: image,
    });
    expect(firstRun.at(-1)).toBe(OLD_JIRA_TAG);
    expect(await recordedWhens(scratch.pool)).toContain(JIRA_WHEN);
    expect(await columnExists(scratch.pool, "activity", "actor_via")).toBe(
      false,
    );

    // The same database starts the merged branch: only main's migration is
    // missing. Running Jira's CREATE TABLE again would fail the start.
    const head = copyFolder();
    const applied = await runMigrations(scratch.db, {
      migrationsFolder: head,
    });

    expect(applied).toEqual([ACTOR_SOURCE_TAG]);
    for (const table of JIRA_TABLES) {
      expect(await tableExists(scratch.pool, table)).toBe(true);
    }
    expect(await columnExists(scratch.pool, "activity", "actor_via")).toBe(
      true,
    );
    expect(await columnExists(scratch.pool, "session", "auth_via")).toBe(true);
    const whens = await recordedWhens(scratch.pool);
    expect(whens.filter((when) => when === JIRA_WHEN)).toHaveLength(1);
    expect(await runMigrations(scratch.db, { migrationsFolder: head })).toEqual(
      [],
    );
  }, 120_000);

  it("runs after main's migration on a database that already applied 0059_ganttpro_actor_source", async () => {
    const scratch = await createScratch("on_main");
    await runMigrations(scratch.db, { migrationsFolder: mainFolder() });
    expect(await columnExists(scratch.pool, "activity", "actor_via")).toBe(
      true,
    );
    for (const table of JIRA_TABLES) {
      expect(await tableExists(scratch.pool, table)).toBe(false);
    }
    // The Jira `when` is older than the newest recorded one (the watermark of
    // Drizzle's own migrator), and the runner still applies the entry.
    const recorded = await recordedWhens(scratch.pool);
    expect(Math.max(...recorded)).toBeGreaterThan(JIRA_WHEN);

    const head = copyFolder();
    const applied = await runMigrations(scratch.db, {
      migrationsFolder: head,
    });

    expect(applied).toEqual([JIRA_TAG]);
    for (const table of JIRA_TABLES) {
      expect(await tableExists(scratch.pool, table)).toBe(true);
    }
    expect(await runMigrations(scratch.db, { migrationsFolder: head })).toEqual(
      [],
    );
  }, 120_000);

  it("creates the Jira tables and main's columns on a fresh database", async () => {
    const scratch = await createScratch("fresh");

    const applied = await runMigrations(scratch.db, { migrationsFolder });

    expect(applied).toContain(JIRA_TAG);
    expect(applied).toContain(ACTOR_SOURCE_TAG);
    for (const table of JIRA_TABLES) {
      expect(await tableExists(scratch.pool, table)).toBe(true);
    }
    expect(await columnExists(scratch.pool, "activity", "actor_via")).toBe(
      true,
    );
  }, 120_000);
});
