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
} from "vite-plus/test";
import { runMigrations } from "../../apps/api/src/database/run-migrations";

// Upstream's 0054 to 0063 (without 0060) were merged into this journal with
// their upstream tags. Upstream 0057_common_deadpool queues the storage objects
// of deleted assets and projects; this journal carries a copy adapted to the
// fork's project.ganttpro_background_object_key, and
// 20261015040923_ganttpro_adopt_upstream_schema brings a database created by
// upstream (which recorded upstream's own 0057) to the same state.
//
// Two databases are upgraded with the runner the API uses at start-up:
// - a fork database at the newest entry before the merge;
// - the same database after upstream's ORIGINAL 0057 was applied and recorded,
//   as on a database created by upstream.

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../apps/api/drizzle");
const PREVIOUS_TAG = "20261005135555_ganttpro_task_estimate";
const ADOPT_TAG = "20261015040923_ganttpro_adopt_upstream_schema";
const UPSTREAM_0057_TAG = "0057_common_deadpool";

// Upstream's 0057_common_deadpool as upstream ships it (plus the column it
// relies on, which upstream's 0052_dear_beyonder adds).
const UPSTREAM_0057_SQL = `
ALTER TABLE "project" ADD COLUMN "background_object_key" text;
CREATE TABLE "storage_cleanup" (
  "object_key" text PRIMARY KEY NOT NULL,
  "last_attempt_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "project_background_object_key_idx" ON "project" USING btree ("background_object_key") WHERE "project"."background_object_key" is not null;
CREATE FUNCTION queue_deleted_storage_object() RETURNS trigger AS $$
DECLARE cleanup_key text;
BEGIN
  IF TG_TABLE_NAME = 'asset' THEN
    cleanup_key := OLD.object_key;
  ELSE
    cleanup_key := OLD.background_object_key;
  END IF;
  IF cleanup_key IS NOT NULL THEN
    INSERT INTO storage_cleanup (object_key) VALUES (cleanup_key)
      ON CONFLICT (object_key) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER asset_storage_cleanup BEFORE DELETE ON asset
  FOR EACH ROW EXECUTE FUNCTION queue_deleted_storage_object();
CREATE TRIGGER project_storage_cleanup BEFORE DELETE ON project
  FOR EACH ROW EXECUTE FUNCTION queue_deleted_storage_object();
`;

type JournalEntry = { tag: string; when: number };

function withDatabase(connectionString: string, database: string) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

describe("migration ganttpro_adopt_upstream_schema", () => {
  const baseUrl = process.env.DATABASE_URL as string;
  const scratchName = `${new URL(baseUrl).pathname
    .replace(/^\//, "")
    .replace(/_test$/, "")}_upstream_schema_upgrade_test`;
  const scratchUrl = withDatabase(baseUrl, scratchName);
  let priorFolder = "";
  let entries: JournalEntry[] = [];
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
    if (!scratchName.endsWith("_upstream_schema_upgrade_test")) {
      throw new Error(`Refusing to drop "${scratchName}"`);
    }
    await withAdmin((admin) =>
      admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`),
    );
  }

  beforeAll(() => {
    priorFolder = mkdtempSync(
      join(tmpdir(), "kaneo-migrations-task-estimate-"),
    );
    cpSync(migrationsFolder, priorFolder, { recursive: true });
    const journalPath = join(priorFolder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: JournalEntry[];
    };
    entries = [...journal.entries];
    const cut = journal.entries.findIndex(
      (entry) => entry.tag === PREVIOUS_TAG,
    );
    expect(cut).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, cut + 1);
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

  function whenOf(tag: string) {
    const entry = entries.find((candidate) => candidate.tag === tag);
    if (!entry) throw new Error(`The journal has no entry ${tag}.`);
    return entry.when;
  }

  async function openPriorDatabase() {
    const scratch = new Pool({ connectionString: scratchUrl });
    pool = scratch;
    const scratchDb = drizzle(scratch);
    await runMigrations(scratchDb, { migrationsFolder: priorFolder });
    return { scratch, scratchDb };
  }

  async function seedProject(scratch: Pool) {
    await scratch.query(
      `INSERT INTO workspace (id, name, slug, created_at) VALUES ('w1', 'w1', 'w1', now())`,
    );
    await scratch.query(
      `INSERT INTO project (id, workspace_id, slug, name, ganttpro_background_object_key)
       VALUES ('p1', 'w1', 'p1', 'p1', 'workspace/w1/project/p1/backgrounds/background-f1')`,
    );
  }

  async function queuedKeys(scratch: Pool) {
    const result = await scratch.query<{ object_key: string }>(
      "SELECT object_key FROM storage_cleanup ORDER BY object_key",
    );
    return result.rows.map((row) => row.object_key);
  }

  async function calendarFeedDefault(scratch: Pool) {
    const result = await scratch.query<{ column_default: string }>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ganttpro_calendar_feed'
         AND column_name = 'created_at'`,
    );
    return result.rows[0]?.column_default;
  }

  it("upgrades a fork database and queues the fork's background on project deletion", async () => {
    const { scratch, scratchDb } = await openPriorDatabase();
    await seedProject(scratch);

    const applied = await runMigrations(scratchDb, { migrationsFolder });

    expect(applied).toEqual([
      "0054_backfill_instance_admin",
      "0055_huge_sue_storm",
      "0056_strange_zaladane",
      UPSTREAM_0057_TAG,
      "0058_ambiguous_network",
      "0059_odd_medusa",
      "0061_slim_yellowjacket",
      "0062_motionless_sister_grimm",
      "0063_import_runs",
      ADOPT_TAG,
    ]);
    expect(applied).not.toContain("0060_flaky_ezekiel");
    expect(await calendarFeedDefault(scratch)).toBe(
      "(now() AT TIME ZONE 'utc'::text)",
    );

    await scratch.query(`DELETE FROM workspace WHERE id = 'w1'`);
    expect(await queuedKeys(scratch)).toEqual([
      "workspace/w1/project/p1/backgrounds/background-f1",
    ]);
  }, 120_000);

  it("repairs upstream's storage trigger on a database created by upstream", async () => {
    const { scratch, scratchDb } = await openPriorDatabase();
    await scratch.query(UPSTREAM_0057_SQL);
    await scratch.query(
      "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
      ["upstream-0057", whenOf(UPSTREAM_0057_TAG)],
    );
    await seedProject(scratch);
    await scratch.query(
      `UPDATE project SET background_object_key = 'workspace/w1/project/p1/backgrounds/background-u1' WHERE id = 'p1'`,
    );

    const applied = await runMigrations(scratchDb, { migrationsFolder });

    expect(applied).not.toContain(UPSTREAM_0057_TAG);
    expect(applied).toContain(ADOPT_TAG);
    const index = await scratch.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
         AND indexname = 'ganttpro_project_background_object_key_idx'`,
    );
    expect(index.rowCount).toBe(1);

    // Both the fork's and upstream's object are queued, with no error for the
    // column upstream's function read directly.
    await scratch.query(`DELETE FROM workspace WHERE id = 'w1'`);
    expect(await queuedKeys(scratch)).toEqual([
      "workspace/w1/project/p1/backgrounds/background-f1",
      "workspace/w1/project/p1/backgrounds/background-u1",
    ]);
  }, 120_000);
});
