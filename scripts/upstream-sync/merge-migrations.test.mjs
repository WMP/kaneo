import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  checkFolder,
  mergeJournals,
  serializeJournal,
} from "./merge-migrations.mjs";
import {
  createMergeRepo,
  makeTempDir,
  removeDir,
  runNode,
} from "./test-utils.mjs";

const SCRIPT = new URL("./merge-migrations.mjs", import.meta.url).pathname;
const DIR = "apps/api/drizzle";

const entry = (idx, tag, when) => ({
  idx,
  version: "7",
  when,
  tag,
  breakpoints: true,
});
const journalOf = (entries) => ({
  version: "7",
  dialect: "postgresql",
  entries,
});
const journalText = (entries) => serializeJournal(journalOf(entries));
const snapshot = (id, prevId, extra = {}) =>
  `${JSON.stringify({ id, prevId, ...extra }, null, 2)}\n`;

const initEntry = entry(0, "0000_init", 1000);
const forkEntry = entry(1, "20260101000000_ganttpro_fork", 5000);
const upEntry = entry(1, "0001_up_a", 2000);
const excludedEntry = entry(2, "0002_up_excluded", 3000);

function fixtures() {
  const base = {
    [`${DIR}/0000_init.sql`]: "CREATE TABLE a (id int);\n",
    [`${DIR}/meta/_journal.json`]: journalText([initEntry]),
    [`${DIR}/meta/0000_snapshot.json`]: snapshot(
      "id-a",
      "00000000-0000-0000-0000-000000000000",
    ),
  };
  const ours = {
    [`${DIR}/20260101000000_ganttpro_fork.sql`]: "CREATE TABLE f (id int);\n",
    [`${DIR}/meta/_journal.json`]: journalText([initEntry, forkEntry]),
    [`${DIR}/meta/20260101000000_snapshot.json`]: snapshot("id-f", "id-a"),
  };
  const theirs = {
    [`${DIR}/0001_up_a.sql`]: "CREATE TABLE u (id int);\n",
    [`${DIR}/0002_up_excluded.sql`]: "CREATE TABLE e (id int);\n",
    [`${DIR}/meta/_journal.json`]: journalText([
      initEntry,
      upEntry,
      excludedEntry,
    ]),
    [`${DIR}/meta/0000_snapshot.json`]: snapshot(
      "id-a",
      "00000000-0000-0000-0000-000000000000",
      { upstream: true },
    ),
    [`${DIR}/meta/0001_snapshot.json`]: snapshot("id-u", "id-a"),
    [`${DIR}/meta/0002_snapshot.json`]: snapshot("id-e", "id-u"),
  };
  return { base, ours, theirs };
}

function excludedFile(dir) {
  const path = join(dir, "excluded.json");
  writeFileSync(
    path,
    JSON.stringify([
      { tag: "0002_up_excluded", reason: "not adopted", replacedBy: "x" },
    ]),
  );
  return path;
}

test("mergeJournals appends new upstream entries, skips excluded ones and renumbers idx", () => {
  const result = mergeJournals({
    forkJournal: journalOf([initEntry, forkEntry]),
    upstreamJournal: journalOf([initEntry, upEntry, excludedEntry]),
    excluded: [{ tag: "0002_up_excluded", reason: "r", replacedBy: "x" }],
  });
  assert.deepEqual(
    result.journal.entries.map((e) => [e.idx, e.tag, e.when]),
    [
      [0, "0000_init", 1000],
      [1, "20260101000000_ganttpro_fork", 5000],
      [2, "0001_up_a", 2000],
    ],
  );
  assert.deepEqual(result.appended, ["0001_up_a"]);
  assert.deepEqual(result.skippedExcluded, ["0002_up_excluded"]);
  assert.equal(result.notes.length, 1); // older than the newest fork entry
});

test("serializeJournal uses two spaces and a trailing newline", () => {
  const text = serializeJournal(journalOf([initEntry]));
  assert.ok(text.endsWith("}\n"));
  assert.ok(text.startsWith('{\n  "version": "7",'));
});

