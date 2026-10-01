// Mutation probe: run targeted mutation checks in an isolated git worktree so a
// mutant can never stay in the caller's working tree, and classify each result.
//
// Usage:
//   node .claude/skills/reliable-tests/scripts/mutation-probe.mjs \
//     [--mutants <mutants.json>] [--revert <ref> [--revert-path <path>]...] \
//     [--setup "<shell command>"] [--timeout <seconds>] [--no-install] [--keep] \
//     [--json <out.json>] -- <test command> [args...]
//
// At least one of --mutants and --revert is required. With --revert <ref> the
// probe also runs the tests once with the changed production files restored to
// <ref> (the state before the change); test files keep their current version.
// A test that detects the change fails on that old state (KILLED). The files are
// every production path or derived file (generated route tree, .d.ts, migration
// metadata; see isRevertPath in change-scope.mjs) that differs between <ref> and
// the probed state, or exactly the --revert-path paths. A path that does not
// exist at <ref> is deleted for the run. The revert result comes first.
//
// The caller's state (HEAD plus uncommitted tracked changes, via
// `git stash create`) is checked out in a temporary detached worktree and the
// caller's untracked, non-ignored files are copied in. The caller's index,
// working tree and stash list are never touched.
//
// Statuses: SURVIVED (tests passed), KILLED (tests failed with failing-test
// output), ERROR (non-zero exit without a failed assertion: compile, import,
// setup or runtime error, or timeout; not evidence of detection), INVALID
// (the mutant could not be applied).
//
// Exit codes: 0 every mutant and the revert result KILLED; 1 any entry SURVIVED, ERROR or INVALID;
// 2 usage error, failed install or setup, red baseline or failed revert.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isRevertPath, resolveBase } from "./change-scope.mjs";

const USAGE =
  'Usage: mutation-probe.mjs [--mutants <mutants.json>] [--revert <ref> [--revert-path <path>]...] [--setup "<cmd>"] [--timeout <s>] [--no-install] [--keep] [--json <out.json>] -- <test command> [args...]  (at least one of --mutants and --revert)';
const NODE_TEST_NOTE =
  "check the cause: node:test also counts a file that fails to load as a failed test";
const FOOTER =
  "Inspect every KILLED result: the failure must come from the behavior the mutant changed. Classify every SURVIVED mutant as a real gap, an equivalent mutant, behavior outside the contract, or a tool problem.";
const REVERT_FOOTER =
  "A KILLED revert result means that the tests fail on the old code; check that the failure is the asserted behavior, not a missing export or a load error.";
const MAX_BUFFER = 512 * 1024 * 1024;
const MAX_DESCRIBED = 5;

class ProbeError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

export function parseArgs(argv) {
  const sep = argv.indexOf("--");
  const head = sep === -1 ? argv : argv.slice(0, sep);
  const opts = {
    mutants: null,
    revert: null,
    revertPaths: [],
    setup: null,
    timeout: 600,
    install: true,
    keep: false,
    json: null,
    command: sep === -1 ? [] : argv.slice(sep + 1),
  };
  let i = 0;
  const value = (flag) => {
    if (i + 1 >= head.length)
      throw new ProbeError(`${flag} needs a value\n${USAGE}`);
    i += 1;
    return head[i];
  };
  for (; i < head.length; i += 1) {
    const flag = head[i];
    if (flag === "--mutants") opts.mutants = value(flag);
    else if (flag === "--revert") opts.revert = value(flag);
    else if (flag === "--revert-path") opts.revertPaths.push(value(flag));
    else if (flag === "--setup") opts.setup = value(flag);
    else if (flag === "--json") opts.json = value(flag);
    else if (flag === "--timeout") opts.timeout = Number(value(flag));
    else if (flag === "--no-install") opts.install = false;
    else if (flag === "--keep") opts.keep = true;
    else throw new ProbeError(`Unknown option ${flag}\n${USAGE}`);
  }
  if (opts.revertPaths.length > 0 && !opts.revert)
    throw new ProbeError(`--revert-path needs --revert\n${USAGE}`);
  if ((!opts.mutants && !opts.revert) || opts.command.length === 0)
    throw new ProbeError(
      `At least one of --mutants and --revert, and a test command are required\n${USAGE}`,
    );
  if (!(opts.timeout > 0))
    throw new ProbeError(`--timeout must be a positive number\n${USAGE}`);
  return opts;
}

