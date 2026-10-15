#!/usr/bin/env node
// Resolves apps/api/drizzle after `git merge upstream/main`, following the
// "Upstream sync" section of docs/agent-guide/database.md.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { fail, gitOrNull, isMain, REPO_ROOT, SCRIPT_DIR } from "./lib.mjs";

const HELP = `Usage: node scripts/upstream-sync/merge-migrations.mjs [options]

Merges the Drizzle journal: fork entries stay as they are, upstream entries
that the fork does not have and that are not excluded are appended (upstream
tag and "when" kept, idx renumbered). Snapshots: the fork's files win;
upstream-only snapshots that do not chain onto the fork's newest snapshot are
deleted, as are the files of excluded migrations. Files are changed in the
worktree only (not staged).

Options:
  --drizzle-dir <dir>      Migration folder, relative to the repo (default: apps/api/drizzle)
  --excluded <file>        Excluded migrations (default: scripts/upstream-sync/excluded-migrations.json)
  --upstream-ref <ref>     Upstream ref (default: upstream/main)
  --fork-ref <ref>         Fork ref (default: HEAD)
  --repo <dir>             Repository directory (default: this repository)
  --dry-run                Print what would change, write nothing
  --check                  Only verify the folder: journal and .sql files match one to
                           one, idx is the position, tags and "when" are unique, every
                           snapshot belongs to an entry and no two snapshots share an
                           id or a prevId. Exit 1 on a problem. (The vitest journal test
                           also checks the watermark and the tag names.)
  -h, --help               Show this help

Exit codes: 0 done / check passed, 1 check found problems, 2 error.`;

