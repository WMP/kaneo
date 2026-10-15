import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  classifyArea,
  codeFromStages,
  compileAreas,
  countHunks,
  parseStatusZ,
  parseUnmergedStages,
} from "./conflict-report.mjs";
import { globToRegExp } from "./lib.mjs";
import { createMergeRepo, removeDir, runNode } from "./test-utils.mjs";

const SCRIPT = new URL("./conflict-report.mjs", import.meta.url).pathname;
const areas = compileAreas(
  JSON.parse(readFileSync(new URL("./areas.json", import.meta.url), "utf8")),
);

test("parseStatusZ keeps only unmerged entries and skips rename origins", () => {
  const output = [
    "UU a b.ts",
    "M  clean.ts",
    "R  new.ts",
    "old.ts",
    "UD gone.ts",
    "DU mine.ts",
    "AA both.ts",
    "AU a.ts",
    "UA b.ts",
    "DD c.ts",
    "?? untracked.ts",
    "",
  ].join("\0");
  assert.deepEqual(
    parseStatusZ(output).map((e) => `${e.code} ${e.path}`),
    [
      "UU a b.ts",
      "UD gone.ts",
      "DU mine.ts",
      "AA both.ts",
      "AU a.ts",
      "UA b.ts",
      "DD c.ts",
    ],
  );
});

test("parseUnmergedStages and codeFromStages", () => {
  const output = [
    "100644 aaa 1\tx.ts",
    "100644 bbb 2\tx.ts",
    "100644 ccc 3\tx.ts",
    "100644 ddd 2\ty.ts",
    "",
  ].join("\0");
  const stages = parseUnmergedStages(output);
  assert.equal(codeFromStages(stages.get("x.ts")), "UU");
  assert.equal(codeFromStages(stages.get("y.ts")), "AU");
  assert.equal(codeFromStages(new Set([1, 2])), "UD");
  assert.equal(codeFromStages(new Set([1, 3])), "DU");
  assert.equal(codeFromStages(new Set([2, 3])), "AA");
  assert.equal(codeFromStages(new Set([3])), "UA");
  assert.equal(codeFromStages(new Set([1])), "DD");
});

test("countHunks counts conflict start markers only", () => {
  const text = "a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> up\nb\n<<<<<<< HEAD\n";
  assert.equal(countHunks(text), 2);
  assert.equal(countHunks("no markers\n"), 0);
});

test("globToRegExp", () => {
  assert.ok(
    globToRegExp("apps/api/drizzle/**").test(
      "apps/api/drizzle/meta/_journal.json",
    ),
  );
  assert.ok(globToRegExp("i18n/*.json").test("i18n/en-US.json"));
  assert.ok(!globToRegExp("i18n/*.json").test("i18n/sub/en-US.json"));
  assert.ok(globToRegExp("*.md").test("docs/deep/README.md"));
  assert.ok(
    globToRegExp("apps/web/src/routes/**/settings/**").test(
      "apps/web/src/routes/_layout/x/settings/a.tsx",
    ),
  );
  assert.ok(
    globToRegExp("apps/web/src/routes/**/settings/**").test(
      "apps/web/src/routes/settings/a.tsx",
    ),
  );
});

test("areas.json classifies paths in order", () => {
  const cases = {
    "apps/docs/openapi.json": "generated",
    "i18n/schema.json": "generated",
    "pnpm-lock.yaml": "generated",
    "i18n/pl-PL.json": "i18n",
    "apps/api/drizzle/meta/_journal.json": "migrations",
    "apps/api/src/database/schema.ts": "schema",
    "apps/api/src/utils/permissions.ts": "api-access",
    "apps/api/src/auth.ts": "api-access",
    "apps/api/src/project/index.ts": "api-access",
    "apps/api/src/task/controllers/create.ts": "api-tasks",
    "apps/api/src/column/index.ts": "api-tasks",
    "apps/api/src/index.ts": "api-other",
    "packages/mcp/src/x.ts": "api-other",
    "apps/web/src/components/task/a.tsx": "web-task",
    "apps/web/src/components/ui/calendar.tsx": "web-task",
    "apps/web/src/components/gantt/a.tsx": "web-views",
    "apps/web/src/routes/_layout/_authenticated/dashboard/workspace/$w/project/$p/board.tsx":
      "web-views",
    "apps/web/src/routes/_layout/_authenticated/dashboard/settings/a.tsx":
      "web-settings",
    "apps/web/src/components/nav-main.tsx": "web-settings",
    "apps/web/src/components/project/a.tsx": "web-settings",
    "tests/api/x.test.ts": "tests",
    ".github/workflows/ci.yml": "docs-ci",
    "README.md": "docs-ci",
    "apps/docs/core/a.mdx": "docs-ci",
    "package.json": "other",
  };
  for (const [path, area] of Object.entries(cases)) {
    assert.equal(classifyArea(path, areas), area, path);
  }
});

