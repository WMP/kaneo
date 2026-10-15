// Test-change audit: a deterministic, read-only list of test-weakening signals
// in the current changes. It never changes files.
//
// Usage:
//   node .claude/skills/reliable-tests/scripts/test-change-audit.mjs [--base <git-ref>]
//
// Base: --base, else merge-base of HEAD and origin/main, else of HEAD and main,
// else HEAD. Changes are the base commit versus the working tree (staged and
// unstaged) plus untracked, non-ignored files.
//
// A signal needs a reason in the change report. It is not proof of a defect,
// and a clean result is not proof that the tests are strong.
//
// Exit codes: 0 no signal; 1 at least one signal; 2 error (not a git
// repository, unknown base).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REMINDER =
  "Signals need a reason in the change report; they are not proof of a defect, and a clean result is not proof that the tests are strong.";
const SIGNALS = [
  "runner-config",
  "contract",
  "test-deleted",
  "focus-skip",
  "fewer-tests",
  "fewer-assertions",
  "weak-matchers",
  "error-swallowing",
  "snapshot",
  "timeouts-retries",
];
const RUNNER_CONFIG = [
  /(^|\/)vitest[^/]*\.config\.[cm]?[jt]s$/,
  /(^|\/)package\.json$/,
  /^turbo\.json$/,
  /^biome\.json$/,
  /^\.github\/workflows\//,
  /^\.husky\//,
  /^tests\/api-integration\/(setup\.ts|helpers\/|mocks\/)/,
  /^apps\/web\/src\/test\//,
  /^scripts\/(ci|security)\//,
];
const CONTRACT = [
  /^docs\/agent-guide\//,
  /^(AGENTS|CLAUDE)\.md$/,
  /^\.cursor\/rules\//,
  /^\.claude\/skills\//,
];
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const INVARIANTS = "docs/agent-guide/invariants.md";
const LINE_SIGNALS = [
  ["focus-skip", /\b(?:it|test|describe|suite|bench)\.(?:only|skip|todo|fails|skipIf|runIf)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(/],
  ["error-swallowing", /\bcatch\s*(?:\(|\{)|\.catch\s*\(/],
  ["snapshot", /toMatch(?:Inline|File)?Snapshot\s*\(/],
];
const WEAK_MATCHERS = [
  ".toBeDefined()",
  ".toBeTruthy()",
  ".toBeFalsy()",
  "expect.anything()",
  ".toHaveBeenCalled()",
];
const TIMEOUTS =
  /\b(?:testTimeout|hookTimeout|timeout|retry|retries|bail|passWithNoTests|allowOnly)\b/;

class AuditError extends Error {}

export const isTestPath = (p) =>
  TEST_FILE.test(p) || p.includes("__snapshots__/") || p.endsWith(".snap");
const matchesAny = (list, p) => list.some((re) => re.test(p));
const countMatches = (text, re) => (text.match(re) ?? []).length;

function tryGit(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

function git(args, cwd) {
  const out = tryGit(args, cwd);
  if (out === null) throw new AuditError(`git ${args.join(" ")} failed`);
  return out;
}

function parseArgs(argv) {
  if (argv.length === 0) return { base: null };
  if (argv.length === 2 && argv[0] === "--base") return { base: argv[1] };
  throw new AuditError("Usage: test-change-audit.mjs [--base <git-ref>]");
}

function resolveBase(arg, root) {
  if (arg) {
    const sha = tryGit(["rev-parse", "--verify", "--quiet", `${arg}^{commit}`], root);
    if (!sha) throw new AuditError(`Unknown base ref: ${arg}`);
    return sha.trim();
  }
  for (const ref of ["origin/main", "main"]) {
    const sha = tryGit(["merge-base", "HEAD", ref], root);
    if (sha) return sha.trim();
  }
  return git(["rev-parse", "HEAD"], root).trim();
}

function listChanges(base, root) {
  const parts = git(["diff", "--name-status", "-M", "-z", base], root).split("\0");
  const changes = [];
  for (let i = 0; i < parts.length - 1; ) {
    const status = parts[i++];
    const renamed = status[0] === "R" || status[0] === "C";
    const oldPath = renamed ? parts[i++] : null;
    changes.push({ status: status[0], path: parts[i++], oldPath });
  }
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"], root);
  for (const file of untracked.split("\0").filter(Boolean))
    changes.push({ status: "A", path: file, oldPath: null, untracked: true });
  return changes;
}

function readCurrent(root, file) {
  try {
    return fs.readFileSync(path.join(root, file), "utf8");
  } catch {
    return "";
  }
}

const readBase = (base, root, file) => tryGit(["show", `${base}:${file}`], root) ?? "";

export function parseAddedLines(diff) {
  const added = [];
  let inHunk = false;
  let line = 0;
  for (const text of diff.split("\n")) {
    const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      inHunk = true;
      line = Number(hunk[1]);
    } else if (text.startsWith("diff --git")) inHunk = false;
    else if (inHunk && text.startsWith("+")) added.push({ line: line++, text: text.slice(1) });
  }
  return added;
}

function addedLines(base, root, change, current) {
  if (change.untracked)
    return current.split("\n").map((text, i) => ({ line: i + 1, text }));
  const paths = change.oldPath ? [change.oldPath, change.path] : [change.path];
  return parseAddedLines(git(["diff", "-U0", "-M", base, "--", ...paths], root));
}

export function invariantStatuses(text) {
  const statuses = new Map();
  for (const row of text.split("\n")) {
    const id = row.match(/^\| (KAN-[A-Z]+-\d{3}) \|/)?.[1];
    if (!id) continue;
    const cells = row.split("|").map((c) => c.trim().replaceAll("`", ""));
    statuses.set(id, cells.find((c) => ["enforced", "partial", "unenforced"].includes(c)) ?? "?");
  }
  return statuses;
}

function invariantChanges(oldText, newText) {
  const before = invariantStatuses(oldText);
  const after = invariantStatuses(newText);
  const details = [];
  for (const [id, status] of after) {
    if (!before.has(id)) details.push(`${id}: (new) -> ${status}`);
    else if (before.get(id) !== status) details.push(`${id}: ${before.get(id)} -> ${status}`);
  }
  for (const [id, status] of before)
    if (!after.has(id)) details.push(`${id}: ${status} -> (removed)`);
  return details;
}

function auditLines(add, lines) {
  const show = ({ line, text }) => `line ${line}: ${text.trim().slice(0, 100)}`;
  for (const [signal, re] of LINE_SIGNALS) {
    for (const l of lines.filter((x) => re.test(x.text))) add(signal, show(l));
  }
  const weak = lines.filter((x) => WEAK_MATCHERS.some((m) => x.text.includes(m)));
  if (weak.length > 0)
    add("weak-matchers", `${weak.length} added line(s), e.g. ${weak.slice(0, 5).map(show).join("; ")}`);
  for (const l of lines.filter((x) => TIMEOUTS.test(x.text))) add("timeouts-retries", show(l));
}

function auditCounts(add, baseText, current) {
  const checks = [
    ["fewer-tests", /\b(?:it|test)(?:\.\w+)*\s*\(/g, "test calls"],
    ["fewer-assertions", /\bexpect(?:\.soft)?\s*\(/g, "expect calls"],
  ];
  for (const [signal, re, label] of checks) {
    const before = countMatches(baseText, re);
    const now = countMatches(current, re);
    if (now < before) add(signal, `${label}: ${before} -> ${now}`);
  }
}

function auditChange(change, ctx, add) {
  const { base, root } = ctx;
  const file = change.path;
  const deleted = change.status === "D";
  const isTest = isTestPath(file);
  const runner = matchesAny(RUNNER_CONFIG, file);
  const current = deleted ? "" : readCurrent(root, file);
  const baseText = change.untracked ? "" : readBase(base, root, change.oldPath ?? file);
  const record = (signal, detail) => add(signal, file, detail);
  if (runner) record("runner-config", `changed (${change.status})`);
  if (matchesAny(CONTRACT, file)) record("contract", `changed (${change.status})`);
  if (file === INVARIANTS)
    for (const d of invariantChanges(baseText, current)) record("contract", d);
  if (isTest && deleted) record("test-deleted", "test file deleted");
  if (isTest && !deleted) {
    if (file.includes("__snapshots__/") || file.endsWith(".snap")) record("snapshot", `snapshot file changed (${change.status})`);
    if (change.status !== "A") auditCounts(record, baseText, current);
  }
  if (deleted || !(isTest || runner)) return;
  const lines = addedLines(base, root, change, current);
  if (isTest) auditLines(record, lines);
  else for (const l of lines.filter((x) => TIMEOUTS.test(x.text))) record("timeouts-retries", `line ${l.line}: ${l.text.trim().slice(0, 100)}`);
}

function report(base, findings, newTests) {
  const out = [`Base: ${base}`, ""];
  let total = 0;
  const files = new Set();
  for (const signal of SIGNALS) {
    const byFile = findings.get(signal);
    if (!byFile) continue;
    out.push(`== ${signal} ==`);
    for (const [file, details] of byFile) {
      total += 1;
      files.add(file);
      out.push(`  ${file}`, ...details.map((d) => `    - ${d}`));
    }
    out.push("");
  }
  if (newTests.length > 0)
    out.push(
      "info: new-test-files (not a signal; confirm that each new file appears in the runner output)",
      ...newTests.map((f) => `  ${f}`),
      "",
    );
  out.push(`Total: ${total} signal(s) in ${files.size} file(s). ${REMINDER}`);
  return { text: out.join("\n"), total };
}

function main() {
  try {
    const { base: baseArg } = parseArgs(process.argv.slice(2));
    const top = tryGit(["rev-parse", "--show-toplevel"], process.cwd());
    if (!top) throw new AuditError("Not a git repository");
    const root = top.trim();
    const base = resolveBase(baseArg, root);
    const findings = new Map();
    const add = (signal, file, detail) => {
      const byFile = findings.get(signal) ?? new Map();
      byFile.set(file, [...(byFile.get(file) ?? []), detail]);
      findings.set(signal, byFile);
    };
    const changes = listChanges(base, root);
    for (const change of changes) auditChange(change, { base, root }, add);
    const newTests = changes
      .filter((c) => c.status === "A" && isTestPath(c.path))
      .map((c) => c.path);
    const { text, total } = report(base, findings, newTests);
    console.log(text);
    process.exitCode = total > 0 ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
