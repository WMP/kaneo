// Self-tests for require-tests-hook.mjs and the path rules in change-scope.mjs.
// Every test builds its own temporary git repository; nothing depends on Kaneo
// files, the network or installed packages.
//
// Usage:
//   node --test .claude/skills/reliable-tests/scripts/require-tests-hook.test.mjs
//
// Exit codes: 0 all tests passed; 1 at least one test failed.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isProductionPath, isRevertPath, isTestPath } from "./change-scope.mjs";
import { decide, parseTranscript } from "./require-tests-hook.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const hook = path.join(here, "require-tests-hook.mjs");
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith("GIT_") && key !== "KANEO_REQUIRE_TESTS",
  ),
);
const AGE = "packages/demo/src/age.mjs";
const HOUR = 3600 * 1000;
// Session start of the default transcript entries; files written by a test are newer.
const STARTED = Date.now() - HOUR;

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, env: baseEnv, encoding: "utf8" });

function tempDir(t, prefix) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(repo, file, content) {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), content);
}

function makeRepo(t) {
  const repo = tempDir(t, "require-tests-repo-");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "commit.gpgsign", "false");
  write(repo, AGE, "export const isAdult = (age) => age > 18;\n");
  write(repo, "README.md", "# demo\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  return repo;
}

const changeAge = (repo) =>
  write(repo, AGE, "export const isAdult = (age) => age >= 18;\n");

// Sets the modification time of a file in the repository to `ms` (epoch ms).
function touch(repo, file, ms) {
  utimesSync(path.join(repo, file), ms / 1000, ms / 1000);
}

function transcript(t, entries) {
  const file = path.join(tempDir(t, "require-tests-transcript-"), "t.jsonl");
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n"));
  return file;
}

// `at` is the entry time in epoch ms; null leaves the entry without a timestamp.
const assistantUse = (name, input, at = STARTED + 1000) => ({
  type: "assistant",
  ...(at === null ? {} : { timestamp: new Date(at).toISOString() }),
  message: { content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "1", name, input }] },
});
const userText = (content, at = STARTED) => ({
  type: "user",
  timestamp: new Date(at).toISOString(),
  message: { role: "user", content },
});

function runHook(input, extraEnv = {}) {
  const stdin = typeof input === "string" ? input : JSON.stringify(input);
  const r = spawnSync(process.execPath, [hook], {
    input: stdin,
    env: { ...baseEnv, ...extraEnv },
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function assertAllowed(r) {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "", r.stderr);
}

const FIRST_LINE_NO_USE =
  "Kaneo test check: this session changed production code without the reliable-tests skill or the test-author agent:";
const NOTE = "Tests already on this branch were not checked with the skill";
const later = () => Date.now() + 60 * 1000;
const FIVE_MIN = 5 * 60 * 1000;

test("hook: production change made this session without a use entry blocks", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  const r = runHook({ cwd: repo, transcript_path: transcript(t, [userText("hi")]) });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(r.stdout.trim().split("\n").length, 1);
  assert.deepEqual(Object.keys(out).sort(), ["decision", "reason"]);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /packages\/demo\/src\/age\.mjs/);
  assert.match(out.reason, /test-author/);
  assert.equal(out.reason.split("\n")[0], FIRST_LINE_NO_USE);
  assert.match(out.reason, /the base commit [0-9a-f]{7} and the changed files/);
  assert.ok(!out.reason.includes(NOTE));
});

test("hook: a test file written in the session does not allow, the reason notes it", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  write(repo, "packages/demo/src/age.test.mjs", "// test\n");
  const r = runHook({ cwd: repo, transcript_path: transcript(t, [userText("hi")]) });
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, "block");
  assert.ok(out.reason.includes(FIRST_LINE_NO_USE));
  assert.ok(out.reason.includes(NOTE));
  assert.ok(out.reason.includes(`  ${AGE}`));
  assert.ok(!out.reason.includes("  packages/demo/src/age.test.mjs"));
  const lines = out.reason.split("\n");
  assert.match(lines[lines.findIndex((l) => l.includes(NOTE)) - 1], /^- Preferred:/);
});

