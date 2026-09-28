import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { getDatabase } from "../database";

type JournalEntry = { idx: number; when: number; tag: string };
type Journal = { entries: JournalEntry[] };

// Any migration this fork adds carries "ganttpro" in its tag; everything else
// is an upstream baseline migration.
function isForkMigration(tag: string): boolean {
  return tag.includes("ganttpro");
}

function firstCell<T>(result: { rows?: unknown[] }): T | undefined {
  return result.rows?.[0] as T | undefined;
}

/**
 * Reconcile Drizzle's migration journal before migrate() runs, so this fork's
 * image starts cleanly against a database created by the original upstream
 * project.
 *
 * The problem: this fork regenerated its migration files, so the `when`
 * timestamps in drizzle/meta/_journal.json for the upstream baseline
 * (0000..0050) no longer match the `created_at` values a real upstream-created
 * database recorded when it applied those same migrations. Drizzle's migrator
 * decides what to run by comparing the single MAX(created_at) in
 * drizzle.__drizzle_migrations against each migration's `when`. When our
 * baseline `when` values are newer than everything the database recorded, the
 * migrator concludes NOTHING is applied and re-runs from 0000 — which fails
 * with `relation "account" already exists`.
 *
 * The fix: when the schema already exists but the journal's newest entry is
 * older than our baseline's newest `when`, rewrite the baseline journal rows to
 * our own (hash, when) values without touching any table. migrate() then sees
 * the baseline as applied and runs only this fork's own ganttpro_* migrations.
 *
 * Safety: this only ever writes to drizzle.__drizzle_migrations (Drizzle's own
 * bookkeeping), never to application data. It is idempotent and self-guarding:
 *  - does nothing on a fresh database (no `account` table) — migrate() builds
 *    everything from 0000;
 *  - does nothing once the journal's newest entry already covers our baseline
 *    (a database built from this fork, or already reconciled);
 *  - only runs migrate()'s own ganttpro migrations afterwards.
 */
export async function reconcileMigrationJournal(migrationsFolder: string) {
  const db = getDatabase();

  // Match the exact table Drizzle's node-postgres migrator uses.
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );

  const accountResult = await db.execute(
    sql`SELECT to_regclass('public.account') AS t`,
  );
  if (firstCell<{ t: string | null }>(accountResult)?.t == null) {
    return; // Fresh database — let migrate() build everything from 0000.
  }

  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  const baseline = journal.entries
    .filter((entry) => !isForkMigration(entry.tag))
    .sort((a, b) => a.idx - b.idx);
  if (baseline.length === 0) {
    return;
  }
  const forkEntries = journal.entries.filter((entry) =>
    isForkMigration(entry.tag),
  );
  const baselineMaxWhen = Math.max(...baseline.map((entry) => entry.when));
  const minForkWhen = forkEntries.length
    ? Math.min(...forkEntries.map((entry) => entry.when))
    : Number.POSITIVE_INFINITY;

  const maxResult = await db.execute(
    sql`SELECT max(created_at) AS m FROM "drizzle"."__drizzle_migrations"`,
  );
  const rawMax = firstCell<{ m: string | number | null }>(maxResult)?.m;
  const dbMax = rawMax == null ? null : Number(rawMax);

  // The journal already marks our baseline (or newer) as applied — leave it be.
  if (dbMax != null && dbMax >= baselineMaxWhen) {
    return;
  }

  console.log(
    `🔄 Reconciling Drizzle journal for a pre-existing database (newest recorded migration ${dbMax ?? "none"} < baseline ${baselineMaxWhen}); recording the upstream baseline as applied so only this fork's migrations run.`,
  );

  await db.transaction(async (tx) => {
    // Drop only baseline-era bookkeeping rows (anything older than our first
    // fork migration); never delete rows for already-applied fork migrations.
    if (Number.isFinite(minForkWhen)) {
      await tx.execute(
        sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE created_at IS NULL OR created_at < ${minForkWhen}`,
      );
    } else {
      await tx.execute(sql`DELETE FROM "drizzle"."__drizzle_migrations"`);
    }
    for (const entry of baseline) {
      const migrationSql = readFileSync(
        join(migrationsFolder, `${entry.tag}.sql`),
        "utf8",
      );
      const hash = createHash("sha256").update(migrationSql).digest("hex");
      await tx.execute(
        sql`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES (${hash}, ${entry.when})`,
      );
    }
  });

  console.log(
    "✅ Journal reconciled; migrate() will apply only the remaining migrations.",
  );
}
