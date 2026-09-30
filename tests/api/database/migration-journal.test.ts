import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Guards the Drizzle migration folder (apps/api/drizzle). Migrations 0000-0059
// are frozen. New fork migrations are named <UTC timestamp>_ganttpro_<name>
// (see `migrations.prefix` in apps/api/drizzle.config.ts); upstream migrations
// keep their four-digit names.

const migrationsFolder = join(__dirname, "../../../apps/api/drizzle");

/**
 * Drizzle's migrator records the `when` of the newest applied journal entry in
 * drizzle.__drizzle_migrations and, on the next start, runs only the entries
 * whose `when` is greater than that watermark. It never looks at file names or
 * hashes. An entry that is not newer than every entry before it therefore runs
 * on a fresh database but is silently skipped on a database that already
 * applied the later ones.
 *
 * These three upstream entries have that shape. They are part of upstream's
 * history and, like every applied migration, are frozen; every other entry has
 * to advance the watermark.
 */
const OUT_OF_ORDER_UPSTREAM_TAGS = new Set([
  "0006_rename_active_workspace_to_organization",
  "0025_early_owl",
  "0026_encrypt_notification_preference_secrets",
]);

/**
 * Fork migrations created before the timestamp prefix. adopt-existing-database.ts
 * recognises fork migrations by "ganttpro" in the tag, so a legacy four-digit
 * tag containing it is only valid if it is on this frozen list.
 */
const FROZEN_FORK_TAGS = new Set([
  "0051_ganttpro_additions",
  "0052_ganttpro_customfield_option_colors",
  "0053_ganttpro_task_assignment",
  "0054_ganttpro_workspace_custom_fields",
  "0055_ganttpro_resources",
  "0056_ganttpro_project_members",
  "0057_ganttpro_invitation_origin",
  "0058_ganttpro_resource_invitation",
  "0059_ganttpro_actor_source",
]);

const LEGACY_TAG = /^\d{4}_[a-z0-9_]+$/;
const TIMESTAMP_TAG = /^\d{14}_[a-z0-9_]+$/;
const FORK_TIMESTAMP_TAG = /^\d{14}_ganttpro_[a-z0-9_]+$/;

// drizzle-kit takes the prefix from the clock a few milliseconds before it
// stores `when`, so the two differ by far less than a minute.
const PREFIX_TO_WHEN_WINDOW_MS = 60_000;

type JournalEntry = {
  idx: number;
  tag: string;
  when: number;
};

type Snapshot = {
  file: string;
  id: string;
  prevId: string;
};

function isJournalEntry(value: unknown): value is JournalEntry {
  const entry = value as Partial<JournalEntry> | null;
  return (
    typeof entry?.tag === "string" &&
    Number.isInteger(entry.idx) &&
    Number.isInteger(entry.when)
  );
}

function readSnapshot(folder: string, file: string): Snapshot | null {
  try {
    const content = JSON.parse(
      readFileSync(join(folder, "meta", file), "utf-8"),
    ) as { id?: unknown; prevId?: unknown } | null;
    return typeof content?.id === "string" && typeof content.prevId === "string"
      ? { file, id: content.id, prevId: content.prevId }
      : null;
  } catch {
    return null;
  }
}

