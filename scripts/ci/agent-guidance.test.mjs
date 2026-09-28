import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const guideDirectory = "docs/agent-guide";
const guideFiles = readdirSync(path.join(root, guideDirectory))
  .filter((filename) => filename.endsWith(".md"))
  .map((filename) => `${guideDirectory}/${filename}`);
const instructionFiles = [
  "AGENTS.md",
  "CLAUDE.md",
  ...readdirSync(path.join(root, ".cursor/rules"))
    .filter((filename) => filename.endsWith(".mdc"))
    .map((filename) => `.cursor/rules/${filename}`),
  ...guideFiles,
];

test("agent guide stays small and points to existing local Markdown files", () => {
  assert.ok(statSync(path.join(root, "AGENTS.md")).size < 12 * 1024);
  assert.ok(statSync(path.join(root, "CLAUDE.md")).size < 4 * 1024);
  assert.match(read("CLAUDE.md"), /^@AGENTS\.md$/m);

  for (const filename of instructionFiles) {
    const source = read(filename);
    const maxBytes = filename.startsWith(guideDirectory) ? 16 * 1024 : 4 * 1024;
    if (filename !== "AGENTS.md") {
      assert.ok(
        statSync(path.join(root, filename)).size < maxBytes,
        `${filename} has grown beyond its instruction size ceiling`,
      );
    }
    for (const [, target] of source.matchAll(
      /\[[^\]]+\]\(([^)]+\.md)(?:#[^)]*)?\)/g,
    )) {
      const resolved = path.resolve(root, path.dirname(filename), target);
      assert.ok(
        resolved.startsWith(`${root}${path.sep}`),
        `${filename} links outside the repository: ${target}`,
      );
      assert.ok(
        existsSync(resolved) && statSync(resolved).isFile(),
        `${filename} has a missing link: ${target}`,
      );
    }

    // A code-formatted repository path is also a claim about the tree. Command
    // examples, globs, untracked local environment files and placeholder paths
    // are deliberately excluded.
    for (const [, target] of source.matchAll(/`([^`]+)`/g)) {
      if (
        !/^(?:(?:apps|packages|tests|scripts|charts|docs|i18n|\.github|\.devcontainer)\/|(?:AGENTS|CLAUDE|CONTRIBUTING|ENVIRONMENT_SETUP)\.md$|package\.json$|Dockerfile\.kaneo$|\.env\.sample$)/.test(
          target,
        )
      ) {
        continue;
      }
      if (target.includes("*") || target.includes("<")) continue;
      if (
        target.split("/").some((part) => part.startsWith(".")) &&
        !target.startsWith(".github/") &&
        !target.startsWith(".devcontainer/") &&
        target !== ".env.sample"
      ) {
        continue;
      }
      const resolved = path.resolve(root, target);
      assert.ok(
        resolved.startsWith(`${root}${path.sep}`) && existsSync(resolved),
        `${filename} refers to missing ${target}`,
      );
    }
  }
});

test("every task contract is reachable and always-loaded files contain no issue history", () => {
  const index = read(`${guideDirectory}/README.md`);
  const entry = read("AGENTS.md");
  for (const filename of guideFiles) {
    const basename = path.basename(filename);
    assert.ok(entry.includes(`(${filename})`), `AGENTS.md does not route to ${filename}`);
    if (basename !== "README.md") {
      assert.equal(
        index.split(`(${basename})`).length - 1,
        1,
        `${filename} should have one index entry`,
      );
    }
  }
  for (const filename of instructionFiles.filter(
    (file) => file === "AGENTS.md" || file === "CLAUDE.md" || file.startsWith(".cursor/"),
  )) {
    assert.doesNotMatch(read(filename), /(?:^|[^\w/])#\d{3,}\b/m);
  }
  assert.ok(
    read(".github/workflows/ci.yml").includes("scripts/ci/*.test.mjs"),
    "the instruction guard must run in CI",
  );
});

test("invariant index has unique stable IDs and honest statuses", () => {
  const rows = read(`${guideDirectory}/invariants.md`)
    .split("\n")
    .filter((line) => /^\| KAN-[A-Z]+-\d{3} \|/.test(line));
  assert.ok(rows.length >= 3, "expected a useful invariant index");
  const ids = rows.map((line) => line.match(/^\| (KAN-[A-Z]+-\d{3}) \|/)[1]);
  assert.equal(
    new Set(ids).size,
    ids.length,
    "each invariant ID must occur once",
  );
  for (const row of rows) {
    assert.match(row, /\| (?:enforced|partial|unenforced) \|/);
    assert.match(row, /\]\([a-z-]+\.md\)/);
  }
});

test("documented Node and pnpm versions agree with CI and the devcontainer", () => {
  const pkg = JSON.parse(read("package.json"));
  const requiredMajor = Number(pkg.engines.node.match(/\d+/)?.[0]);
  const packageManagerVersion = pkg.packageManager.match(
    /^pnpm@(\d+\.\d+\.\d+)$/,
  )?.[1];
  assert.ok(Number.isInteger(requiredMajor));
  assert.ok(packageManagerVersion, "pin pnpm in package.json");

  const ci = read(".github/workflows/ci.yml");
  const ciMajors = [...ci.matchAll(/node-version:\s*(\d+)/g)].map((match) =>
    Number(match[1]),
  );
  assert.ok(ciMajors.length > 0);
  assert.ok(ciMajors.every((major) => major === requiredMajor));
  assert.ok(read(".devcontainer/devcontainer.json").includes(`node:${requiredMajor}.`));
  assert.ok(read("AGENTS.md").includes(`Node.js ${requiredMajor}`));
  assert.ok(read("AGENTS.md").includes(`pnpm ${packageManagerVersion}`));
});