test("hook: a test file without a transcript still blocks", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  write(repo, "packages/demo/src/age.test.mjs", "// test\n");
  const out = JSON.parse(runHook({ cwd: repo }).stdout);
  assert.equal(out.decision, "block");
  assert.ok(out.reason.includes(NOTE));
});

test("hook: a Skill use after the production file time allows", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  const file = transcript(t, [
    userText("hi"),
    assistantUse("Skill", { skill: "reliable-tests" }, later()),
  ]);
  assertAllowed(runHook({ cwd: repo, transcript_path: file }));
});

test("hook: a Skill use before the production file time blocks and lists only later files", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  const file = transcript(t, [
    userText("hi"),
    assistantUse("Skill", { skill: "reliable-tests" }, STARTED + 1000),
  ]);
  const out = JSON.parse(runHook({ cwd: repo, transcript_path: file }).stdout);
  assert.equal(out.decision, "block");
  assert.match(out.reason.split("\n")[0], /after the last use of the reliable-tests skill or the test-author agent:$/);
  assert.ok(out.reason.includes(`  ${AGE}`));
});

test("hook: a use less than one second before the file time still allows", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  const at = STARTED + 10 * 60 * 1000;
  touch(repo, AGE, at + 900);
  const file = transcript(t, [userText("hi"), assistantUse("Skill", { skill: "reliable-tests" }, at)]);
  assertAllowed(runHook({ cwd: repo, transcript_path: file }));
  touch(repo, AGE, at + 1100);
  assert.equal(JSON.parse(runHook({ cwd: repo, transcript_path: file }).stdout).decision, "block");
});

test("hook: two production files, only the one changed after the use is listed", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  write(repo, "apps/api/src/new.ts", "export const x = 1;\n");
  const use = STARTED + 10 * FIVE_MIN;
  touch(repo, AGE, use - FIVE_MIN);
  touch(repo, "apps/api/src/new.ts", use + FIVE_MIN);
  const file = transcript(t, [
    userText("hi"),
    assistantUse("Skill", { skill: "reliable-tests" }, use),
  ]);
  const out = JSON.parse(runHook({ cwd: repo, transcript_path: file }).stdout);
  assert.equal(out.decision, "block");
  assert.ok(out.reason.includes("  apps/api/src/new.ts"));
  assert.ok(!out.reason.includes(AGE));
  assert.match(out.reason, /after the last use/);
});

test("hook: the last of several uses decides", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  const use = STARTED + 10 * FIVE_MIN;
  touch(repo, AGE, use + FIVE_MIN);
  const file = transcript(t, [
    userText("hi"),
    assistantUse("Skill", { skill: "reliable-tests" }, use),
    assistantUse("Agent", { subagent_type: "test-author" }, use + 2 * FIVE_MIN),
  ]);
  assertAllowed(runHook({ cwd: repo, transcript_path: file }));
});

test("hook: a test-author Agent use after the production change allows", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  const file = transcript(t, [
    userText("hi"),
    assistantUse("Agent", { subagent_type: "test-author" }, later()),
  ]);
  assertAllowed(runHook({ cwd: repo, transcript_path: file }));
});

test("hook: a Task test-author use before the production change blocks", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  const file = transcript(t, [
    userText("hi"),
    assistantUse("Task", { subagent_type: "test-author" }, STARTED + 1000),
  ]);
  assert.equal(JSON.parse(runHook({ cwd: repo, transcript_path: file }).stdout).decision, "block");
});

test("hook: reading SKILL.md after the production change allows", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  const file = transcript(t, [
    userText("hi"),
    assistantUse("Read", { file_path: "/x/.claude/skills/reliable-tests/SKILL.md" }, later()),
  ]);
  assertAllowed(runHook({ cwd: repo, transcript_path: file }));
});

test("hook: a use entry without a timestamp and none with one allows", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  const file = transcript(t, [
    userText("hi"),
    assistantUse("Skill", { skill: "reliable-tests" }, null),
  ]);
  assertAllowed(runHook({ cwd: repo, transcript_path: file }));
});