function groupDuplicates<T>(
  items: readonly T[],
  key: (item: T) => string | number,
): T[][] {
  const groups = new Map<string | number, T[]>();
  for (const item of items) {
    groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString();
}

function tagPrefix(name: string): string {
  return name.split("_")[0] ?? "";
}

function formatTimestampPrefix(ms: number): string {
  return new Date(ms).toISOString().replace(/\D/g, "").slice(0, 14);
}

// Returns the instant for a YYYYMMDDHHMMSS prefix, or null when the digits are
// not a real UTC date and time (for example 20260230120000 or 20261001246000).
function parseTimestampPrefix(prefix: string): number | null {
  const ms = Date.UTC(
    Number(prefix.slice(0, 4)),
    Number(prefix.slice(4, 6)) - 1,
    Number(prefix.slice(6, 8)),
    Number(prefix.slice(8, 10)),
    Number(prefix.slice(10, 12)),
    Number(prefix.slice(12, 14)),
  );
  return formatTimestampPrefix(ms) === prefix ? ms : null;
}

// idx is the array position; tags and `when` values are unique.
function checkIdentity(entries: JournalEntry[]): string[] {
  const problems: string[] = [];
  entries.forEach((entry, index) => {
    if (entry.idx !== index) {
      problems.push(
        `Journal entry ${entry.tag} has idx ${entry.idx}, expected ${index}.`,
      );
    }
  });
  for (const group of groupDuplicates(entries, (entry) => entry.tag)) {
    problems.push(
      `Journal tag ${group[0]?.tag} is used by entries ${group.map((entry) => entry.idx).join(" and ")}.`,
    );
  }
  for (const group of groupDuplicates(entries, (entry) => entry.when)) {
    problems.push(
      `Journal entries ${group.map((entry) => entry.tag).join(" and ")} share the same "when" (${group[0]?.when}).`,
    );
  }
  return problems;
}

// Every entry has to be newer than everything before it (see above).
function checkWatermark(entries: JournalEntry[]): string[] {
  const problems: string[] = [];
  let watermark = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    if (entry.when <= watermark && !OUT_OF_ORDER_UPSTREAM_TAGS.has(entry.tag)) {
      problems.push(
        `Journal entry ${entry.tag} (when ${entry.when}, ${isoDate(entry.when)}) is not newer than an earlier entry (when ${watermark}, ${isoDate(watermark)}). Drizzle's migrator skips it on a database that already applied that entry; give it a larger "when".`,
      );
    }
    watermark = Math.max(watermark, entry.when);
  }
  return problems;
}

// Journal entries and .sql files match one to one.
function checkSqlFiles(folder: string, entries: JournalEntry[]): string[] {
  const problems: string[] = [];
  const sqlFiles = readdirSync(folder).filter((file) => file.endsWith(".sql"));
  const tags = new Set(entries.map((entry) => entry.tag));
  for (const tag of tags) {
    if (!sqlFiles.includes(`${tag}.sql`)) {
      problems.push(`Journal entry ${tag} has no ${tag}.sql file.`);
    }
  }
  for (const file of sqlFiles) {
    if (!tags.has(basename(file, ".sql"))) {
      problems.push(
        `${file} has no journal entry. An orphan file usually means an upstream merge kept only one side of meta/_journal.json.`,
      );
    }
  }
  return problems;
}

// Snapshots belong to a journal entry, and no two share an id or a parent.
function checkSnapshots(folder: string, entries: JournalEntry[]): string[] {
  const problems: string[] = [];
  const tagPrefixes = new Set(entries.map((entry) => tagPrefix(entry.tag)));
  const files = readdirSync(join(folder, "meta"))
    .filter((file) => file.endsWith("_snapshot.json"))
    .sort();
  const snapshots: Snapshot[] = [];
  for (const file of files) {
    if (!tagPrefixes.has(tagPrefix(file))) {
      problems.push(
        `meta/${file} does not belong to a journal entry: no journal tag starts with ${tagPrefix(file)}_.`,
      );
    }
    const snapshot = readSnapshot(folder, file);
    if (snapshot) {
      snapshots.push(snapshot);
    } else {
      problems.push(
        `meta/${file} is not JSON with a string "id" and a string "prevId".`,
      );
    }
  }
  for (const group of groupDuplicates(snapshots, (snapshot) => snapshot.id)) {
    problems.push(
      `Snapshots ${group.map((snapshot) => snapshot.file).join(" and ")} share the same id (${group[0]?.id}).`,
    );
  }
  for (const group of groupDuplicates(
    snapshots,
    (snapshot) => snapshot.prevId,
  )) {
    problems.push(
      `Snapshots ${group.map((snapshot) => snapshot.file).join(" and ")} share the same prevId (${group[0]?.prevId}); drizzle-kit generate aborts on a forked snapshot chain.`,
    );
  }
  return problems;
}

