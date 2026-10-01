import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * The last journal entry that is decided by Drizzle's watermark rule.
 *
 * Drizzle's own migrator runs an entry only if its `when` is greater than
 * MAX(created_at) of drizzle.__drizzle_migrations. Entries 0000 to this one are
 * shared with upstream, and installations that applied them with that rule
 * skipped three of them, because their `when` is older than an earlier entry:
 * 0006_rename_active_workspace_to_organization, 0025_early_owl and
 * 0026_encrypt_notification_preference_secrets. The skipped changes are made
 * elsewhere (the startup helpers in apps/api/src/utils), and 0025_early_owl is a
 * plain CREATE TABLE that would fail if it ran on such a database. Entries up to
 * and including this tag therefore keep the watermark rule.
 *
 * Every entry after it is decided one by one: it runs when its `when` is not
 * recorded. A migration merged late with an older `when` (for example an
 * upstream migration merged after newer fork migrations) still runs on an
 * upgraded database.
 */
export const LEGACY_WATERMARK_LAST_TAG = "0050_resumable_github_import";

// Serializes concurrent API instances that start against one database. Any
// fixed bigint works ("kaneo" in ASCII); it only has to be the same everywhere.
const MIGRATION_LOCK_ID = 0x6b616e656f;

export type MigrationEntry = {
  tag: string;
  when: number;
};

type JournalEntry = MigrationEntry & { idx: number };

type Migration = MigrationEntry & {
  hash: string;
  statements: string[];
};

export type RunMigrationsOptions = {
  migrationsFolder: string;
  legacyWatermarkLastTag?: string;
};

/**
 * Returns the tags of the journal entries that have to run, in journal order.
 *
 *  - An entry whose `when` is recorded is applied.
 *  - Otherwise an entry with `when <= legacyCutoffWhen` runs only when its
 *    `when` is greater than the newest recorded value, as in Drizzle. With no
 *    recorded value at all, everything runs.
 *  - Otherwise (`when > legacyCutoffWhen`) the entry runs.
 *
 * A recorded value that matches no entry never marks an entry as applied, but
 * it still counts for the newest recorded value, as it does in Drizzle.
 */
export function selectPendingMigrations(
  entries: readonly MigrationEntry[],
  recordedWhens: readonly number[],
  legacyCutoffWhen: number,
): string[] {
  const recorded = new Set(recordedWhens);
  const watermark = recordedWhens.reduce(
    (newest, when) => Math.max(newest, when),
    Number.NEGATIVE_INFINITY,
  );

  return entries
    .filter(({ when }) => {
      if (recorded.has(when)) {
        return false;
      }
      return when > legacyCutoffWhen || when > watermark;
    })
    .map(({ tag }) => tag);
}

function loadMigrations(migrationsFolder: string): Migration[] {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };
  // Same file reading, statement splitting and sha256 hash as Drizzle's migrator.
  const files = readMigrationFiles({ migrationsFolder });

  if (files.length !== journal.entries.length) {
    throw new Error(
      `Migration folder ${migrationsFolder} has ${journal.entries.length} journal entries but ${files.length} migrations were read.`,
    );
  }

  return journal.entries.map((entry, index) => {
    const file = files[index];
    if (!file || file.folderMillis !== entry.when) {
      throw new Error(
        `Migration ${entry.tag} in ${migrationsFolder} does not match the journal order (when ${entry.when}).`,
      );
    }
    return {
      tag: entry.tag,
      when: entry.when,
      hash: file.hash,
      statements: file.sql,
    };
  });
}

/**
 * Applies the pending migrations of a Drizzle folder and records each one in
 * drizzle.__drizzle_migrations, in Drizzle's table and row format: (hash,
 * created_at = the entry's `when`). Returns the applied tags in order.
 *
 * Runs in one transaction behind a PostgreSQL advisory lock, so API instances
 * that start together apply each migration once. See
 * LEGACY_WATERMARK_LAST_TAG and selectPendingMigrations for what is pending.
 * Legacy entries that the watermark skips get no row.
 */
export async function runMigrations<TSchema extends Record<string, unknown>>(
  db: NodePgDatabase<TSchema>,
  {
    migrationsFolder,
    legacyWatermarkLastTag = LEGACY_WATERMARK_LAST_TAG,
  }: RunMigrationsOptions,
): Promise<string[]> {
  const migrations = loadMigrations(migrationsFolder);
  const cutoff = migrations.find(({ tag }) => tag === legacyWatermarkLastTag);
  if (!cutoff) {
    throw new Error(
      `Migration journal in ${migrationsFolder} has no entry "${legacyWatermarkLastTag}". It marks the last entry decided by Drizzle's watermark rule; do not remove or rename it.`,
    );
  }

  const applied: string[] = [];

  await db.transaction(async (tx) => {
    await tx.execute(
      sql.raw(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`),
    );
    // Drizzle's own DDL, so either migrator can read the table.
    await tx.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await tx.execute(
      sql`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
    );

    const recorded = await tx.execute<{ created_at: string | number | null }>(
      sql`SELECT created_at FROM "drizzle"."__drizzle_migrations"`,
    );
    const recordedWhens = recorded.rows.flatMap((row) =>
      row.created_at == null ? [] : [Number(row.created_at)],
    );
    const pending = new Set(
      selectPendingMigrations(migrations, recordedWhens, cutoff.when),
    );

    for (const migration of migrations) {
      if (!pending.has(migration.tag)) {
        continue;
      }
      for (const statement of migration.statements) {
        await tx.execute(sql.raw(statement));
      }
      await tx.execute(
        sql`INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES (${migration.hash}, ${migration.when})`,
      );
      applied.push(migration.tag);
    }
  });

  for (const tag of applied) {
    console.log(`✅ Applied migration ${tag}`);
  }

  return applied;
}
