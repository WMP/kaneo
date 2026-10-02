// Require-tests hook: a Claude Code Stop hook that asks the main agent to have
// the tests for its production changes written or reviewed with the
// reliable-tests skill (preferably by the test-author agent) before it finishes
// a turn. A test file the implementing agent wrote alone does not satisfy it.
// Never changes files.
//
// Usage (registered in .claude/settings.json as a Stop hook; JSON on stdin with
// `cwd`, `transcript_path`, `stop_hook_active` and optionally `agent_type`):
//   node .claude/skills/reliable-tests/scripts/require-tests-hook.mjs
//
// Blocks by printing {"decision":"block","reason":"..."} to stdout. Allows by
// printing nothing. Allowed without a reminder: KANEO_REQUIRE_TESTS=off, a
// second stop in the same turn (stop_hook_active), the test-author agent, no
// production change made during this session, or a use of the skill or the
// test-author agent after the last production change. Changes are the
// merge-base with origin/main (else main, else HEAD) versus the working tree,
// plus untracked files. The transcript is read once. It gives the session start
// (the `timestamp` of the first line that has one) and the use entries: the
// Skill tool for reliable-tests, the Agent/Task tool with subagent_type
// test-author, a Read of the skill's SKILL.md, and the /reliable-tests command
// in a user message. The last use is the largest valid timestamp of a use entry.
// Candidate files are the production changes of the branch. With a known
// session start only added or modified files count, and only when their
// modification time is not older than the session start minus one second (a
// deleted file cannot be dated). Without a known session start (no
// transcript_path, an empty transcript or no timestamp) every production change
// counts. When a last use is known, only candidates whose modification time is
// more than one second after it remain (a candidate without a known time is
// dropped). A use entry without a valid timestamp allows when no use entry has
// one. Edits by subagents and Bash commands are not in the transcript, so the
// file time is the evidence. No candidate allows; otherwise the hook blocks.
// Test files never allow; an added or changed test file only adds a note to the
// reason that it was not checked with the skill.
//
// Exit codes: always 0. Any error allows the stop (fail open) and writes one
// line to stderr.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  isProductionPath,
  isTestPath,
  listChanges,
  resolveBase,
} from "./change-scope.mjs";

const MAX_LISTED = 8;
const SKILL_FILE = ".claude/skills/reliable-tests/SKILL.md";
const COMMAND_TAG = "<command-name>/reliable-tests</command-name>";
const START_TOLERANCE_MS = 1000;

export function productionChanges(changes) {
  return changes.filter((c) => isProductionPath(c.path));
}

export function sessionProduction(production, sessionStartMs) {
  if (sessionStartMs === null || sessionStartMs === undefined) return production;
  return production.filter(
    (c) =>
      c.status !== "D" &&
      typeof c.mtimeMs === "number" &&
      c.mtimeMs >= sessionStartMs - START_TOLERANCE_MS,
  );
}

function isSkillUse(item) {
  const skill = item.input?.skill;
  return (
    item.name === "Skill" &&
    typeof skill === "string" &&
    (skill === "reliable-tests" || skill.endsWith(":reliable-tests"))
  );
}

function isToolUse(item) {
  if (item?.type !== "tool_use") return false;
  if (isSkillUse(item)) return true;
  if (["Agent", "Task"].includes(item.name))
    return item.input?.subagent_type === "test-author";
  const file = item.input?.file_path;
  return item.name === "Read" && typeof file === "string" && file.endsWith(SKILL_FILE);
}

function isCommandUse(message) {
  const content = message?.content;
  if (typeof content === "string") return content.includes(COMMAND_TAG);
  if (!Array.isArray(content)) return false;
  return content.some(
    (item) => typeof item?.text === "string" && item.text.includes(COMMAND_TAG),
  );
}

function lineShowsUse(entry) {
  if (entry?.type === "assistant")
    return (
      Array.isArray(entry.message?.content) &&
      entry.message.content.some(isToolUse)
    );
  return entry?.type === "user" && isCommandUse(entry.message);
}

function entryTimeMs(entry) {
  const ms =
    typeof entry?.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
}