export function loadMutants(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new ProbeError(`Cannot read mutants file ${file}: ${error.message}`);
  }
  if (!Array.isArray(data?.mutants) || data.mutants.length === 0)
    throw new ProbeError("Mutants file needs a non-empty `mutants` array");
  const seen = new Set();
  for (const m of data.mutants) {
    if (typeof m?.id !== "string" || m.id === "")
      throw new ProbeError("Every mutant needs a string `id`");
    if (seen.has(m.id)) throw new ProbeError(`Duplicate mutant id ${m.id}`);
    seen.add(m.id);
    const edit = [m.file, m.search, m.replace].every(
      (v) => typeof v === "string",
    );
    if (edit === (typeof m.patch === "string"))
      throw new ProbeError(
        `Mutant ${m.id} needs either file/search/replace or patch`,
      );
  }
  return data.mutants.map((m) =>
    typeof m.patch === "string"
      ? { ...m, patch: path.resolve(process.cwd(), m.patch) }
      : m,
  );
}

function tryGit(args, cwd) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function git(args, cwd) {
  const r = tryGit(args, cwd);
  if (r.status !== 0)
    throw new ProbeError(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

function gitBuffer(args, cwd) {
  const r = spawnSync("git", args, { cwd, maxBuffer: MAX_BUFFER });
  if (r.status !== 0)
    throw new ProbeError(`git ${args.join(" ")} failed: ${r.stderr}`.trim());
  return r.stdout;
}

const tail = (text, n) =>
  text.split("\n").filter((l) => l.trim() !== "").slice(-n).join("\n");

function describeMutant(m) {
  if (m.patch) return `patch ${m.patch}`;
  return `${m.file}: ${JSON.stringify(m.search)} -> ${JSON.stringify(m.replace)}`;
}

function applyEdit(m, wt) {
  if (path.isAbsolute(m.file))
    return { reason: "file must be relative to the repository root" };
  const target = path.resolve(wt, m.file);
  const rel = path.relative(wt, target);
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`))
    return { reason: "file escapes the repository root" };
  if (m.search === "") return { reason: "search text is empty" };
  let original;
  try {
    original = fs.readFileSync(target);
  } catch (error) {
    return { reason: `cannot read ${m.file}: ${error.code}` };
  }
  const count = original.toString("utf8").split(m.search).length - 1;
  if (count !== 1)
    return { reason: `search text found ${count} times, expected exactly 1` };
  const mutated = original.toString("utf8").replace(m.search, () => m.replace);
  fs.writeFileSync(target, mutated);
  return { revert: () => fs.writeFileSync(target, original) };
}

function applyPatch(m, wt) {
  const check = tryGit(["apply", "--check", m.patch], wt);
  if (check.status !== 0)
    return { reason: `git apply --check failed: ${check.stderr.trim()}` };
  git(["apply", m.patch], wt);
  return { revert: () => git(["apply", "-R", m.patch], wt) };
}

const applyMutant = (m, wt) =>
  m.patch ? applyPatch(m, wt) : applyEdit(m, wt);

function runTests(command, cwd, timeoutSeconds) {
  const r = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    timeout: timeoutSeconds * 1000,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  const timedOut = r.error?.code === "ETIMEDOUT";
  const spawnError = r.error && !timedOut ? r.error.message : "";
  return {
    status: r.status,
    timedOut,
    output: `${r.stdout ?? ""}${r.stderr ?? ""}${spawnError}`,
  };
}

function failedCount(output) {
  const patterns = [
    /^\s*Tests\s+(\d+)\s+failed/m,
    /^ℹ fail (\d+)/m,
    /^# fail (\d+)/m,
  ];
  return Math.max(...patterns.map((re) => Number(output.match(re)?.[1] ?? 0)));
}

export function classify(run) {
  if (run.timedOut) return "ERROR";
  if (run.status === 0) return "SURVIVED";
  return failedCount(run.output) > 0 ? "KILLED" : "ERROR";
}

export function evidence(output) {
  const lines = output.split("\n").filter((l) => l.trim() !== "");
  const hits = lines.filter((l) => /^\s*(FAIL|×|✖)\s/.test(l));
  return (hits.length > 0 ? hits.slice(0, 8) : lines.slice(-8)).map((l) =>
    l.trimEnd(),
  );
}

function notesFor(output) {
  const nodeTest = /^ℹ fail \d+/m.test(output) || /^# fail \d+/m.test(output);
  const loadError = /SyntaxError|ERR_MODULE_NOT_FOUND|Cannot find module/;
  return nodeTest && loadError.test(output) ? [NODE_TEST_NOTE] : [];
}

function assertClean(wt, id) {
  const status = git(["status", "--porcelain", "--untracked-files=no"], wt);
  if (status.trim() !== "")
    throw new ProbeError(
      `Worktree not clean after reverting mutant ${id}:\n${status}`,
    );
}

function probeOne(m, opts, wt) {
  const result = {
    id: m.id,
    status: "INVALID",
    description: describeMutant(m),
    evidence: [],
    notes: [],
  };
  const applied = applyMutant(m, wt);
  if (applied.reason) {
    result.evidence = [applied.reason];
    return result;
  }
  let run;
  try {
    run = runTests(opts.command, wt, opts.timeout);
  } finally {
    applied.revert();
  }
  assertClean(wt, m.id);
  result.status = classify(run);
  if (result.status === "SURVIVED") return result;
  result.evidence = evidence(run.output);
  if (run.timedOut)
    result.evidence.unshift(`timed out after ${opts.timeout} s`);
  result.notes = notesFor(run.output);
  return result;
}

function copyUntracked(root, wt) {
  const listed = git(["ls-files", "--others", "--exclude-standard", "-z"], root);
  const files = listed.split("\0").filter(Boolean);
  for (const file of files) {
    const dest = path.join(wt, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(path.join(root, file), dest, {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
  return files;
}

function installDependencies(wt) {
  if (!fs.existsSync(path.join(wt, "pnpm-lock.yaml"))) return;
  const args = ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"];
  const r = spawnSync("pnpm", args, {
    cwd: wt,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  if (r.status === 0) return;
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error?.message ?? ""}`;
  throw new ProbeError(
    `pnpm install failed\n${tail(output, 30)}\nHint: the pnpm store must already contain the packages (--offline); run pnpm install once on this machine, or use --no-install with --setup.`,
  );
}

function runSetup(command, wt) {
  const r = spawnSync("sh", ["-c", command], {
    cwd: wt,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  if (r.status === 0) return;
  throw new ProbeError(
    `Setup command failed (exit ${r.status})\n${tail(`${r.stdout}${r.stderr}`, 30)}`,
  );
}

function cleanup(state) {
  if (state.cleaned || !state.parent) return;
  state.cleaned = true;
  if (state.keep && state.wt) {
    console.log(`Worktree kept at ${state.wt}`);
    return;
  }
  tryGit(["worktree", "remove", "--force", state.wt], state.root);
  fs.rmSync(state.parent, { recursive: true, force: true });
  tryGit(["worktree", "prune"], state.root);
}

function resolveRevertBase(root, ref) {
  try {
    return resolveBase(root, ref);
  } catch (error) {
    throw new ProbeError(error.message);
  }
}

function checkRevertPath(file) {
  const rel = path.posix.normalize(file.split(path.sep).join("/"));
  if (path.isAbsolute(file) || rel === "." || rel === ".." || rel.startsWith("../"))
    throw new ProbeError(`--revert-path must be inside the repository: ${file}`);
  return rel;
}

function changedProduction(root, ref, snapshot, untracked) {
  const out = git(["diff", "--name-status", "--no-renames", "-z", ref, snapshot], root);
  const parts = out.split("\0");
  const files = [];
  for (let i = 0; i + 1 < parts.length; i += 2) files.push(parts[i + 1]);
  return [...new Set([...files, ...untracked])].filter(isRevertPath);
}

function readState(target) {
  try {
    return { content: fs.readFileSync(target), mode: fs.statSync(target).mode };
  } catch {
    return null;
  }
}

function writeState(target, state) {
  if (!state) return fs.rmSync(target, { force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, state.content);
  fs.chmodSync(target, state.mode);
}

function existsAt(root, ref, file) {
  return tryGit(["cat-file", "-e", `${ref}:${file}`], root).status === 0;
}

function applyRevert(root, ref, wt, files) {
  const saved = files.map((file) => [file, readState(path.join(wt, file))]);
  const restore = () => {
    for (const [file, state] of saved) writeState(path.join(wt, file), state);
  };
  try {
    for (const file of files) {
      const target = path.join(wt, file);
      if (!existsAt(root, ref, file)) fs.rmSync(target, { force: true });
      else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, gitBuffer(["show", `${ref}:${file}`], root));
      }
    }
  } catch (error) {
    restore();
    throw error;
  }
  return restore;
}

function describeRevert(files, short) {
  const listed = files.slice(0, MAX_DESCRIBED).join(", ");
  const more = files.length > MAX_DESCRIBED ? `, ... and ${files.length - MAX_DESCRIBED} more` : "";
  const noun = files.length === 1 ? "file" : "files";
  return `revert ${files.length} production ${noun} to ${short}: ${listed}${more}`;
}

function probeRevert(opts, wt, ctx) {
  const short = ctx.revertBase.slice(0, 7);
  const result = {
    id: `revert-to-${short}`,
    status: "INVALID",
    description: "",
    evidence: [],
    notes: [],
  };
  if (ctx.files.length === 0) {
    result.description = `revert production files to ${short}`;
    result.evidence = [`no production file differs from ${short}`];
    return result;
  }
  result.description = describeRevert(ctx.files, short);
  const restore = applyRevert(ctx.root, ctx.revertBase, wt, ctx.files);
  let run;
  try {
    run = runTests(opts.command, wt, opts.timeout);
  } finally {
    restore();
  }
  assertClean(wt, result.id);
  result.status = classify(run);
  if (result.status === "SURVIVED") return result;
  result.evidence = evidence(run.output);
  if (run.timedOut) result.evidence.unshift(`timed out after ${opts.timeout} s`);
  result.notes = notesFor(run.output);
  return result;
}

function renderReport(info, results) {
  const lines = [
    "Mutation probe report",
    `  snapshot SHA: ${info.snapshot}`,
    `  HEAD SHA: ${info.head}`,
    `  uncommitted changes included: ${info.dirty ? "yes" : "no"}`,
    `  untracked files copied: ${info.untracked}`,
    ...(info.revertBase ? [`  revert base: ${info.revertBase}`] : []),
    `  test command: ${info.command.join(" ")}`,
    `  baseline: ${info.baseline}`,
    "",
  ];
  for (const r of results) {
    lines.push(`[${r.status}] ${r.id}`, `  ${r.description}`);
    for (const e of r.evidence) lines.push(`    | ${e}`);
    for (const n of r.notes) lines.push(`    note: ${n}`);
    lines.push("");
  }
  lines.push(FOOTER);
  if (info.revertBase) lines.push(REVERT_FOOTER);
  return lines;
}

function execute(opts, state) {
  const mutants = opts.mutants ? loadMutants(opts.mutants) : [];
  const revertPaths = opts.revertPaths.map(checkRevertPath);
  state.root = git(["rev-parse", "--show-toplevel"], process.cwd()).trim();
  const revertBase = opts.revert
    ? resolveRevertBase(state.root, opts.revert)
    : null;
  const stash = git(["stash", "create"], state.root).trim();
  const head = git(["rev-parse", "HEAD"], state.root).trim();
  const snapshot = stash || head;
  state.parent = fs.mkdtempSync(path.join(os.tmpdir(), "mutation-probe-"));
  const wt = path.join(state.parent, "wt");
  git(["worktree", "add", "--detach", "--quiet", wt, snapshot], state.root);
  state.wt = wt;
  const copied = copyUntracked(state.root, wt);
  if (opts.install) installDependencies(wt);
  if (opts.setup) runSetup(opts.setup, wt);
  const base = runTests(opts.command, wt, opts.timeout);
  if (base.status !== 0 || base.timedOut)
    throw new ProbeError(`BASELINE NOT GREEN\n${tail(base.output, 30)}`);
  const results = [];
  if (revertBase) {
    const files =
      revertPaths.length > 0
        ? [...new Set(revertPaths)]
        : changedProduction(state.root, revertBase, snapshot, copied);
    results.push(probeRevert(opts, wt, { root: state.root, revertBase, files }));
  }
  for (const m of mutants) results.push(probeOne(m, opts, wt));
  const info = {
    snapshot,
    head,
    dirty: Boolean(stash),
    untracked: copied.length,
    ...(revertBase ? { revertBase } : {}),
    command: opts.command,
    baseline: "green (exit 0)",
  };
  console.log(renderReport(info, results).join("\n"));
  if (opts.json)
    fs.writeFileSync(opts.json, `${JSON.stringify({ ...info, results }, null, 2)}\n`);
  return results.every((r) => r.status === "KILLED") ? 0 : 1;
}

function main() {
  const state = { keep: false, cleaned: false };
  const onSignal = (code) => () => {
    cleanup(state);
    process.exit(code);
  };
  process.on("SIGINT", onSignal(130));
  process.on("SIGTERM", onSignal(143));
  try {
    const opts = parseArgs(process.argv.slice(2));
    state.keep = opts.keep;
    process.exitCode = execute(opts, state);
  } catch (error) {
    console.error(error.message);
    process.exitCode = error instanceof ProbeError ? error.code : 2;
  } finally {
    cleanup(state);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
