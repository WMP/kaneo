import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const auditScript = path.join(here, "test-change-audit.mjs");
const probeScript = path.join(here, "mutation-probe.mjs");
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, env, encoding: "utf8" });

function tempDir(t, prefix) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(repo, file, content) {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), content);
}

function makeRepo(t, files) {
  const repo = tempDir(t, "reliable-tests-repo-");
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "commit.gpgsign", "false");
  for (const [file, content] of Object.entries(files)) write(repo, file, content);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  return repo;
}

function runScript(script, args, cwd) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env,
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
}

// ---- audit ----------------------------------------------------------------

const specFile = `import { expect, it } from "vitest";

it("a", () => {
  expect(1).toBe(1);
});

it("b", () => {
  expect(2).toBe(2);
});
`;
const invariants = `| ID | Behavior | Status |
| --- | --- | --- |
| KAN-API-001 | Thing | partial |
| KAN-WEB-002 | Other | enforced |
`;
const auditBase = {
  "src/util.ts": "export const one = 1;\n",
  "src/util.test.ts": specFile,
  "vitest.config.ts": "export default { test: {} };\n",
  "docs/agent-guide/invariants.md": invariants,
};
const audit = (repo, ...args) => runScript(auditScript, args, repo);
const signalHeader = /^== [a-z-]+ ==$/m;

test("audit: unrelated change gives no signals", (t) => {
  const repo = makeRepo(t, auditBase);
  write(repo, "src/util.ts", "export const one = 2;\n");
  const r = audit(repo);
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, signalHeader);
  assert.match(r.out, /Total: 0 signal/);
});

test("audit: added it.skip is a focus-skip signal", (t) => {
  const repo = makeRepo(t, auditBase);
  write(repo, "src/util.test.ts", `${specFile}\nit.skip("c", () => {});\n`);
  const r = audit(repo);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /== focus-skip ==/);
  assert.match(r.out, /src\/util\.test\.ts/);
});

test("audit: removing an it block gives fewer-tests and fewer-assertions", (t) => {
  const repo = makeRepo(t, auditBase);
  const [first] = specFile.split('\nit("b"');
  write(repo, "src/util.test.ts", `${first}\n`);
  const r = audit(repo);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /== fewer-tests ==[\s\S]*test calls: 2 -> 1/);
  assert.match(r.out, /== fewer-assertions ==[\s\S]*expect calls: 2 -> 1/);
});

test("audit: untracked new test file counts", (t) => {
  const repo = makeRepo(t, auditBase);
  write(repo, "src/new.test.ts", 'it.only("x", () => {});\n');
  const r = audit(repo);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /== focus-skip ==\n {2}src\/new\.test\.ts/);
  assert.match(r.out, /new-test-files[\s\S]*src\/new\.test\.ts/);
});

test("audit: vitest config change is runner-config", (t) => {
  const repo = makeRepo(t, auditBase);
  write(repo, "vitest.config.ts", "export default { test: { testTimeout: 1 } };\n");
  const r = audit(repo);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /== runner-config ==\n {2}vitest\.config\.ts/);
  assert.match(r.out, /== timeouts-retries ==/);
});

test("audit: invariant status change is reported with its ID", (t) => {
  const repo = makeRepo(t, auditBase);
  write(
    repo,
    "docs/agent-guide/invariants.md",
    invariants.replace("| partial |", "| enforced |"),
  );
  const r = audit(repo);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /== contract ==/);
  assert.match(r.out, /KAN-API-001: partial -> enforced/);
  assert.doesNotMatch(r.out, /KAN-WEB-002/);
});

test("audit: unknown base and non-repository exit 2", (t) => {
  const repo = makeRepo(t, auditBase);
  assert.equal(audit(repo, "--base", "no-such-ref").status, 2);
  assert.equal(audit(tempDir(t, "reliable-tests-plain-")).status, 2);
});

// ---- probe ----------------------------------------------------------------

const addSource = "// adds two numbers\nexport function add(a, b) {\n  return a + b;\n}\n";
const fakeRunner = `const loaded = await import("./src/add.mjs").catch((error) => {
  console.error(\`Error: \${error.message}\`);
  process.exit(1);
});
const ok = loaded.add(2, 3) === 5;
if (!ok) console.log("FAIL  add > adds two numbers");
console.log(ok ? " Tests  1 passed (1)" : " Tests  1 failed | 0 passed (1)");
process.exit(ok ? 0 : 1);
`;
const untrackedRunner = `import { readFileSync } from "node:fs";
const ok = readFileSync(new URL("./notes.txt", import.meta.url), "utf8") === "hello\\n";
console.log(ok ? " Tests  1 passed (1)" : " Tests  1 failed | 0 passed (1)");
process.exit(ok ? 0 : 1);
`;
const probeBase = {
  "src/add.mjs": addSource,
  "run-tests.mjs": fakeRunner,
  "read-untracked.mjs": untrackedRunner,
};