test("merge-migrations resolves a conflicting merge and --check passes afterwards", () => {
  const dir = createMergeRepo(fixtures());
  const scratch = makeTempDir();
  try {
    const excluded = excludedFile(scratch);
    const args = [
      "--repo",
      dir,
      "--upstream-ref",
      "upstream",
      "--excluded",
      excluded,
    ];

    const dry = runNode(SCRIPT, [...args, "--dry-run"]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /\[dry-run\]/);
    assert.ok(existsSync(join(dir, DIR, "0002_up_excluded.sql")));

    const result = runNode(SCRIPT, args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /drizzle-kit generate --name ganttpro_adopt_upstream_/,
    );

    const journal = JSON.parse(
      readFileSync(join(dir, DIR, "meta/_journal.json"), "utf8"),
    );
    assert.deepEqual(
      journal.entries.map((e) => `${e.idx}:${e.tag}:${e.when}`),
      [
        "0:0000_init:1000",
        "1:20260101000000_ganttpro_fork:5000",
        "2:0001_up_a:2000",
      ],
    );
    assert.ok(
      readFileSync(join(dir, DIR, "meta/_journal.json"), "utf8").endsWith(
        "}\n",
      ),
    );

    assert.ok(existsSync(join(dir, DIR, "0001_up_a.sql")));
    assert.ok(!existsSync(join(dir, DIR, "0002_up_excluded.sql")));
    // upstream-only snapshots do not chain onto the fork's newest snapshot
    assert.ok(!existsSync(join(dir, DIR, "meta/0001_snapshot.json")));
    assert.ok(!existsSync(join(dir, DIR, "meta/0002_snapshot.json")));
    // fork version wins for a snapshot both sides have
    assert.equal(
      JSON.parse(
        readFileSync(join(dir, DIR, "meta/0000_snapshot.json"), "utf8"),
      ).upstream,
      undefined,
    );
    assert.ok(existsSync(join(dir, DIR, "meta/20260101000000_snapshot.json")));

    const check = runNode(SCRIPT, ["--repo", dir, "--check"]);
    assert.equal(check.status, 0, check.stderr + check.stdout);
  } finally {
    removeDir(dir);
    removeDir(scratch);
  }
});

function folderWith({ entries, sql, snapshots }) {
  const root = makeTempDir();
  const folder = join(root, "drizzle");
  mkdirSync(join(folder, "meta"), { recursive: true });
  writeFileSync(join(folder, "meta/_journal.json"), journalText(entries));
  for (const tag of sql) {
    writeFileSync(join(folder, `${tag}.sql`), "SELECT 1;\n");
  }
  for (const [file, content] of Object.entries(snapshots)) {
    writeFileSync(join(folder, "meta", file), content);
  }
  return { root, folder };
}

test("checkFolder accepts a consistent folder", () => {
  const { root, folder } = folderWith({
    entries: [initEntry, forkEntry],
    sql: ["0000_init", "20260101000000_ganttpro_fork"],
    snapshots: {
      "0000_snapshot.json": snapshot("a", "0"),
      "20260101000000_snapshot.json": snapshot("b", "a"),
    },
  });
  try {
    assert.deepEqual(checkFolder(folder), []);
  } finally {
    removeDir(root);
  }
});

test("checkFolder reports mismatches between journal, SQL files and snapshots", () => {
  const { root, folder } = folderWith({
    entries: [initEntry, { ...forkEntry, idx: 5 }],
    sql: ["0000_init", "0009_orphan"],
    snapshots: {
      "0000_snapshot.json": snapshot("a", "0"),
      "0003_snapshot.json": snapshot("b", "0"),
    },
  });
  try {
    const text = checkFolder(folder).join("\n");
    assert.match(text, /has idx 5, expected 1/);
    assert.match(text, /20260101000000_ganttpro_fork has no .*\.sql file/);
    assert.match(text, /0009_orphan\.sql has no journal entry/);
    assert.match(text, /0003_snapshot\.json does not belong/);
    assert.match(text, /share the same prevId/);
  } finally {
    removeDir(root);
  }
});

test("checkFolder reports duplicate tags and duplicate when values", () => {
  const { root, folder } = folderWith({
    entries: [initEntry, entry(1, "0000_init", 1000)],
    sql: ["0000_init"],
    snapshots: {},
  });
  try {
    const text = checkFolder(folder).join("\n");
    assert.match(text, /Journal tag 0000_init is used by entries 0 and 1/);
    assert.match(text, /share the same "when"/);
  } finally {
    removeDir(root);
  }
});

test("--check exits 1 on problems and --help exits 0", () => {
  const { root, folder } = folderWith({
    entries: [initEntry],
    sql: [],
    snapshots: {},
  });
  try {
    const repo = join(folder, "..");
    const bad = runNode(SCRIPT, [
      "--repo",
      repo,
      "--drizzle-dir",
      "drizzle",
      "--check",
    ]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /0000_init has no 0000_init\.sql file/);
    assert.equal(runNode(SCRIPT, ["--help"]).status, 0);
  } finally {
    removeDir(root);
  }
});
