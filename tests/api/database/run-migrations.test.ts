import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEGACY_WATERMARK_LAST_TAG,
  type MigrationEntry,
  selectPendingMigrations,
} from "../../../apps/api/src/database/run-migrations";

// The pure part of the runner (apps/api/src/database/run-migrations.ts): which
// journal entries are pending, given the `created_at` values recorded in
// drizzle.__drizzle_migrations. The PostgreSQL behavior is covered by
// tests/api-integration/migration-runner.test.ts.

const journalPath = join(
  __dirname,
  "../../../apps/api/drizzle/meta/_journal.json",
);

// Drizzle's own rule, for comparison: an entry runs when its `when` is greater
// than the newest recorded value.
function drizzlePending(
  entries: MigrationEntry[],
  recordedWhens: number[],
): string[] {
  const newest = recordedWhens.length > 0 ? Math.max(...recordedWhens) : null;
  return entries
    .filter(({ when }) => newest === null || when > newest)
    .map(({ tag }) => tag);
}

// A small journal in journal order. "0003_skipped_by_watermark" is older than
// the entry before it (like upstream's 0025_early_owl); "0060_late_merge" comes
// last in the journal but is older than the entries before it, yet newer than
// the legacy cutoff.
const journal: MigrationEntry[] = [
  { tag: "0001_first", when: 100 },
  { tag: "0002_second", when: 200 },
  { tag: "0003_skipped_by_watermark", when: 150 },
  { tag: "0004_cutoff", when: 400 },
  { tag: "20260101000000_ganttpro_one", when: 500 },
  { tag: "20260102000000_ganttpro_two", when: 600 },
  { tag: "0060_late_merge", when: 450 },
];
const CUTOFF_WHEN = 400;

const whens = (...tags: string[]) =>
  tags.map((tag) => journal.find((entry) => entry.tag === tag)?.when ?? -1);

describe("selectPendingMigrations", () => {
  it("selects every entry, in journal order, on a fresh database", () => {
    expect(selectPendingMigrations(journal, [], CUTOFF_WHEN)).toEqual(
      journal.map(({ tag }) => tag),
    );
  });

  it("selects nothing for an empty journal", () => {
    expect(selectPendingMigrations([], [], CUTOFF_WHEN)).toEqual([]);
    expect(selectPendingMigrations([], [1, 2], CUTOFF_WHEN)).toEqual([]);
  });

  it("selects the entries added after a sequential upgrade", () => {
    const applied = whens(
      "0001_first",
      "0002_second",
      "0003_skipped_by_watermark",
      "0004_cutoff",
      "20260101000000_ganttpro_one",
    );
    const released = journal.slice(0, 6);

    expect(selectPendingMigrations(released, applied, CUTOFF_WHEN)).toEqual([
      "20260102000000_ganttpro_two",
    ]);
  });

  it("selects nothing when every entry is recorded", () => {
    const all = journal.map(({ when }) => when);

    expect(selectPendingMigrations(journal, all, CUTOFF_WHEN)).toEqual([]);
  });

  it("selects a late-merged entry that is older than the newest recorded one", () => {
    const applied = whens(
      "0001_first",
      "0002_second",
      "0003_skipped_by_watermark",
      "0004_cutoff",
      "20260101000000_ganttpro_one",
      "20260102000000_ganttpro_two",
    );

    expect(selectPendingMigrations(journal, applied, CUTOFF_WHEN)).toEqual([
      "0060_late_merge",
    ]);
    // Drizzle's rule skips it: 450 is not greater than 600.
    expect(drizzlePending(journal, applied)).toEqual([]);
  });

  it("keeps a legacy entry skipped by the watermark skipped", () => {
    // An installation that applied 0001, 0002 and the cutoff with Drizzle's
    // migrator never ran 0003 (150 <= 200) and has no row for it.
    const applied = whens("0001_first", "0002_second", "0004_cutoff");

    expect(selectPendingMigrations(journal, applied, CUTOFF_WHEN)).toEqual([
      "20260101000000_ganttpro_one",
      "20260102000000_ganttpro_two",
      "0060_late_merge",
    ]);
  });

  it("selects a legacy entry that is newer than everything recorded", () => {
    // A database at 0001: the watermark rule runs the rest of the legacy
    // entries, including 0003 (150 > 100).
    const applied = whens("0001_first");

    expect(selectPendingMigrations(journal, applied, CUTOFF_WHEN)).toEqual([
      "0002_second",
      "0003_skipped_by_watermark",
      "0004_cutoff",
      "20260101000000_ganttpro_one",
      "20260102000000_ganttpro_two",
      "0060_late_merge",
    ]);
  });

  it("does not select recorded entries", () => {
    const applied = whens(
      "0001_first",
      "0002_second",
      "0004_cutoff",
      "20260102000000_ganttpro_two",
    );

    expect(selectPendingMigrations(journal, applied, CUTOFF_WHEN)).toEqual([
      "20260101000000_ganttpro_one",
      "0060_late_merge",
    ]);
  });

  it("ignores recorded values that match no entry", () => {
    // 777 is newer than every entry, like a row written by another lineage.
    // It marks nothing as applied, so the post-cutoff entries still run, and
    // as in Drizzle it still counts as the newest recorded value, so the legacy
    // 0003 stays skipped.
    const applied = [...whens("0001_first", "0002_second", "0004_cutoff"), 777];

    expect(selectPendingMigrations(journal, applied, CUTOFF_WHEN)).toEqual([
      "20260101000000_ganttpro_one",
      "20260102000000_ganttpro_two",
      "0060_late_merge",
    ]);
  });

  it("ignores an unknown value that is older than the entries", () => {
    expect(selectPendingMigrations(journal, [50], CUTOFF_WHEN)).toEqual(
      journal.map(({ tag }) => tag),
    );
  });

  it("does not depend on the order of the recorded values", () => {
    const applied = whens("0001_first", "0002_second", "0004_cutoff");

    expect(
      selectPendingMigrations(journal, [...applied].reverse(), CUTOFF_WHEN),
    ).toEqual(selectPendingMigrations(journal, applied, CUTOFF_WHEN));
  });
});

