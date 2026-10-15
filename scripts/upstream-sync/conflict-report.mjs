#!/usr/bin/env node
// Classifies the unmerged paths of an in-progress `git merge` by conflict
// status and by area. Read-only: it never changes the index or the worktree.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  fail,
  git,
  gitOrNull,
  globToRegExp,
  isMain,
  REPO_ROOT,
  SCRIPT_DIR,
} from "./lib.mjs";

const HELP = `Usage: node scripts/upstream-sync/conflict-report.mjs [options]

Reports the unmerged paths of an in-progress merge, by status and area.

Options:
  --upstream-ref <ref>  Upstream ref (default: upstream/main)
  --fork-ref <ref>      Fork ref (default: HEAD)
  --areas <file>        Area rules (default: scripts/upstream-sync/areas.json)
  --repo <dir>          Repository directory (default: this repository)
  --json                Machine-readable output
  --markdown            Markdown output for a pull request comment
  -h, --help            Show this help

Exit codes: 0 no unmerged paths, 1 unmerged paths remain, 2 error.`;

export const STATUS_LABELS = {
  UU: "both modified",
  AA: "both added",
  UD: "deleted by upstream",
  DU: "deleted by fork",
  AU: "added by fork",
  UA: "added by upstream",
  DD: "both deleted",
};

/** Parses `git status --porcelain=v1 -z` and returns the unmerged entries. */
export function parseStatusZ(output) {
  const tokens = output.split("\0");
  const entries = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.length < 4) {
      continue;
    }
    const code = token.slice(0, 2);
    const path = token.slice(3);
    if (
      code[0] === "R" ||
      code[0] === "C" ||
      code[1] === "R" ||
      code[1] === "C"
    ) {
      i += 1; // the original path follows
      continue;
    }
    if (code in STATUS_LABELS) {
      entries.push({ code, path });
    }
  }
  return entries;
}

/** Parses `git ls-files -u -z` into Map<path, Set<stage>>. */
export function parseUnmergedStages(output) {
  const stages = new Map();
  for (const record of output.split("\0")) {
    const match = /^\d+ [0-9a-f]+ ([123])\t(.*)$/s.exec(record);
    if (!match) {
      continue;
    }
    if (!stages.has(match[2])) {
      stages.set(match[2], new Set());
    }
    stages.get(match[2]).add(Number(match[1]));
  }
  return stages;
}

/** Derives the status code from the stages present (1 base, 2 fork, 3 upstream). */
export function codeFromStages(stages) {
  const has = (n) => stages.has(n);
  if (has(2) && has(3)) {
    return has(1) ? "UU" : "AA";
  }
  if (has(2)) {
    return has(1) ? "UD" : "AU";
  }
  if (has(3)) {
    return has(1) ? "DU" : "UA";
  }
  return "DD";
}

export function compileAreas(config) {
  return config.areas.map(({ area, patterns }) => ({
    area,
    regexps: patterns.map(globToRegExp),
  }));
}

export function classifyArea(path, compiled) {
  for (const { area, regexps } of compiled) {
    if (regexps.some((regexp) => regexp.test(path))) {
      return area;
    }
  }
  return "other";
}

export function countHunks(content) {
  return content.split("\n").filter((line) => line.startsWith("<<<<<<< "))
    .length;
}

/** Merges status and stage data into one record per path, sorted by path. */
export function buildRecords({ statusEntries, stages, compiled }) {
  const byPath = new Map(
    statusEntries.map((entry) => [entry.path, entry.code]),
  );
  for (const [path, set] of stages) {
    if (!byPath.has(path)) {
      byPath.set(path, codeFromStages(set));
    }
  }
  return [...byPath.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, code]) => ({
      path,
      code,
      status: STATUS_LABELS[code],
      area: classifyArea(path, compiled),
      hunks: 0,
      deletedBy: null,
    }));
}

function groupBy(records, key) {
  const groups = new Map();
  for (const record of records) {
    groups.set(key(record), [...(groups.get(key(record)) ?? []), record]);
  }
  return groups;
}

function deletedLabel(record) {
  return record.code === "UD" ? "deleted upstream" : "deleted by fork";
}

function pad(value, width) {
  return String(value).padEnd(width);
}