// One pass over the transcript: session start, time of the last use of the
// skill or the test-author agent, and whether a use entry has no valid time.
export function parseTranscript(text) {
  let sessionStartMs = null;
  let lastUseMs = null;
  let useWithoutTime = false;
  for (const line of text.split("\n")) {
    const mayTime = line.includes('"timestamp"');
    const mayUse = line.includes('"tool_use"') || line.includes("command-name");
    if (!mayTime && !mayUse) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const ms = entryTimeMs(entry);
    if (sessionStartMs === null && ms !== null) sessionStartMs = ms;
    if (!mayUse || !lineShowsUse(entry)) continue;
    if (ms === null) useWithoutTime = true;
    else if (lastUseMs === null || ms > lastUseMs) lastUseMs = ms;
  }
  return { sessionStartMs, lastUseMs, useWithoutTime };
}

export function afterLastUse(production, lastUseMs) {
  if (lastUseMs === null || lastUseMs === undefined) return production;
  return production.filter(
    (c) => typeof c.mtimeMs === "number" && c.mtimeMs > lastUseMs + START_TOLERANCE_MS,
  );
}

export function skipsCheck(input, env) {
  return (
    env.KANEO_REQUIRE_TESTS === "off" ||
    input?.stop_hook_active === true ||
    input?.agent_type === "test-author"
  );
}

function buildReason(base, candidates, changes, hadUse) {
  const short = base.slice(0, 7);
  const listed = candidates.slice(0, MAX_LISTED).map((c) => `  ${c.path}`);
  if (candidates.length > MAX_LISTED)
    listed.push(`  ... and ${candidates.length - MAX_LISTED} more`);
  const hasTest = changes.some(
    (c) => isTestPath(c.path) && (c.status === "A" || c.status === "M"),
  );
  const first = hadUse
    ? "Kaneo test check: this session changed production code after the last use of the reliable-tests skill or the test-author agent:"
    : "Kaneo test check: this session changed production code without the reliable-tests skill or the test-author agent:";
  return [
    first,
    ...listed,
    "Before you finish, have the tests for this change written or reviewed with the reliable-tests skill (.claude/skills/reliable-tests/SKILL.md):",
    `- Preferred: delegate to the test-author agent (Agent tool, subagent_type "test-author"). Give it the requirement in the user's words, the base commit ${short} and the changed files. It writes or completes the tests in a fresh context and checks that they fail on the old code.`,
    ...(hasTest
      ? [
          "  Tests already on this branch were not checked with the skill; the test-author agent also reviews them.",
        ]
      : []),
    "- Or load the skill and follow it yourself.",
    "- If this change needs no new test (for example a refactor that existing tests cover), load the skill and give the reason in your final message.",
    "This reminder appears once per turn.",
  ].join("\n");
}

export function decide({
  input,
  env,
  base,
  changes,
  sessionStartMs = null,
  lastUseMs = null,
  useWithoutTime = false,
}) {
  if (skipsCheck(input, env)) return null;
  const production = productionChanges(changes);
  if (production.length === 0) return null;
  if (useWithoutTime && lastUseMs === null) return null;
  const candidates = afterLastUse(
    sessionProduction(production, sessionStartMs),
    lastUseMs,
  );
  if (candidates.length === 0) return null;
  return buildReason(base, candidates, changes, lastUseMs !== null);
}

function gitRoot(cwd) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function readTranscript(file) {
  if (typeof file !== "string" || file === "") return "";
  return fs.readFileSync(path.resolve(file), "utf8");
}

function withFileTimes(root, changes) {
  return changes.map((c) => {
    if (c.status === "D" || !isProductionPath(c.path)) return c;
    try {
      return { ...c, mtimeMs: fs.statSync(path.join(root, c.path)).mtimeMs };
    } catch {
      return { ...c, mtimeMs: null };
    }
  });
}

function evaluate(input, env) {
  if (skipsCheck(input, env)) return null;
  const root = gitRoot(input.cwd || process.cwd());
  const base = resolveBase(root);
  const changes = listChanges(root, base);
  if (productionChanges(changes).length === 0) return null;
  const summary = parseTranscript(readTranscript(input.transcript_path));
  const dated = withFileTimes(root, changes);
  return decide({ input, env, base, changes: dated, ...summary });
}

export function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    const reason = evaluate(input ?? {}, process.env);
    if (reason) process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
  } catch (error) {
    console.error(`require-tests-hook: ${error.message.split("\n")[0]}`);
  }
  process.exitCode = 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