// Names. Legacy four-digit names are upstream's (plus the frozen fork
// list); timestamp names are this fork's and must carry "ganttpro".
function checkTagName({ tag, when }: JournalEntry): string[] {
  if (LEGACY_TAG.test(tag)) {
    return tag.includes("ganttpro") && !FROZEN_FORK_TAGS.has(tag)
      ? [
          `Journal entry ${tag} is a new fork migration with a four-digit number. New fork migrations must use the timestamp prefix (migrations.prefix in apps/api/drizzle.config.ts) and be named YYYYMMDDHHMMSS_ganttpro_<description>.`,
        ]
      : [];
  }
  if (!TIMESTAMP_TAG.test(tag)) {
    return [
      `Journal tag ${tag} must be NNNN_<name> (upstream) or YYYYMMDDHHMMSS_<name> (this fork), using lower case letters, digits and underscores.`,
    ];
  }

  const problems: string[] = [];
  if (!FORK_TIMESTAMP_TAG.test(tag)) {
    problems.push(
      `Journal entry ${tag} must be named YYYYMMDDHHMMSS_ganttpro_<description>; adopt-existing-database.ts recognises fork migrations by "ganttpro" in the tag.`,
    );
  }
  const prefix = tag.slice(0, 14);
  const prefixMs = parseTimestampPrefix(prefix);
  if (prefixMs === null) {
    problems.push(
      `Journal entry ${tag} has prefix ${prefix}, which is not a real UTC date and time (YYYYMMDDHHMMSS).`,
    );
  } else if (when < prefixMs || when - prefixMs >= PREFIX_TO_WHEN_WINDOW_MS) {
    problems.push(
      `Journal entry ${tag} has when ${when} (${isoDate(when)}), which is not within ${PREFIX_TO_WHEN_WINDOW_MS / 1000} seconds after its prefix (${isoDate(prefixMs)}). drizzle-kit writes both at the same moment; do not edit either by hand.`,
    );
  }
  return problems;
}

// Returns human-readable problems with a Drizzle migration folder; an empty
// array means the folder is fine.
function checkMigrationFolder(folder: string): string[] {
  let entries: unknown;
  try {
    entries = JSON.parse(
      readFileSync(join(folder, "meta", "_journal.json"), "utf-8"),
    ).entries;
  } catch (error) {
    return [`meta/_journal.json cannot be read: ${(error as Error).message}`];
  }
  if (!Array.isArray(entries) || !entries.every(isJournalEntry)) {
    return [
      'meta/_journal.json must contain "entries", each with a string "tag" and integer "idx" and "when".',
    ];
  }

  return [
    ...checkIdentity(entries),
    ...checkWatermark(entries),
    ...checkSqlFiles(folder, entries),
    ...checkSnapshots(folder, entries),
    ...entries.flatMap(checkTagName),
  ];
}

// Fixtures

type FolderSpec = {
  entries: JournalEntry[];
  sqlFiles: string[];
  snapshots: Snapshot[];
};

const tempFolders: string[] = [];

afterEach(() => {
  for (const folder of tempFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

// One legacy upstream entry, one frozen fork entry, one timestamp fork entry
// and a later upstream entry with its own `when`. The last entry has no
// snapshot, like a hand-written upstream migration.
function validSpec(): FolderSpec {
  const entries: JournalEntry[] = [
    { idx: 0, tag: "0000_init", when: Date.UTC(2026, 8, 1, 8, 0, 0) },
    {
      idx: 1,
      tag: "0051_ganttpro_additions",
      when: Date.UTC(2026, 8, 28, 5, 7, 42, 249),
    },
    {
      idx: 2,
      tag: "20261001120000_ganttpro_probe",
      when: Date.UTC(2026, 9, 1, 12, 0, 0, 250),
    },
    {
      idx: 3,
      tag: "0060_upstream_change",
      when: Date.UTC(2026, 9, 2, 8, 0, 0),
    },
  ];
  return {
    entries,
    sqlFiles: entries.map(({ tag }) => `${tag}.sql`),
    snapshots: entries.slice(0, 3).map(({ tag }, index) => ({
      file: `${tagPrefix(tag)}_snapshot.json`,
      id: uuid(index + 1),
      prevId: uuid(index),
    })),
  };
}

function replaceLastEntry(spec: FolderSpec, tag: string, when: number) {
  const last = spec.entries.length - 1;
  spec.entries[last] = { idx: last, tag, when };
  spec.sqlFiles[last] = `${tag}.sql`;
  return spec;
}

function writeFolder(spec: FolderSpec): string {
  const folder = mkdtempSync(join(tmpdir(), "migration-journal-"));
  tempFolders.push(folder);
  mkdirSync(join(folder, "meta"));
  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: spec.entries,
    }),
  );
  for (const file of spec.sqlFiles) {
    writeFileSync(join(folder, file), "SELECT 1;\n");
  }
  for (const { file, id, prevId } of spec.snapshots) {
    writeFileSync(join(folder, "meta", file), JSON.stringify({ id, prevId }));
  }
  return folder;
}