export function renderTable(records, compiled) {
  if (records.length === 0) {
    return "No unmerged paths.";
  }
  const order = [...compiled.map((c) => c.area), "other"];
  const sorted = [...records].sort(
    (a, b) =>
      order.indexOf(a.area) - order.indexOf(b.area) ||
      (a.path < b.path ? -1 : 1),
  );
  const widths = {
    area: Math.max(4, ...sorted.map((r) => r.area.length)),
    code: 2,
    status: Math.max(6, ...sorted.map((r) => r.status.length)),
    hunks: 5,
  };
  const lines = [
    `${pad("AREA", widths.area)}  ${pad("ST", widths.code)}  ${pad("STATUS", widths.status)}  ${pad("HUNKS", widths.hunks)}  PATH`,
  ];
  for (const r of sorted) {
    const note = r.deletedBy ? `  [${deletedLabel(r)} in ${r.deletedBy}]` : "";
    lines.push(
      `${pad(r.area, widths.area)}  ${pad(r.code, widths.code)}  ${pad(r.status, widths.status)}  ${pad(r.hunks, widths.hunks)}  ${r.path}${note}`,
    );
  }
  lines.push("", summaryLine(records));
  for (const [area, group] of groupBy(sorted, (r) => r.area)) {
    lines.push(
      `  ${pad(area, widths.area)}  ${group.length} path(s), ${group.reduce((s, r) => s + r.hunks, 0)} hunk(s)`,
    );
  }
  return lines.join("\n");
}

function summaryLine(records) {
  const byCode = groupBy(records, (r) => r.code);
  const parts = [...byCode.entries()].map(
    ([code, group]) => `${code}=${group.length}`,
  );
  return `${records.length} unmerged path(s): ${parts.join(", ")}`;
}

export function renderMarkdown(records, compiled) {
  if (records.length === 0) {
    return "No unmerged paths.";
  }
  const order = [...compiled.map((c) => c.area), "other"];
  const groups = groupBy(records, (r) => r.area);
  const lines = [
    `**${summaryLine(records)}**`,
    "",
    "| Area | Paths | Hunks |",
    "| --- | ---: | ---: |",
  ];
  for (const area of order) {
    const group = groups.get(area);
    if (group) {
      lines.push(
        `| ${area} | ${group.length} | ${group.reduce((s, r) => s + r.hunks, 0)} |`,
      );
    }
  }
  for (const area of order) {
    const group = groups.get(area);
    if (!group) {
      continue;
    }
    lines.push(
      "",
      `### ${area}`,
      "",
      "| Status | Hunks | Path |",
      "| --- | ---: | --- |",
    );
    for (const r of group) {
      const note = r.deletedBy
        ? ` (${deletedLabel(r)} in \`${r.deletedBy}\`)`
        : "";
      lines.push(
        `| ${r.code} ${r.status} | ${r.hunks} | \`${r.path}\`${note} |`,
      );
    }
  }
  return lines.join("\n");
}

function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        "upstream-ref": { type: "string", default: "upstream/main" },
        "fork-ref": { type: "string", default: "HEAD" },
        areas: { type: "string", default: join(SCRIPT_DIR, "areas.json") },
        repo: { type: "string", default: REPO_ROOT },
        json: { type: "boolean", default: false },
        markdown: { type: "boolean", default: false },
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
  const cwd = values.repo;
  const compiled = compileAreas(JSON.parse(readFileSync(values.areas, "utf8")));

  let statusOutput;
  let unmergedOutput;
  try {
    statusOutput = git(["status", "--porcelain=v1", "-z"], { cwd });
    unmergedOutput = git(["ls-files", "-u", "-z"], { cwd });
  } catch (error) {
    fail(`git failed: ${error.message}`);
  }
  const records = buildRecords({
    statusEntries: parseStatusZ(statusOutput),
    stages: parseUnmergedStages(unmergedOutput),
    compiled,
  });
  for (const record of records) {
    try {
      record.hunks = countHunks(readFileSync(join(cwd, record.path), "utf8"));
    } catch {
      record.hunks = 0; // deleted in the worktree
    }
    if (record.code === "UD" || record.code === "DU") {
      const ref =
        record.code === "UD" ? values["upstream-ref"] : values["fork-ref"];
      const log = gitOrNull(
        [
          "log",
          "--diff-filter=D",
          "--format=%h %s",
          "-1",
          ref,
          "--",
          record.path,
        ],
        { cwd },
      );
      record.deletedBy = log?.trim() || null;
    }
  }

  if (values.json) {
    console.log(JSON.stringify({ total: records.length, records }, null, 2));
  } else if (values.markdown) {
    console.log(renderMarkdown(records, compiled));
  } else {
    console.log(renderTable(records, compiled));
  }
  process.exitCode = records.length > 0 ? 1 : 0;
}

if (isMain(import.meta.url)) {
  main();
}