describe("selectPendingMigrations with the journal of apps/api/drizzle", () => {
  const entries = (
    JSON.parse(readFileSync(journalPath, "utf-8")) as {
      entries: MigrationEntry[];
    }
  ).entries;
  const tags = entries.map(({ tag }) => tag);
  const cutoff = entries.find(({ tag }) => tag === LEGACY_WATERMARK_LAST_TAG);
  const cutoffIndex = tags.indexOf(LEGACY_WATERMARK_LAST_TAG);
  const legacy = entries.slice(0, cutoffIndex + 1);
  const afterCutoff = entries.slice(cutoffIndex + 1);

  it("has a legacy cutoff entry", () => {
    expect(cutoff).toBeDefined();
    expect(afterCutoff.length).toBeGreaterThan(0);
  });

  it("selects every entry on a fresh database", () => {
    expect(selectPendingMigrations(entries, [], cutoff?.when ?? 0)).toEqual(
      tags,
    );
  });

  it("selects only the entries after the cutoff on a database that applied the legacy ones", () => {
    const applied = legacy.map(({ when }) => when);

    expect(
      selectPendingMigrations(entries, applied, cutoff?.when ?? 0),
    ).toEqual(afterCutoff.map(({ tag }) => tag));
  });

  it("does not run the three legacy entries that older installations skipped", () => {
    // Every legacy entry except the three that Drizzle's watermark skipped.
    const skipped = new Set([
      "0006_rename_active_workspace_to_organization",
      "0025_early_owl",
      "0026_encrypt_notification_preference_secrets",
    ]);
    const applied = legacy
      .filter(({ tag }) => !skipped.has(tag))
      .map(({ when }) => when);

    const pending = selectPendingMigrations(
      entries,
      applied,
      cutoff?.when ?? 0,
    );

    expect(pending.filter((tag) => skipped.has(tag))).toEqual([]);
    expect(pending).toEqual(afterCutoff.map(({ tag }) => tag));
  });

  it("continues a legacy upgrade with the rest of the legacy entries and then the new ones", () => {
    const next = tags.indexOf("0045_fantastic_princess_powerful") + 1;
    const applied = entries.slice(0, next).map(({ when }) => when);

    expect(
      selectPendingMigrations(entries, applied, cutoff?.when ?? 0),
    ).toEqual(tags.slice(next));
  });

  it("selects nothing on a database that applied the whole journal", () => {
    expect(
      selectPendingMigrations(
        entries,
        entries.map(({ when }) => when),
        cutoff?.when ?? 0,
      ),
    ).toEqual([]);
  });
});
