// Change scope: shared, read-only helpers that classify repository paths as test
// or production code and list the changes since a base commit. Imported by
// mutation-probe.mjs and by the Stop hook require-tests-hook.mjs (same
// directory). Never changes files.
//
// Usage (import only):
//   import { isTestPath, isProductionPath, isRevertPath, resolveBase, listChanges } from "./change-scope.mjs";
//
// Exit codes: not a command; the functions throw an Error when git fails or a
// given ref is unknown.
import { execFileSync } from "node:child_process";
import path from "node:path";

const MAX_BUFFER = 512 * 1024 * 1024;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SOURCE_FILE =
  /^(apps\/(api|web)\/src|packages\/[^/]+\/src)\/.+\.(ts|tsx|js|jsx|mjs|cjs)$/;
const DECLARATION_FILE =
  /^(apps\/(api|web)\/src|packages\/[^/]+\/src)\/.+\.d\.ts$/;
const MIGRATION_META = /^apps\/api\/drizzle\/meta\/.+/;
const MIGRATION_FILE = /^apps\/api\/drizzle\/[^/]+\.sql$/;

export const isTestPath = (p) =>
  TEST_FILE.test(p) || p.includes("__snapshots__/") || p.endsWith(".snap");

function isSourcePath(p) {
  return (
    SOURCE_FILE.test(p) &&
    !p.endsWith(".d.ts") &&
    path.posix.basename(p) !== "routeTree.gen.ts"
  );
}

export const isProductionPath = (p) =>
  !isTestPath(p) && (isSourcePath(p) || MIGRATION_FILE.test(p));

// Production paths plus the files derived from production code (generated route
// tree, declarations, migration metadata). A revert restores all of them so they
// stay consistent; the hook counts only isProductionPath.
export const isRevertPath = (p) =>
  !isTestPath(p) &&
  (isProductionPath(p) ||
    p === "apps/web/src/routeTree.gen.ts" ||
    DECLARATION_FILE.test(p) ||
    MIGRATION_META.test(p));

function tryGit(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

function git(args, cwd) {
  const out = tryGit(args, cwd);
  if (out === null) throw new Error(`git ${args.join(" ")} failed`);
  return out;
}

export function resolveBase(root, ref) {
  if (ref) {
    const args = ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`];
    const sha = tryGit(args, root);
    if (!sha?.trim()) throw new Error(`Unknown base ref: ${ref}`);
    return sha.trim();
  }
  for (const name of ["origin/main", "main"]) {
    const sha = tryGit(["merge-base", "HEAD", name], root);
    if (sha?.trim()) return sha.trim();
  }
  return git(["rev-parse", "HEAD"], root).trim();
}

export function listChanges(root, base) {
  const diff = git(["diff", "--name-status", "--no-renames", "-z", base], root);
  const parts = diff.split("\0");
  const changes = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const letter = parts[i];
    const status = letter === "A" || letter === "D" ? letter : "M";
    changes.push({ path: parts[i + 1], status });
  }
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"], root);
  const known = new Set(changes.map((c) => c.path));
  for (const file of untracked.split("\0").filter(Boolean))
    if (!known.has(file)) changes.push({ path: file, status: "A" });
  return changes;
}
