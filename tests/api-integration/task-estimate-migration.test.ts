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

// A preview image applied an earlier migration, 20261005125019_ganttpro_task_estimate
// (commit f59ba12), that was later removed and replaced by
// 20261005135555_ganttpro_task_estimate. The replacement adds the same columns
// and the first check plus a second check. The runner decides by `when`, so the
// old recorded value matches no entry and the new entry runs on a database that
// already has the columns. This test reproduces that database and upgrades it.

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../apps/api/drizzle");
const TARGET_TAG = "20261005135555_ganttpro_task_estimate";
const PREVIOUS_TAG = "20261001100317_ganttpro_adopt_upstream_assets";
// `when` of the removed entry in the journal of f59ba12.
const OLD_WHEN = 1791204619043;

// Verbatim from f59ba12:apps/api/drizzle/20261005125019_ganttpro_task_estimate.sql.
const OLD_MIGRATION_SQL = [
  `ALTER TABLE "task" ADD COLUMN "ganttpro_estimate_minutes" integer;`,
  `ALTER TABLE "task" ADD COLUMN "ganttpro_estimate_unit" text DEFAULT 'hours' NOT NULL;`,
  `ALTER TABLE "task" ADD CONSTRAINT "ganttpro_task_estimate_minutes_range" CHECK ("task"."ganttpro_estimate_minutes" IS NULL OR "task"."ganttpro_estimate_minutes" >= 0);`,
];

function withDatabase(connectionString: string, database: string) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

describe("migration ganttpro_task_estimate on a preview database", () => {
  const baseUrl = process.env.DATABASE_URL as string;
  const scratchName = `${new URL(baseUrl).pathname
    .replace(/^\//, "")
    .replace(/_test$/, "")}_task_estimate_upgrade_test`;
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
    if (!scratchName.endsWith("_task_estimate_upgrade_test")) {
      throw new Error(`Refusing to drop "${scratchName}"`);
    }
    await withAdmin((admin) =>
      admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`),
    );
  }

  beforeAll(() => {
    priorFolder = mkdtempSync(join(tmpdir(), "kaneo-migrations-estimate-"));
    cpSync(migrationsFolder, priorFolder, { recursive: true });
    const journalPath = join(priorFolder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: { tag: string; when: number }[];
    };
    const cut = journal.entries.findIndex((entry) => entry.tag === TARGET_TAG);
    expect(cut).toBeGreaterThan(0);
    expect(journal.entries[cut - 1].tag).toBe(PREVIOUS_TAG);
    targetWhen = journal.entries[cut].when;
    // The removed entry is not in the journal any more.
    expect(journal.entries.map((entry) => entry.when)).not.toContain(OLD_WHEN);
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

  it("upgrades a database that applied the removed earlier migration", async () => {
    const scratch = new Pool({ connectionString: scratchUrl });
    pool = scratch;
    const scratchDb = drizzle(scratch);
    await runMigrations(scratchDb, { migrationsFolder: priorFolder });

    // State of the preview database: the old SQL ran and its `when` is recorded.
    for (const statement of OLD_MIGRATION_SQL) await scratch.query(statement);
    await scratch.query(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ('old-hash', $1)`,
      [OLD_WHEN],
    );
    await scratch.query(
      `INSERT INTO workspace (id, name, slug, created_at) VALUES ('w1', 'w1', 'w1', now())`,
    );
    await scratch.query(
      `INSERT INTO project (id, workspace_id, slug, name) VALUES ('p1', 'w1', 'p1', 'p1')`,
    );
    await scratch.query(
      `INSERT INTO task (id, project_id, title, status, priority, number, position, start_date, ganttpro_estimate_minutes, ganttpro_estimate_unit)
       VALUES ('t1', 'p1', 't1', 'to-do', 'medium', 1, 1, now(), 480, 'days')`,
    );

    const applied = await runMigrations(scratchDb, { migrationsFolder });
    expect(applied).toEqual([TARGET_TAG]);

    const recorded = await scratch.query(
      `SELECT created_at::bigint AS when FROM "drizzle"."__drizzle_migrations" WHERE created_at = $1`,
      [targetWhen],
    );
    expect(recorded.rowCount).toBe(1);

    const task = await scratch.query(
      `SELECT ganttpro_estimate_minutes AS minutes, ganttpro_estimate_unit AS unit FROM task WHERE id = 't1'`,
    );
    expect(task.rows).toEqual([{ minutes: 480, unit: "days" }]);

    const constraints = await scratch.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'public.task'::regclass AND conname LIKE 'ganttpro_task_estimate%'
       ORDER BY conname`,
    );
    expect(
      constraints.rows.map((row: { conname: string }) => row.conname),
    ).toEqual([
      "ganttpro_task_estimate_minutes_range",
      "ganttpro_task_estimate_no_full_date_range",
    ]);

    // The new check is enforced: an estimated task cannot get both dates.
    await expect(
      scratch.query(`UPDATE task SET due_date = now() WHERE id = 't1'`),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "ganttpro_task_estimate_no_full_date_range",
    });
    await expect(
      scratch.query(
        `UPDATE task SET ganttpro_estimate_minutes = -1 WHERE id = 't1'`,
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "ganttpro_task_estimate_minutes_range",
    });

    // A second run has nothing left to apply.
    expect(await runMigrations(scratchDb, { migrationsFolder })).toEqual([]);
  });
});