const tagPrefix = (name) => name.split("_")[0] ?? "";

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function groupDuplicates(items, key) {
  const groups = new Map();
  for (const item of items) {
    groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

/** Problems of a migration folder (same rules as tests/api/database/migration-journal.test.ts, minus watermark and names). */
export function checkFolder(folder) {
  let entries;
  try {
    entries = JSON.parse(
      readFileSync(join(folder, "meta", "_journal.json"), "utf8"),
    ).entries;
  } catch (error) {
    return [`meta/_journal.json cannot be read: ${error.message}`];
  }
  if (
    !Array.isArray(entries) ||
    !entries.every(
      (e) =>
        typeof e?.tag === "string" &&
        Number.isInteger(e.idx) &&
        Number.isInteger(e.when),
    )
  ) {
    return [
      'meta/_journal.json must contain "entries", each with a string "tag" and integer "idx" and "when".',
    ];
  }
  const problems = [];
  entries.forEach((entry, index) => {
    if (entry.idx !== index) {
      problems.push(
        `Journal entry ${entry.tag} has idx ${entry.idx}, expected ${index}.`,
      );
    }
  });
  for (const group of groupDuplicates(entries, (e) => e.tag)) {
    problems.push(
      `Journal tag ${group[0].tag} is used by entries ${group.map((e) => e.idx).join(" and ")}.`,
    );
  }
  for (const group of groupDuplicates(entries, (e) => e.when)) {
    problems.push(
      `Journal entries ${group.map((e) => e.tag).join(" and ")} share the same "when" (${group[0].when}).`,
    );
  }
  const sqlFiles = readdirSync(folder).filter((f) => f.endsWith(".sql"));
  const tags = new Set(entries.map((e) => e.tag));
  for (const tag of tags) {
    if (!sqlFiles.includes(`${tag}.sql`)) {
      problems.push(`Journal entry ${tag} has no ${tag}.sql file.`);
    }
  }
  for (const file of sqlFiles) {
    if (!tags.has(file.replace(/\.sql$/, ""))) {
      problems.push(`${file} has no journal entry.`);
    }
  }
  const prefixes = new Set(entries.map((e) => tagPrefix(e.tag)));
  const snapshots = [];
  const metaFiles = readdirSync(join(folder, "meta"))
    .filter((f) => f.endsWith("_snapshot.json"))
    .sort();
  for (const file of metaFiles) {
    if (!prefixes.has(tagPrefix(file))) {
      problems.push(
        `meta/${file} does not belong to a journal entry: no journal tag starts with ${tagPrefix(file)}_.`,
      );
    }
    try {
      const content = readJsonFile(join(folder, "meta", file));
      if (
        typeof content?.id === "string" &&
        typeof content.prevId === "string"
      ) {
        snapshots.push({ file, id: content.id, prevId: content.prevId });
      } else {
        problems.push(
          `meta/${file} is not JSON with a string "id" and a string "prevId".`,
        );
      }
    } catch {
      problems.push(
        `meta/${file} is not JSON with a string "id" and a string "prevId".`,
      );
    }
  }
  for (const group of groupDuplicates(snapshots, (s) => s.id)) {
    problems.push(
      `Snapshots ${group.map((s) => s.file).join(" and ")} share the same id (${group[0].id}).`,
    );
  }
  for (const group of groupDuplicates(snapshots, (s) => s.prevId)) {
    problems.push(
      `Snapshots ${group.map((s) => s.file).join(" and ")} share the same prevId (${group[0].prevId}).`,
    );
  }
  return problems;
}

/** Merges the journals. Returns { journal, appended, skippedExcluded, notes }. */
export function mergeJournals({ forkJournal, upstreamJournal, excluded }) {
  const excludedTags = new Set(excluded.map((e) => e.tag));
  const forkTags = new Set(forkJournal.entries.map((e) => e.tag));
  const newestForkWhen = Math.max(...forkJournal.entries.map((e) => e.when));
  const appended = [];
  const skippedExcluded = [];
  const notes = [];
  for (const entry of upstreamJournal.entries) {
    if (forkTags.has(entry.tag)) {
      continue;
    }
    if (excludedTags.has(entry.tag)) {
      skippedExcluded.push(entry.tag);
      continue;
    }
    appended.push(entry);
    if (entry.when < newestForkWhen) {
      notes.push(
        `${entry.tag} is older (when ${entry.when}) than the newest fork entry; on upgraded fork databases it runs after the newer fork migrations. Check that it does not depend on the order.`,
      );
    }
  }
  const entries = [...forkJournal.entries, ...appended].map((entry, idx) => ({
    ...entry,
    idx,
  }));
  return {
    journal: { ...forkJournal, entries },
    appended: appended.map((e) => e.tag),
    skippedExcluded,
    notes,
  };
}

export function serializeJournal(journal) {
  return `${JSON.stringify(journal, null, 2)}\n`;
}

function listTree(repo, ref, dir) {
  const out = gitOrNull(["ls-tree", "-r", "--name-only", ref, `${dir}/`], {
    cwd: repo,
  });
  return new Set(
    (out ?? "")
      .split("\n")
      .filter(Boolean)
      .map((p) => p.slice(dir.length + 1)),
  );
}

function readStage({ repo, stage, ref, path }) {
  return (
    gitOrNull(["show", `:${stage}:${path}`], { cwd: repo }) ??
    gitOrNull(["show", `${ref}:${path}`], { cwd: repo })
  );
}

function run({ repo, drizzleDir, excludedFile, forkRef, upstreamRef, dryRun }) {
  const folder = join(repo, drizzleDir);
  const journalPath = `${drizzleDir}/meta/_journal.json`;
  const forkText = readStage({
    repo,
    stage: 2,
    ref: forkRef,
    path: journalPath,
  });
  const upstreamText = readStage({
    repo,
    stage: 3,
    ref: upstreamRef,
    path: journalPath,
  });
  if (forkText === null || upstreamText === null) {
    fail(
      `Cannot read ${journalPath} from the fork (${forkRef}) or upstream (${upstreamRef}).`,
    );
  }
  const excluded = readJsonFile(excludedFile);
  const result = mergeJournals({
    forkJournal: JSON.parse(forkText),
    upstreamJournal: JSON.parse(upstreamText),
    excluded,
  });
  const prefix = dryRun ? "[dry-run] " : "";
  const act = (message, fn) => {
    console.log(`${prefix}${message}`);
    if (!dryRun) {
      fn();
    }
  };

  act(
    `journal: ${result.journal.entries.length} entries (${result.appended.length} appended from upstream)`,
    () =>
      writeFileSync(
        join(folder, "meta", "_journal.json"),
        serializeJournal(result.journal),
      ),
  );
  for (const tag of result.appended) {
    console.log(`  + ${tag}`);
  }
  for (const tag of result.skippedExcluded) {
    const info = excluded.find((e) => e.tag === tag);
    console.log(
      `  - excluded ${tag}: ${info.reason}${info.replacedBy ? ` (replaced by ${info.replacedBy})` : ""}`,
    );
  }
  for (const note of result.notes) {
    console.log(`  ! ${note}`);
  }

  const forkFiles = listTree(repo, forkRef, drizzleDir);
  const upstreamFiles = listTree(repo, upstreamRef, drizzleDir);
  const finalTags = new Set(result.journal.entries.map((e) => e.tag));
  const forkTags = new Set(JSON.parse(forkText).entries.map((e) => e.tag));
  const appendedTags = new Set(result.appended);

  // SQL files of appended entries must exist; SQL files of excluded tags go.
  for (const file of upstreamFiles) {
    if (!file.endsWith(".sql") || file.includes("/")) {
      continue;
    }
    const tag = file.replace(/\.sql$/, "");
    const path = join(folder, file);
    if (appendedTags.has(tag) && !existsSync(path)) {
      act(`restore ${file} from upstream`, () => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(
          path,
          readStage({
            repo,
            stage: 3,
            ref: upstreamRef,
            path: `${drizzleDir}/${file}`,
          }),
        );
      });
    } else if (!finalTags.has(tag) && !forkTags.has(tag) && existsSync(path)) {
      act(`delete ${file} (excluded upstream migration)`, () => rmSync(path));
    }
  }

  // Snapshots.
  const snapshotName = /^\d+_snapshot\.json$/;
  const metaDir = `${drizzleDir}/meta`;
  const forkSnapshots = [...forkFiles].filter(
    (f) => f.startsWith("meta/") && snapshotName.test(f.slice(5)),
  );
  const upstreamSnapshots = [...upstreamFiles].filter(
    (f) => f.startsWith("meta/") && snapshotName.test(f.slice(5)),
  );
  const forkPrefixes = new Set(
    result.journal.entries
      .filter((e) => forkTags.has(e.tag))
      .map((e) => tagPrefix(e.tag)),
  );

  for (const file of forkSnapshots) {
    if (!upstreamFiles.has(file)) {
      continue;
    }
    const path = join(folder, file);
    const forkContent = readStage({
      repo,
      stage: 2,
      ref: forkRef,
      path: `${drizzleDir}/${file}`,
    });
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (forkContent !== null && current !== forkContent) {
      act(`keep fork version of ${file}`, () =>
        writeFileSync(path, forkContent),
      );
    }
  }

  const sortedForkSnapshots = [...forkSnapshots].sort();
  let lastFile = sortedForkSnapshots.at(-1)?.slice(5);
  let lastId = null;
  if (lastFile) {
    try {
      lastId = JSON.parse(
        readStage({
          repo,
          stage: 2,
          ref: forkRef,
          path: `${metaDir}/${lastFile}`,
        }),
      ).id;
    } catch {
      lastId = null;
    }
  }
  const appendedPrefixes = result.journal.entries
    .filter((e) => appendedTags.has(e.tag))
    .map((e) => tagPrefix(e.tag));
  const upstreamOnly = upstreamSnapshots
    .filter((f) => !forkFiles.has(f))
    .map((f) => f.slice(5))
    .sort();
  const keepers = new Set();
  for (const prefixValue of appendedPrefixes) {
    const file = upstreamOnly.find((f) => tagPrefix(f) === prefixValue);
    if (!file || forkPrefixes.has(prefixValue)) {
      continue;
    }
    try {
      const content = JSON.parse(
        readStage({
          repo,
          stage: 3,
          ref: upstreamRef,
          path: `${metaDir}/${file}`,
        }),
      );
      if (content.prevId === lastId && (!lastFile || file > lastFile)) {
        keepers.add(file);
        lastFile = file;
        lastId = content.id;
      }
    } catch {
      // unreadable: delete below
    }
  }
  for (const file of upstreamOnly) {
    const path = join(folder, "meta", file);
    if (keepers.has(file)) {
      console.log(
        `  keep upstream snapshot meta/${file} (chains onto the fork's newest snapshot)`,
      );
      continue;
    }
    if (existsSync(path)) {
      const why = forkPrefixes.has(tagPrefix(file))
        ? "prefix collides with a fork entry"
        : "does not chain onto the fork's snapshots or belongs to an excluded migration";
      act(`delete meta/${file} (${why})`, () => rmSync(path));
    }
  }

  return result;
}

function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        "drizzle-dir": { type: "string", default: "apps/api/drizzle" },
        excluded: {
          type: "string",
          default: join(SCRIPT_DIR, "excluded-migrations.json"),
        },
        "upstream-ref": { type: "string", default: "upstream/main" },
        "fork-ref": { type: "string", default: "HEAD" },
        repo: { type: "string", default: REPO_ROOT },
        "dry-run": { type: "boolean", default: false },
        check: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    fail(`${error.message}\n\n${HELP}`);
  }
  const { values } = parsed;
  if (values.help) {
    console.log(HELP);
    return;
  }
  const drizzleDir = values["drizzle-dir"].replace(/\/+$/, "");
  if (values.check) {
    const problems = checkFolder(join(values.repo, drizzleDir));
    if (problems.length === 0) {
      console.log(
        `${drizzleDir}: journal, SQL files and snapshots are consistent.`,
      );
      return;
    }
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    process.exitCode = 1;
    return;
  }
  run({
    repo: values.repo,
    drizzleDir,
    excludedFile: values.excluded,
    forkRef: values["fork-ref"],
    upstreamRef: values["upstream-ref"],
    dryRun: values["dry-run"],
  });
  console.log(`
Next:
  1. git add -A ${drizzleDir}   (marks the conflicts resolved and records the deletions)
  2. The newest snapshot must describe the merged schema.ts. Generate it:
       pnpm --filter @kaneo/api exec drizzle-kit generate --name ganttpro_adopt_upstream_<label>
     then edit the new SQL down to the statements that no upstream migration covers:
       node scripts/upstream-sync/uncovered-ddl.mjs <generated.sql> <upstream sql files...>
  3. node scripts/upstream-sync/merge-migrations.mjs --check
     and the journal test (pnpm exec vp test tests/api/database/migration-journal.test.ts)`);
}

if (isMain(import.meta.url)) {
  main();
}