function problemsOf(spec: FolderSpec): string[] {
  return checkMigrationFolder(writeFolder(spec));
}

// The fixture breaks exactly one rule.
function expectOneProblem(problems: string[], pattern: RegExp) {
  expect(problems).toEqual([expect.stringMatching(pattern)]);
}

describe("Drizzle migration journal", () => {
  it("has no problems in apps/api/drizzle", () => {
    expect(checkMigrationFolder(migrationsFolder)).toEqual([]);
  });
});

describe("checkMigrationFolder", () => {
  it("accepts legacy, frozen fork, timestamp fork and later upstream entries", () => {
    expect(problemsOf(validSpec())).toEqual([]);
  });

  it("reports a folder without a readable journal", () => {
    const folder = mkdtempSync(join(tmpdir(), "migration-journal-"));
    tempFolders.push(folder);
    expectOneProblem(
      checkMigrationFolder(folder),
      /_journal\.json cannot be read/,
    );
  });

  it("reports an idx that is not the array position", () => {
    const spec = validSpec();
    spec.entries[2] = { ...spec.entries[2], idx: 5 } as JournalEntry;
    expectOneProblem(
      problemsOf(spec),
      /20261001120000_ganttpro_probe has idx 5, expected 2/,
    );
  });

  it("reports a duplicate tag", () => {
    const spec = validSpec();
    replaceLastEntry(
      spec,
      "0051_ganttpro_additions",
      spec.entries[3]?.when ?? 0,
    );
    expectOneProblem(
      problemsOf(spec),
      /tag 0051_ganttpro_additions is used by entries 1 and 3/,
    );
  });

  it("reports a duplicate when", () => {
    const spec = validSpec();
    replaceLastEntry(spec, "0060_upstream_change", spec.entries[2]?.when ?? 0);
    expect(problemsOf(spec)).toContainEqual(
      expect.stringMatching(/share the same "when"/),
    );
  });

  it("reports an entry that is not newer than the entries before it", () => {
    const spec = validSpec();
    replaceLastEntry(
      spec,
      "0060_upstream_change",
      (spec.entries[1]?.when ?? 0) + 1,
    );
    expectOneProblem(
      problemsOf(spec),
      /0060_upstream_change .* is not newer than an earlier entry/,
    );
  });

  it("accepts the grandfathered upstream entries out of order", () => {
    const spec = validSpec();
    replaceLastEntry(spec, "0025_early_owl", (spec.entries[1]?.when ?? 0) + 1);
    expect(problemsOf(spec)).toEqual([]);
  });

  it("reports a journal entry without a .sql file", () => {
    const spec = validSpec();
    spec.sqlFiles = spec.sqlFiles.filter(
      (file) => file !== "0051_ganttpro_additions.sql",
    );
    expectOneProblem(
      problemsOf(spec),
      /0051_ganttpro_additions has no 0051_ganttpro_additions\.sql file/,
    );
  });

  it("reports a .sql file without a journal entry", () => {
    const spec = validSpec();
    spec.sqlFiles.push("0099_orphan.sql");
    expectOneProblem(problemsOf(spec), /0099_orphan\.sql has no journal entry/);
  });

  it("reports a snapshot that belongs to no journal entry", () => {
    const spec = validSpec();
    spec.snapshots.push({
      file: "0042_snapshot.json",
      id: uuid(8),
      prevId: uuid(9),
    });
    expectOneProblem(
      problemsOf(spec),
      /meta\/0042_snapshot\.json does not belong to a journal entry/,
    );
  });

  it("reports two snapshots with the same id", () => {
    const spec = validSpec();
    spec.snapshots[2] = {
      ...spec.snapshots[2],
      id: spec.snapshots[1]?.id,
    } as Snapshot;
    expectOneProblem(
      problemsOf(spec),
      /0051_snapshot\.json and 20261001120000_snapshot\.json share the same id/,
    );
  });

  it("reports two snapshots with the same prevId", () => {
    const spec = validSpec();
    spec.snapshots[2] = {
      ...spec.snapshots[2],
      prevId: spec.snapshots[0]?.prevId,
    } as Snapshot;
    expectOneProblem(
      problemsOf(spec),
      /0000_snapshot\.json and 20261001120000_snapshot\.json share the same prevId/,
    );
  });

  it("reports a snapshot that is not valid", () => {
    const folder = writeFolder(validSpec());
    writeFileSync(join(folder, "meta", "0000_snapshot.json"), "{");
    expectOneProblem(
      checkMigrationFolder(folder),
      /meta\/0000_snapshot\.json is not JSON/,
    );
  });

  it.each([
    ["upper case letters", "0060_Upstream_Change"],
    ["a hyphen", "0060_upstream-change"],
    ["three digits", "060_upstream_change"],
    ["fourteen digits and no name", "20261002080000"],
  ])("reports a tag with %s", (_label, tag) => {
    const spec = replaceLastEntry(
      validSpec(),
      tag,
      Date.UTC(2026, 9, 2, 8, 0, 0, 100),
    );
    expectOneProblem(
      problemsOf(spec),
      /must be NNNN_<name> \(upstream\) or YYYYMMDDHHMMSS_<name>/,
    );
  });

  it("reports a new fork migration with a four-digit number", () => {
    const spec = replaceLastEntry(
      validSpec(),
      "0060_ganttpro_new_thing",
      Date.UTC(2026, 9, 2, 8, 0, 0),
    );
    expectOneProblem(
      problemsOf(spec),
      /new fork migration with a four-digit number.*migrations\.prefix in apps\/api\/drizzle\.config\.ts/,
    );
  });

  it("reports a timestamp migration without ganttpro in the name", () => {
    const spec = replaceLastEntry(
      validSpec(),
      "20261002080000_add_index",
      Date.UTC(2026, 9, 2, 8, 0, 0, 100),
    );
    expectOneProblem(
      problemsOf(spec),
      /must be named YYYYMMDDHHMMSS_ganttpro_<description>/,
    );
  });

  it.each([
    ["February 30", "20260230080000"],
    ["month 13", "20261302080000"],
    ["hour 24", "20261002240000"],
    ["second 60", "20261002080060"],
  ])("reports a timestamp prefix with %s", (_label, prefix) => {
    const spec = replaceLastEntry(
      validSpec(),
      `${prefix}_ganttpro_x`,
      Date.UTC(2026, 9, 2, 8, 0, 0, 100),
    );
    expectOneProblem(problemsOf(spec), /is not a real UTC date and time/);
  });

  const prefixMs = Date.UTC(2026, 9, 2, 8, 0, 0);

  it.each([0, 59_999])(
    "accepts a when %i ms after the timestamp prefix",
    (offsetMs) => {
      const spec = replaceLastEntry(
        validSpec(),
        "20261002080000_ganttpro_x",
        prefixMs + offsetMs,
      );
      expect(problemsOf(spec)).toEqual([]);
    },
  );

  it.each([-1, 60_000])(
    "reports a when %i ms after the timestamp prefix",
    (offsetMs) => {
      const spec = replaceLastEntry(
        validSpec(),
        "20261002080000_ganttpro_x",
        prefixMs + offsetMs,
      );
      expectOneProblem(
        problemsOf(spec),
        /not within 60 seconds after its prefix/,
      );
    },
  );
});
