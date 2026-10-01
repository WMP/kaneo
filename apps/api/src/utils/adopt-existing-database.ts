import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getDatabase } from "../database";
import { LEGACY_WATERMARK_LAST_TAG } from "../database/run-migrations";

type JournalEntry = { idx: number; when: number; tag: string };
type Journal = { entries: JournalEntry[] };

// What the function needs from a node-postgres Drizzle database, whatever its
// schema type: the application database and a scratch one both fit.
type Executor = Pick<NodePgDatabase, "execute">;
type JournalDatabase = Executor & {
  transaction<T>(callback: (tx: Executor) => Promise<T>): Promise<T>;
};

// Any migration this fork adds carries "ganttpro" in its tag; everything else
// is an upstream baseline migration.
function isForkMigration(tag: string): boolean {
  return tag.includes("ganttpro");
}

function firstCell<T>(result: { rows?: unknown[] }): T | undefined {
  return result.rows?.[0] as T | undefined;
}

/**
 * Reconcile Drizzle's migration journal before runMigrations() runs, so this
 * fork's image starts cleanly against a database whose recorded migrations do
 * not line up with this fork's journal.
 *
 * The journal entries 0000..0050 are byte-identical to upstream's, `when`
 * included, so a database created or upgraded by upstream (or by this fork) has
 * recorded rows with exactly those `created_at` values. For such a database
 * this function does nothing. The runner then applies whatever the database has
 * not recorded yet, including the fork's own ganttpro migrations.
 *
 * It only acts on an older fork installation that built its schema from a
 * regenerated baseline: `public.account` exists, but the journal table has no
 * rows or none of its `created_at` values equals a baseline entry's `when`
 * (the baseline is the non-fork entries up to LEGACY_WATERMARK_LAST_TAG).
 * Without help the runner would apply the baseline again from 0000 and fail
 * with `relation "account" already exists`. In that case the baseline rows are
 * rewritten to this journal's (hash, when) values without touching any table,
 * so that only the migrations the database really lacks run.
 *
 * Safety: this only ever writes to drizzle.__drizzle_migrations (Drizzle's own
 * bookkeeping), never to application data. It is idempotent and self-guarding:
 *  - does nothing on a fresh database (no `account` table), where the runner
 *    builds everything from 0000;
 *  - does nothing once any recorded `created_at` equals a baseline `when`
 *    (a database built by upstream or by this fork, or already reconciled);
 *  - never deletes rows of fork migrations that were already applied.
 *
 * `database` defaults to the application database; tests pass a scratch one.
 */
export async function reconcileMigrationJournal(
  migrationsFolder: string,
  db: JournalDatabase = getDatabase(),
) {
  // Match the exact table Drizzle's node-postgres migrator uses.
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );

  const accountResult = await db.execute(
    sql`SELECT to_regclass('public.account') AS t`,
  );
  if (firstCell<{ t: string | null }>(accountResult)?.t == null) {
    return; // Fresh database — let the runner build everything from 0000.
  }

  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  // The baseline is the upstream history that the runner decides by Drizzle's
  // watermark rule: the non-fork entries up to LEGACY_WATERMARK_LAST_TAG. Later
  // entries are never recorded here; the runner applies them.
  const cutoff = journal.entries.find(
    (entry) => entry.tag === LEGACY_WATERMARK_LAST_TAG,
  );
  if (!cutoff) {
    return; // runMigrations() reports the missing entry.
  }
  const baseline = journal.entries
    .filter((entry) => entry.idx <= cutoff.idx && !isForkMigration(entry.tag))
    .sort((a, b) => a.idx - b.idx);
  if (baseline.length === 0) {
    return;
  }
  const forkEntries = journal.entries.filter((entry) =>
    isForkMigration(entry.tag),
  );
  const baselineWhens = new Set(baseline.map((entry) => entry.when));
  const minForkWhen = forkEntries.length
    ? Math.min(...forkEntries.map((entry) => entry.when))
    : Number.POSITIVE_INFINITY;

  const recordedResult = await db.execute<{ created_at: string | null }>(
    sql`SELECT created_at FROM "drizzle"."__drizzle_migrations"`,
  );
  const recorded = recordedResult.rows;

  // Some recorded migration is one of our baseline entries — leave it be.
  if (recorded.some((row) => baselineWhens.has(Number(row.created_at)))) {
    return;
  }

  console.log(
    `🔄 Reconciling Drizzle journal for a pre-existing database (${recorded.length} recorded migrations, none of them a baseline entry); recording the baseline as applied so only the missing migrations run.`,
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
    "✅ Journal reconciled; runMigrations() will apply only the remaining migrations.",
  );
}