test("hook: an earlier use with a timestamp still counts next to one without", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  const file = transcript(t, [
    userText("hi"),
    assistantUse("Skill", { skill: "reliable-tests" }, STARTED + 1000),
    assistantUse("Skill", { skill: "reliable-tests" }, null),
  ]);
  const out = JSON.parse(runHook({ cwd: repo, transcript_path: file }).stdout);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /after the last use/);
});

test("hook: the /reliable-tests command after the production change allows", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  const message = "<command-name>/reliable-tests</command-name>\n<command-args></command-args>";
  const file = transcript(t, [userText("hi"), userText(message, later())]);
  assertAllowed(runHook({ cwd: repo, transcript_path: file }));
});

test("hook: the /reliable-tests command before the production change blocks", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  const message = "<command-name>/reliable-tests</command-name>\n<command-args></command-args>";
  const file = transcript(t, [userText(message)]);
  const out = JSON.parse(runHook({ cwd: repo, transcript_path: file }).stdout);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /after the last use/);
});

test("hook: no transcript_path blocks and lists every production change", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  write(repo, "apps/api/src/new.ts", "export const x = 1;\n");
  touch(repo, AGE, STARTED - 2 * HOUR);
  const out = JSON.parse(runHook({ cwd: repo }).stdout);
  assert.equal(out.decision, "block");
  assert.ok(out.reason.includes(FIRST_LINE_NO_USE));
  assert.ok(out.reason.includes(`  ${AGE}`));
  assert.ok(out.reason.includes("  apps/api/src/new.ts"));
});

test("decide: without a session start a use time keeps only files with a later known time", () => {
  const input = {};
  const changes = [
    { path: AGE, status: "M", mtimeMs: 1000 },
    { path: "apps/api/src/late.ts", status: "A", mtimeMs: 9000 },
    { path: "apps/api/src/unknown.ts", status: "A", mtimeMs: null },
    { path: "apps/api/src/gone.ts", status: "D" },
  ];
  const reason = decide({ input, env: {}, base: "abcdef012345", changes, lastUseMs: 5000 });
  assert.ok(reason.includes("  apps/api/src/late.ts"));
  for (const gone of [AGE, "unknown.ts", "gone.ts"]) assert.ok(!reason.includes(gone), gone);
  assert.equal(decide({ input, env: {}, base: "abcdef012345", changes, lastUseMs: 9000 }), null);
  assert.equal(decide({ input, env: {}, base: "abcdef012345", changes, useWithoutTime: true }), null);
  assert.match(decide({ input, env: {}, base: "abcdef012345", changes }), /without the reliable-tests skill/);
});

test("parseTranscript: start, last use and a use without time", () => {
  const lines = (entries) => entries.map((e) => JSON.stringify(e)).join("\n");
  const use = (at) => assistantUse("Skill", { skill: "reliable-tests" }, at);
  assert.deepEqual(parseTranscript(""), { sessionStartMs: null, lastUseMs: null, useWithoutTime: false });
  assert.deepEqual(parseTranscript(lines([userText("hi", 1000), use(3000), use(2000), use(null)])), {
    sessionStartMs: 1000,
    lastUseMs: 3000,
    useWithoutTime: true,
  });
});

test("hook: the skill name in an ordinary user message still blocks", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  const file = transcript(t, [
    userText("Available skills: reliable-tests, verify, tool_use"),
  ]);
  const r = runHook({ cwd: repo, transcript_path: file });
  assert.equal(JSON.parse(r.stdout).decision, "block");
});

test("hook: documentation-only change allows", (t) => {
  const repo = makeRepo(t);
  write(repo, "README.md", "# changed\n");
  assertAllowed(runHook({ cwd: repo }));
});

test("hook: a committed change on a feature branch blocks", (t) => {
  const repo = makeRepo(t);
  git(repo, "checkout", "-q", "-b", "feature");
  changeAge(repo);
  git(repo, "commit", "-q", "-am", "feature change");
  const r = runHook({ cwd: repo, transcript_path: transcript(t, [userText("hi")]) });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /packages\/demo\/src\/age\.mjs/);
  assert.ok(out.reason.includes(git(repo, "rev-parse", "main").slice(0, 7)));
});

