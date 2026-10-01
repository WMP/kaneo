import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

// Guard for the Drizzle migration journal (apps/api/drizzle/meta/_journal.json).
//
// Why `when` must increase: drizzle-orm 0.45.2 (`pg-core/dialect.js`,
// `PgDialect.migrate`) reads ONLY the newest `created_at` from
// `drizzle.__drizzle_migrations` (`order by created_at desc limit 1`) and then
// walks the journal in order, applying a migration only when
// `Number(lastDbMigration.created_at) < migration.folderMillis`, where
// `folderMillis` is the journal entry's `when` (`migrator.js`). A migration
// whose `when` is not greater than the newest `when` already recorded in a
// database is therefore skipped silently, with no error. So every entry must
// have a `when` strictly greater than every entry before it in the journal.
//
// The upstream baseline (0000 up to BASELINE_LAST_TAG) contains historical
// exceptions (0006, 0025, 0026). They are harmless: a fresh database applies
// the whole journal in one run against an empty bookkeeping table, and
// `reconcileMigrationJournal` (apps/api/src/utils/adopt-existing-database.ts)
// rewrites the bookkeeping rows of an upstream-created database. Entries up to
// and including BASELINE_LAST_TAG are exempt from the check but still count
// towards the running maximum.

export const DEFAULT_JOURNAL = fileURLToPath(
  new URL("../../apps/api/drizzle/meta/_journal.json", import.meta.url),
);
export const BASELINE_LAST_TAG = "0050_resumable_github_import";

function assertEntries(entries, label) {
  if (!Array.isArray(entries)) {
    throw new Error(`${label}: "entries" must be an array`);
  }
  for (const entry of entries) {
    if (
      typeof entry?.tag !== "string" ||
      !Number.isFinite(entry?.when) ||
      !Number.isInteger(entry?.idx)
    ) {
      throw new Error(
        `${label}: every entry needs a numeric idx, a numeric when and a string tag (got ${JSON.stringify(entry)})`,
      );
    }
  }
}

/**
 * Entries (after the baseline) whose `when` is not strictly greater than the
 * newest `when` before them in journal order.
 */
export function findOutOfOrder(entries, baselineLastTag = BASELINE_LAST_TAG) {
  assertEntries(entries, "journal");
  const baselineEnd = entries.findIndex(
    (entry) => entry.tag === baselineLastTag,
  );
  const violations = [];
  let newest = null;
  entries.forEach((entry, position) => {
    if (
      position > baselineEnd &&
      newest !== null &&
      entry.when <= newest.when
    ) {
      violations.push({ entry, newest });
    }
    if (newest === null || entry.when > newest.when) newest = entry;
  });
  return violations;
}

/**
 * Entries of `incoming` (for example upstream's journal) that `current` does
 * not have yet, but whose `when` is not newer than the newest entry of
 * `current`. Merging such an entry means every existing database skips it.
 */
export function findStaleIncoming(current, incoming) {
  assertEntries(current, "journal");
  assertEntries(incoming, "incoming journal");
  const known = new Set(current.map((entry) => entry.tag));
  const newest = current.reduce(
    (best, entry) => (best === null || entry.when > best.when ? entry : best),
    null,
  );
  if (newest === null) return [];
  return incoming
    .filter((entry) => !known.has(entry.tag) && entry.when <= newest.when)
    .map((entry) => ({ entry, newest }));
}

const iso = (when) => new Date(when).toISOString();

const FIX = [
  "Drizzle skips a migration whose journal `when` is not newer than the newest",
  "migration a database already applied (drizzle-orm pg-core dialect migrate),",
  "silently and without an error. Fix each entry in one of two ways:",
  "  1. re-stamp: set its `when` in apps/api/drizzle/meta/_journal.json to a",
  "     value greater than the newest entry (never edit an entry that an",
  "     installation already applied); make its SQL idempotent, because a",
  "     database that already ran it under the old `when` will run it again;",
  "  2. re-issue: leave it out and add its changes as a new fork migration",
  "     (`pnpm --filter @kaneo/api db:generate`) with idempotent SQL",
  "     (IF NOT EXISTS, ON CONFLICT DO NOTHING, guarded UPDATEs).",
].join("\n");

export function formatReport({ outOfOrder = [], staleIncoming = [] }) {
  const lines = [];
  for (const { entry, newest } of outOfOrder) {
    lines.push(
      `- ${entry.tag} (idx ${entry.idx}, when ${entry.when} = ${iso(entry.when)}) is not newer than ${newest.tag} (when ${newest.when} = ${iso(newest.when)}), which comes before it in the journal`,
    );
  }
  for (const { entry, newest } of staleIncoming) {
    lines.push(
      `- incoming ${entry.tag} (when ${entry.when} = ${iso(entry.when)}) is not newer than ${newest.tag} (when ${newest.when} = ${iso(newest.when)}), the newest migration already in this branch`,
    );
  }
  if (lines.length === 0) return "";
  return `Migrations that existing databases would skip:\n${lines.join("\n")}\n\n${FIX}\n`;
}

function readEntries(path) {
  const journal = JSON.parse(readFileSync(resolve(path), "utf8"));
  return journal.entries;
}

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { incoming: { type: "string" } },
  });
  const journalPath = positionals[0] ?? DEFAULT_JOURNAL;
  const entries = readEntries(journalPath);
  const outOfOrder = findOutOfOrder(entries);
  const staleIncoming = values.incoming
    ? findStaleIncoming(entries, readEntries(values.incoming))
    : [];
  const report = formatReport({ outOfOrder, staleIncoming });
  if (report) {
    console.error(report);
    return 1;
  }
  console.log(
    `Migration journal OK: ${entries.length} entries, every migration after ${BASELINE_LAST_TAG} is newer than all before it${values.incoming ? " and no incoming migration is older than the newest one here" : ""}.`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
