import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { makeTempDir, removeDir, runGit } from "./test-utils.mjs";

const SCRIPT = new URL("./setup-git.sh", import.meta.url).pathname;

test("setup-git.sh sets the config, adds the remote and is idempotent", () => {
  const dir = makeTempDir();
  try {
    runGit(dir, ["init", "-q"]);
    const first = spawnSync("bash", [SCRIPT], { cwd: dir, encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /changed:\s+rerere\.enabled = true/);
    assert.match(first.stdout, /added remote upstream/);
    const config = (key) =>
      runGit(dir, ["config", "--local", "--get", key]).stdout.trim();
    assert.equal(config("rerere.enabled"), "true");
    assert.equal(config("rerere.autoupdate"), "true");
    assert.equal(config("merge.renameLimit"), "20000");
    assert.equal(
      config("remote.upstream.url"),
      "https://github.com/usekaneo/kaneo",
    );

    const second = spawnSync("bash", [SCRIPT], { cwd: dir, encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr);
    assert.doesNotMatch(second.stdout, /^changed:/m);
  } finally {
    removeDir(dir);
  }
});

test("setup-git.sh keeps an existing upstream remote", () => {
  const dir = makeTempDir();
  try {
    runGit(dir, ["init", "-q"]);
    runGit(dir, ["remote", "add", "upstream", "https://example.com/other"]);
    const result = spawnSync("bash", [SCRIPT], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      runGit(dir, ["remote", "get-url", "upstream"]).stdout.trim(),
      "https://example.com/other",
    );
  } finally {
    removeDir(dir);
  }
});