test("hook: a new untracked production file blocks", (t) => {
  const repo = makeRepo(t);
  write(repo, "apps/api/src/new.ts", "export const x = 1;\n");
  const r = runHook({ cwd: repo, transcript_path: transcript(t, [userText("hi")]) });
  assert.equal(JSON.parse(r.stdout).decision, "block");
  assert.match(JSON.parse(r.stdout).reason, /apps\/api\/src\/new\.ts/);
});

test("hook: stop_hook_active allows", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  assertAllowed(runHook({ cwd: repo, stop_hook_active: true }));
});

test("hook: KANEO_REQUIRE_TESTS=off allows", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  assertAllowed(runHook({ cwd: repo }, { KANEO_REQUIRE_TESTS: "off" }));
});

test("hook: the test-author agent itself is allowed", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  assertAllowed(runHook({ cwd: repo, agent_type: "test-author" }));
});

test("hook: a directory that is not a git repository allows", (t) => {
  const plain = tempDir(t, "require-tests-plain-");
  assertAllowed(runHook({ cwd: plain }));
});

test("hook: stdin that is not JSON allows", () => {
  assertAllowed(runHook("this is not json"));
});

test("hook: an unreadable transcript allows", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  const missing = path.join(tempDir(t, "require-tests-missing-"), "none.jsonl");
  assertAllowed(runHook({ cwd: repo, transcript_path: missing }));
});

test("hook: generated route tree and .d.ts only allows", (t) => {
  const repo = makeRepo(t);
  write(repo, "apps/web/src/routeTree.gen.ts", "export {};\n");
  write(repo, "apps/web/src/vite-env.d.ts", "/// <reference types=\"vite/client\" />\n");
  assertAllowed(runHook({ cwd: repo }));
});

test("hook: a deleted test plus a production change blocks", (t) => {
  const repo = makeRepo(t);
  write(repo, "packages/demo/src/old.test.mjs", "// old\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "add old test");
  rmSync(path.join(repo, "packages/demo/src/old.test.mjs"));
  changeAge(repo);
  const r = runHook({ cwd: repo, transcript_path: transcript(t, [userText("hi")]) });
  assert.equal(JSON.parse(r.stdout).decision, "block");
});

test("hook: lists at most 8 paths", (t) => {
  const repo = makeRepo(t);
  for (let i = 0; i < 10; i += 1) write(repo, `apps/api/src/f${i}.ts`, "export {};\n");
  const file = transcript(t, [userText("hi")]);
  const out = JSON.parse(runHook({ cwd: repo, transcript_path: file }).stdout);
  assert.match(out.reason, /\.\.\. and 2 more/);
});

test("hook: a production file newer than the session start blocks and is listed", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  touch(repo, AGE, STARTED + 10 * 60 * 1000);
  const r = runHook({ cwd: repo, transcript_path: transcript(t, [userText("hi")]) });
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, "block");
  assert.ok(out.reason.includes(`  ${AGE}`));
});

test("hook: a production change from an earlier session allows", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  touch(repo, AGE, STARTED - 2 * HOUR);
  assertAllowed(runHook({ cwd: repo, transcript_path: transcript(t, [userText("hi")]) }));
});

test("hook: only the file changed after the session start is listed", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  touch(repo, AGE, STARTED - 2 * HOUR);
  write(repo, "apps/api/src/new.ts", "export const x = 1;\n");
  const r = runHook({ cwd: repo, transcript_path: transcript(t, [userText("hi")]) });
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, "block");
  assert.ok(out.reason.includes("  apps/api/src/new.ts"));
  assert.ok(!out.reason.includes(AGE));
});

test("hook: a file time one second before the start still counts, two seconds does not", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  const file = transcript(t, [userText("hi")]);
  touch(repo, AGE, STARTED - 900);
  assert.equal(JSON.parse(runHook({ cwd: repo, transcript_path: file }).stdout).decision, "block");
  touch(repo, AGE, STARTED - 2000);
  assertAllowed(runHook({ cwd: repo, transcript_path: file }));
});