function probe(t, repo, mutants, command = ["node", "run-tests.mjs"], extra = []) {
  const dir = tempDir(t, "reliable-tests-out-");
  const mutantsFile = path.join(dir, "mutants.json");
  const jsonFile = path.join(dir, "out.json");
  writeFileSync(mutantsFile, JSON.stringify({ mutants }));
  const args = ["--mutants", mutantsFile, "--no-install", "--json", jsonFile, ...extra];
  const r = runScript(probeScript, [...args, "--", ...command], repo);
  let results = {};
  try {
    const data = JSON.parse(readFileSync(jsonFile, "utf8"));
    results = Object.fromEntries(data.results.map((m) => [m.id, m]));
  } catch {}
  return { ...r, results, dir };
}

const edit = (id, search, replace) => ({ id, file: "src/add.mjs", search, replace });

test("probe: classifies killed, survived, invalid and error mutants", (t) => {
  const repo = makeRepo(t, probeBase);
  const r = probe(t, repo, [
    edit("killed", "a + b", "a - b"),
    edit("survived", "adds two numbers", "sums two numbers"),
    edit("invalid", "does not exist", "x"),
    edit("error", "return a + b;", "return a + ;"),
  ]);
  assert.equal(r.status, 1, r.out);
  assert.equal(r.results.killed.status, "KILLED");
  assert.match(r.results.killed.evidence.join("\n"), /FAIL/);
  assert.equal(r.results.survived.status, "SURVIVED");
  assert.equal(r.results.invalid.status, "INVALID");
  assert.match(r.results.invalid.evidence[0], /found 0 times/);
  assert.equal(r.results.error.status, "ERROR");
  assert.match(r.out, /Inspect every KILLED result/);
});

test("probe: all killed exits 0 and patch mutants work", (t) => {
  const repo = makeRepo(t, probeBase);
  write(repo, "src/add.mjs", addSource.replace("a + b", "a - b"));
  const patch = path.join(tempDir(t, "reliable-tests-patch-"), "m.patch");
  writeFileSync(patch, git(repo, "diff"));
  git(repo, "checkout", "-q", "--", "src/add.mjs");
  const r = probe(t, repo, [
    { id: "from-patch", patch },
    { id: "bad-patch", patch: path.join(path.dirname(patch), "missing.patch") },
  ]);
  assert.equal(r.results["from-patch"].status, "KILLED", r.out);
  assert.equal(r.results["bad-patch"].status, "INVALID");
  const only = probe(t, repo, [{ id: "from-patch", patch }]);
  assert.equal(only.status, 0, only.out);
});

test("probe: caller's working tree stays unchanged and sees untracked files", (t) => {
  const repo = makeRepo(t, probeBase);
  write(repo, "src/add.mjs", addSource.replace("adds two", "adds any two"));
  write(repo, "notes.txt", "hello\n");
  const snapshot = () => ({
    status: git(repo, "status", "--porcelain"),
    stashes: git(repo, "stash", "list"),
    add: readFileSync(path.join(repo, "src/add.mjs"), "utf8"),
    notes: readFileSync(path.join(repo, "notes.txt"), "utf8"),
  });
  const before = snapshot();
  const r = probe(
    t,
    repo,
    [edit("uncommitted-visible", "adds any two", "adds some two")],
    ["node", "read-untracked.mjs"],
  );
  assert.equal(r.results["uncommitted-visible"].status, "SURVIVED", r.out);
  assert.match(r.out, /uncommitted changes included: yes/);
  assert.match(r.out, /untracked files copied: 1/);
  assert.deepEqual(snapshot(), before);
});

test("probe: red baseline exits 2", (t) => {
  const repo = makeRepo(t, {
    ...probeBase,
    "src/add.mjs": addSource.replace("a + b", "a - b"),
  });
  const r = probe(t, repo, [edit("any", "a - b", "a * b")]);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /BASELINE NOT GREEN/);
});

test("probe: no worktree is left behind", (t) => {
  const repo = makeRepo(t, probeBase);
  probe(t, repo, [edit("killed", "a + b", "a - b")]);
  const listed = git(repo, "worktree", "list").trim().split("\n");
  assert.equal(listed.length, 1, listed.join("\n"));
});

test("probe: rejects escaping paths and bad usage", (t) => {
  const repo = makeRepo(t, probeBase);
  const r = probe(t, repo, [
    { id: "up", file: "../outside.txt", search: "a", replace: "b" },
    { id: "abs", file: path.join(repo, "src/add.mjs"), search: "a", replace: "b" },
  ]);
  assert.equal(r.results.up.status, "INVALID", r.out);
  assert.equal(r.results.abs.status, "INVALID");
  assert.equal(runScript(probeScript, [], repo).status, 2);
});
