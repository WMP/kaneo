import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
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
    const maxBytes = filename.startsWith(guideDirectory) ? 24 * 1024 : 4 * 1024;
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
    assert.ok(
      entry.includes(`(${filename})`),
      `AGENTS.md does not route to ${filename}`,
    );
    if (basename !== "README.md") {
      assert.equal(
        index.split(`(${basename})`).length - 1,
        1,
        `${filename} should have one index entry`,
      );
    }
  }
  for (const filename of instructionFiles.filter(
    (file) =>
      file === "AGENTS.md" ||
      file === "CLAUDE.md" ||
      file.startsWith(".cursor/"),
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
  assert.ok(
    read(".devcontainer/devcontainer.json").includes(`node:${requiredMajor}.`),
  );
  assert.ok(read("AGENTS.md").includes(`Node.js ${requiredMajor}`));
  assert.ok(read("AGENTS.md").includes(`pnpm ${packageManagerVersion}`));
});

// Letters that occur in Polish but not in the other languages that can
// legitimately appear in English documentation. ó/Ó are deliberately absent:
// Spanish, Portuguese, Hungarian, Irish and others use them too.
const polishLetters = /[ąćęłńśźżĄĆĘŁŃŚŹŻ]/u;

// 1-based numbers of the lines that contain a Polish-specific letter. The text
// is normalized first so a decomposed letter (base letter plus combining mark)
// is caught as well.
const polishLines = (text) =>
  text
    .normalize("NFC")
    .split(/\r?\n/)
    .flatMap((line, index) => (polishLetters.test(line) ? [index + 1] : []));

// Without this check a broken pattern would let the documentation scan below
// pass vacuously. The Polish samples are deliberate test data.
test("Polish letter detection flags Polish text and ignores other languages", () => {
  assert.deepEqual(polishLines("Zażółć gęślą jaźń"), [1]);
  for (const letter of "ąćęłńśźżĄĆĘŁŃŚŹŻ") {
    assert.deepEqual(polishLines(`Word ${letter}`), [1], `${letter} is missed`);
  }
  // Decomposed spelling: base letters plus combining ogonek (U+0328) and
  // combining acute accent (U+0301).
  assert.deepEqual(polishLines("ge\u0328s\u0301la\u0328"), [1]);
  assert.deepEqual(polishLines("one\r\nzażółć\r\nthree\nłódź\n"), [2, 4]);

  assert.deepEqual(polishLines("Café – “Phase” → Déjà vu, naïve"), []);
  assert.deepEqual(polishLines("Gyógyszer, Ó Móra, móvil, über, småland"), []);
  assert.deepEqual(polishLines("│   ├── api/  # Thanks! 🚀"), []);
});

// Scope: the root documentation, everything below docs/ and the Cursor rules.
// The i18n catalogs legitimately hold other languages, and apps/ and packages/
// are out of scope, so none of them is scanned.
test("repository documentation is written in English", () => {
  const rootFiles = [
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "CONTRIBUTING.md",
    "ENVIRONMENT_SETUP.md",
  ].filter((filename) => existsSync(path.join(root, filename)));
  const docsFiles = readdirSync(path.join(root, "docs"), { recursive: true })
    .map((entry) => `docs/${entry.split(path.sep).join("/")}`)
    .filter(
      (filename) =>
        filename.endsWith(".md") &&
        statSync(path.join(root, filename)).isFile(),
    )
    .sort();
  const ruleFiles = readdirSync(path.join(root, ".cursor/rules"))
    .filter((filename) => filename.endsWith(".mdc"))
    .map((filename) => `.cursor/rules/${filename}`)
    .sort();
  assert.ok(
    docsFiles.includes(`${guideDirectory}/README.md`),
    "the scan must reach Markdown files below docs/",
  );

  const offenders = [...rootFiles, ...docsFiles, ...ruleFiles].flatMap(
    (filename) =>
      polishLines(read(filename)).map((line) => `${filename}:${line}`),
  );
  assert.ok(
    offenders.length === 0,
    `Polish text found in repository documentation; see the English-content rule in AGENTS.md:\n${offenders.join("\n")}`,
  );
});
