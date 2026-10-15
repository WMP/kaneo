// Helpers shared by the upstream-sync tests.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function makeTempDir(prefix = "upstream-sync-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export function runGit(cwd, args, { allowFail = false } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result;
}

export function writeFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      rmSync(join(root, path), { force: true });
      continue;
    }
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/**
 * Creates a repo with `main` (fork) and `upstream` branches that diverge from
 * a common base commit, then runs `git merge upstream`. Returns the repo dir.
 * `base`, `ours`, `theirs` map paths to content (null deletes the file).
 */
export function createMergeRepo({ base, ours, theirs }) {
  const dir = makeTempDir();
  const run = (...args) => runGit(dir, args);
  run("init", "-q", "-b", "main");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
  run("config", "commit.gpgsign", "false");
  writeFiles(dir, base);
  run("add", "-A");
  run("commit", "-q", "-m", "base");
  run("branch", "upstream");
  writeFiles(dir, ours);
  run("add", "-A");
  run("commit", "-q", "-m", "fork");
  run("checkout", "-q", "upstream");
  writeFiles(dir, theirs);
  run("add", "-A");
  run("commit", "-q", "-m", "upstream");
  run("checkout", "-q", "main");
  runGit(dir, ["merge", "--no-edit", "upstream"], { allowFail: true });
  return dir;
}

export function runNode(script, args, { cwd } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
  });
}

export function gitSync(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}