test("conflict-report on a real merge: statuses, areas, hunks, upstream deleter", () => {
  const dir = createMergeRepo({
    base: {
      "i18n/en-US.json": '{\n\t"a": "1"\n}\n',
      "apps/api/src/task/x.ts": "line\n",
      "apps/api/src/gone.ts": "line\n",
      "docs/mine.md": "line\n",
    },
    ours: {
      "i18n/en-US.json": '{\n\t"a": "fork"\n}\n',
      "apps/api/src/task/x.ts": "fork\n",
      "apps/api/src/gone.ts": "fork\n",
      "docs/mine.md": null,
      "tests/new.ts": "fork\n",
    },
    theirs: {
      "i18n/en-US.json": '{\n\t"a": "up"\n}\n',
      "apps/api/src/task/x.ts": "up\n",
      "apps/api/src/gone.ts": null,
      "docs/mine.md": "up\n",
      "tests/new.ts": "up\n",
    },
  });
  try {
    const result = runNode(SCRIPT, [
      "--repo",
      dir,
      "--upstream-ref",
      "upstream",
      "--json",
    ]);
    assert.equal(result.status, 1, result.stderr);
    const { records } = JSON.parse(result.stdout);
    const byPath = Object.fromEntries(records.map((r) => [r.path, r]));
    assert.equal(byPath["i18n/en-US.json"].code, "UU");
    assert.equal(byPath["i18n/en-US.json"].area, "i18n");
    assert.equal(byPath["i18n/en-US.json"].hunks, 1);
    assert.equal(byPath["apps/api/src/task/x.ts"].area, "api-tasks");
    assert.equal(byPath["apps/api/src/gone.ts"].code, "UD");
    assert.equal(byPath["apps/api/src/gone.ts"].status, "deleted by upstream");
    assert.equal(byPath["apps/api/src/gone.ts"].hunks, 0);
    assert.match(
      byPath["apps/api/src/gone.ts"].deletedBy,
      /^[0-9a-f]+ upstream$/,
    );
    assert.equal(byPath["docs/mine.md"].code, "DU");
    assert.equal(byPath["tests/new.ts"].code, "AA");
    assert.equal(byPath["tests/new.ts"].area, "tests");

    const table = runNode(SCRIPT, [
      "--repo",
      dir,
      "--upstream-ref",
      "upstream",
    ]);
    assert.match(
      table.stdout,
      /UD\s+deleted by upstream\s+0\s+apps\/api\/src\/gone\.ts/,
    );
    const markdown = runNode(SCRIPT, [
      "--repo",
      dir,
      "--upstream-ref",
      "upstream",
      "--markdown",
    ]);
    assert.match(markdown.stdout, /\| api-tasks \| 1 \| 1 \|/);
    assert.match(markdown.stdout, /### tests/);
  } finally {
    removeDir(dir);
  }
});

test("conflict-report exits 0 when nothing is unmerged and --help works", () => {
  const dir = createMergeRepo({
    base: { "a.txt": "1\n" },
    ours: { "b.txt": "ours\n" },
    theirs: { "c.txt": "theirs\n" },
  });
  try {
    const result = runNode(SCRIPT, [
      "--repo",
      dir,
      "--upstream-ref",
      "upstream",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No unmerged paths/);
    assert.equal(runNode(SCRIPT, ["--help"]).status, 0);
  } finally {
    removeDir(dir);
  }
});