test("hook: a transcript without any timestamp counts every production change", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  touch(repo, AGE, STARTED - 2 * HOUR);
  const file = transcript(t, [{ type: "user", message: { role: "user", content: "hi" } }]);
  const r = runHook({ cwd: repo, transcript_path: file });
  assert.equal(JSON.parse(r.stdout).decision, "block");
});

test("hook: no transcript_path counts every production change", (t) => {
  const repo = makeRepo(t);
  changeAge(repo);
  touch(repo, AGE, STARTED - 2 * HOUR);
  assert.equal(JSON.parse(runHook({ cwd: repo }).stdout).decision, "block");
});

test("hook: only a deleted production file allows when the session start is known", (t) => {
  const repo = makeRepo(t);
  rmSync(path.join(repo, AGE));
  assertAllowed(runHook({ cwd: repo, transcript_path: transcript(t, [userText("hi")]) }));
});

test("hook: a deleted production file blocks without a known session start", (t) => {
  const repo = makeRepo(t);
  rmSync(path.join(repo, AGE));
  assert.equal(JSON.parse(runHook({ cwd: repo }).stdout).decision, "block");
});

test("hook: a committed change edited after the session start blocks without the file in the transcript", (t) => {
  const repo = makeRepo(t);
  git(repo, "checkout", "-q", "-b", "feature");
  changeAge(repo);
  git(repo, "commit", "-q", "-am", "feature change");
  touch(repo, AGE, STARTED + 5 * 60 * 1000);
  const file = transcript(t, [userText("review"), assistantUse("Agent", { subagent_type: "general-purpose" })]);
  const out = JSON.parse(runHook({ cwd: repo, transcript_path: file }).stdout);
  assert.equal(out.decision, "block");
  assert.ok(out.reason.includes(`  ${AGE}`));
});

test("hook: a committed change from before the session start allows", (t) => {
  const repo = makeRepo(t);
  git(repo, "checkout", "-q", "-b", "feature");
  changeAge(repo);
  git(repo, "commit", "-q", "-am", "feature change");
  touch(repo, AGE, STARTED - 3 * HOUR);
  assertAllowed(runHook({ cwd: repo, transcript_path: transcript(t, [userText("review")]) }));
});

const pathTable = [
  ["apps/api/src/task/index.ts", true, false],
  ["apps/web/src/components/x.tsx", true, false],
  ["apps/web/src/components/x.test.tsx", false, true],
  ["packages/permissions/src/index.ts", true, false],
  ["apps/api/drizzle/0040_x.sql", true, false],
  ["apps/api/drizzle/meta/_journal.json", false, false],
  ["tests/api/x.test.ts", false, true],
  ["tests/api-integration/helpers/fixtures.ts", false, false],
  ["docs/agent-guide/README.md", false, false],
  ["i18n/en-US.json", false, false],
  ["apps/site/app/page.tsx", false, false],
  ["scripts/ci/x.mjs", false, false],
];

test("path rules: isProductionPath and isTestPath", () => {
  for (const [file, production, testFile] of pathTable) {
    assert.equal(isProductionPath(file), production, `production: ${file}`);
    assert.equal(isTestPath(file), testFile, `test: ${file}`);
  }
});

const revertTable = [
  ["apps/web/src/routeTree.gen.ts", true],
  ["apps/api/drizzle/meta/_journal.json", true],
  ["apps/web/src/vite-env.d.ts", true],
  ["packages/demo/src/types.d.ts", true],
  ["apps/api/src/task/index.ts", true],
  ["apps/api/drizzle/0040_x.sql", true],
  ["tests/api/x.test.ts", false],
  ["apps/web/src/components/x.test.tsx", false],
  ["docs/x.md", false],
  ["apps/site/app/page.tsx", false],
];

test("path rules: isRevertPath adds derived files, isProductionPath does not", () => {
  for (const [file, revert] of revertTable)
    assert.equal(isRevertPath(file), revert, `revert: ${file}`);
  assert.equal(isProductionPath("apps/web/src/routeTree.gen.ts"), false);
  assert.equal(isProductionPath("apps/api/drizzle/meta/_journal.json"), false);
});
