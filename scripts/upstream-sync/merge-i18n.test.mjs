import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  chooseValue,
  flatten,
  mergeEnglish,
  mergeLocale,
  serialize,
} from "./merge-i18n.mjs";
import { createMergeRepo, gitSync, removeDir, runNode } from "./test-utils.mjs";

const SCRIPT = new URL("./merge-i18n.mjs", import.meta.url).pathname;
const json = (value) => `${JSON.stringify(value, null, "\t")}\n`;
const keysOf = (tree) => flatten(tree).map((entry) => entry.key);

test("mergeEnglish keeps theirs order and inserts ours-only keys after their predecessor", () => {
  const base = { a: "A", b: "B", c: "C", d: "D" };
  const ours = { a: "A", fork: "F", b: "B", c: "C", d: "D" };
  const theirs = { a: "A", b: "B", up: "U", c: "C", d: "D" };
  const { merged, conflicts } = mergeEnglish(base, ours, theirs);
  assert.deepEqual(Object.keys(merged), ["a", "fork", "b", "up", "c", "d"]);
  assert.deepEqual(conflicts, []);
});

test("mergeEnglish puts a first ours-only key at the start and skips a deleted predecessor", () => {
  const base = { a: "A", b: "B" };
  const ours = { first: "1", a: "A", b: "B", after: "2" };
  const theirs = { b: "B" };
  const { merged } = mergeEnglish(base, ours, theirs);
  assert.deepEqual(Object.keys(merged), ["first", "b", "after"]);
});

test("mergeEnglish applies the scalar rules", () => {
  const base = { same: "s", ours: "o", theirs: "t", both: "b" };
  const ours = { same: "s", ours: "o2", theirs: "t", both: "b-fork" };
  const theirs = { same: "s", ours: "o", theirs: "t2", both: "b-up" };
  const asTheirs = mergeEnglish(base, ours, theirs);
  assert.deepEqual(asTheirs.merged, {
    same: "s",
    ours: "o2",
    theirs: "t2",
    both: "b-up",
  });
  assert.deepEqual(
    asTheirs.conflicts.map((c) => c.path),
    ["both"],
  );
  const asOurs = mergeEnglish(base, ours, theirs, { prefer: "ours" });
  assert.equal(asOurs.merged.both, "b-fork");
});

test("mergeEnglish handles deletions on one side", () => {
  const base = { gone: "g", kept: "k", changedUp: "c", changedFork: "c" };
  const ours = { kept: "k", changedUp: "c", changedFork: "c2" }; // fork deleted gone
  const theirs = { gone: "g", kept: "k", changedFork: "c" }; // upstream deleted changedUp, changedFork
  const { merged, notes } = mergeEnglish(base, ours, theirs);
  assert.equal(merged.gone, undefined); // fork deleted, upstream unchanged
  assert.equal(merged.changedUp, undefined); // upstream deleted, fork unchanged
  assert.equal(merged.changedFork, "c2"); // upstream kept it, fork changed it
  assert.equal(merged.kept, "k");
  assert.deepEqual(notes, []);

  const ours2 = { kept: "k", changedUp: "c-fork" };
  const theirs2 = { gone: "g2", kept: "k" };
  const result = mergeEnglish(
    { gone: "g", kept: "k", changedUp: "c" },
    ours2,
    theirs2,
  );
  assert.equal(result.merged.gone, "g2"); // deleted by fork, changed upstream
  assert.equal(result.merged.changedUp, "c-fork"); // deleted upstream, changed by fork
  assert.equal(result.notes.length, 2);
});

test("mergeEnglish recurses into nested objects", () => {
  const base = { s: { a: "A" } };
  const ours = { s: { a: "A", f: "F" } };
  const theirs = { s: { a: "A2" }, t: { x: "X" } };
  const { merged } = mergeEnglish(base, ours, theirs);
  assert.deepEqual(merged, { s: { a: "A2", f: "F" }, t: { x: "X" } });
});

test("chooseValue follows the validity rules", () => {
  const args = { me: "ME", lb: undefined, preferFork: false };
  assert.equal(chooseValue({ ...args, o: undefined, t: undefined }), "ME");
  assert.equal(chooseValue({ ...args, o: "o", t: undefined }), "o");
  assert.equal(chooseValue({ ...args, o: undefined, t: "t" }), "t");
  assert.equal(chooseValue({ ...args, o: "x", t: "x" }), "x");
  // only upstream translated the merged English
  assert.equal(
    chooseValue({ ...args, o: "o", t: "t", oe: "OLD", te: "ME" }),
    "t",
  );
  // only the fork translated the merged English
  assert.equal(
    chooseValue({ ...args, o: "o", t: "t", oe: "ME", te: "OLD" }),
    "o",
  );
  // both valid: the base decides, then the preference
  const both = { ...args, o: "o", t: "t", oe: "ME", te: "ME" };
  assert.equal(chooseValue({ ...both, lb: "o" }), "t");
  assert.equal(chooseValue({ ...both, lb: "t" }), "o");
  assert.equal(chooseValue({ ...both, preferFork: true }), "o");
  assert.equal(chooseValue(both), "t");
  // neither valid
  const neither = { ...args, o: "o", t: "t", oe: "A", te: "B" };
  assert.equal(chooseValue(neither), "t");
  assert.equal(chooseValue({ ...neither, t: "B" }), "o");
});

test("mergeLocale places locale-only plural forms after the last English form", () => {
  const english = { items: { item_one: "i", item_other: "is" }, z: "Z" };
  const locale = {
    items: { item_one: "1", item_few: "f", item_many: "m", item_other: "o" },
    z: "z",
    removed: "r",
    lonely_few: "x",
  };
  const { tree, total, identical } = mergeLocale({
    mergedEnglish: english,
    oursEnglish: english,
    theirsEnglish: english,
    oursLocale: locale,
    theirsLocale: locale,
    baseLocale: locale,
  });
  assert.deepEqual(keysOf(tree), [
    "items.item_one",
    "items.item_other",
    "items.item_few",
    "items.item_many",
    "z",
  ]);
  assert.equal(total, 3);
  assert.equal(identical, 0);
});

function fixtures() {
  const baseEn = {
    common: { a: "A", b: "B", c: "C", d: "D" },
    items: { item_one: "item", item_other: "items" },
  };
  const oursEn = {
    common: { a: "A fork", fk: "Fork key", b: "B", c: "C1", d: "D", z: "Z" },
    items: baseEn.items,
  };
  const theirsEn = {
    common: { a: "A", b: "B up", up: "Up key", c: "C2", z: "Z" },
    items: baseEn.items,
    extra: { x: "X" },
  };
  const loc = (common, items) => ({ common, items });
  const baseItems = {
    item_one: "1",
    item_few: "few",
    item_many: "many",
    item_other: "other",
  };
  const pl = {
    base: loc({ a: "Apl", b: "Bpl", c: "Cpl", d: "Dpl" }, baseItems),
    ours: loc(
      {
        a: "Apl fork",
        fk: "FKpl",
        b: "Bpl",
        c: "Cpl",
        d: "Dpl",
        z: "Zpl fork",
      },
      baseItems,
    ),
    theirs: {
      ...loc(
        { a: "Apl", b: "Bpl up", up: "UPpl", c: "Cpl", z: "Zpl up" },
        baseItems,
      ),
      extra: { x: "Xpl" },
    },
  };
  const de = {
    base: loc({ a: "Ade", b: "Bde", c: "Cde", d: "Dde" }, baseItems),
    ours: loc(
      { a: "Ade", b: "Bde", c: "Cde", d: "Dde", z: "Zde fork" },
      baseItems,
    ),
    theirs: loc({ a: "Ade", b: "Bde", c: "Cde", z: "Zde up" }, baseItems),
  };
  const files = (side, enSide) => ({
    "i18n/en-US.json": json(enSide),
    "i18n/pl-PL.json": json(pl[side]),
    "i18n/de-DE.json": json(de[side]),
  });
  return {
    base: files("base", baseEn),
    ours: files("ours", oursEn),
    theirs: {
      ...files("theirs", theirsEn),
      "i18n/fr-FR.json": json({ extra: { x: "Xfr" } }),
    },
  };
}

test("merge-i18n resolves a conflicting merge in a real git repository", () => {
  const dir = createMergeRepo(fixtures());
  try {
    const unmerged = gitSync(dir, ["ls-files", "-u"]);
    assert.match(unmerged, /i18n\/en-US\.json/);

    const dry = runNode(SCRIPT, [
      "--repo",
      dir,
      "--upstream-ref",
      "upstream",
      "--dry-run",
    ]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /Dry run/);

    const result = runNode(SCRIPT, [
      "--repo",
      dir,
      "--upstream-ref",
      "upstream",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 value conflict/);
    assert.match(result.stdout, /conflict common\.c/);
    assert.match(result.stdout, /pnpm i18n:schema/);
    assert.match(result.stdout, /pnpm i18n:check/);
    assert.match(result.stdout, /pnpm i18n:untranslated:check/);

    const read = (name) => readFileSync(join(dir, "i18n", name), "utf8");
    const en = JSON.parse(read("en-US.json"));
    assert.deepEqual(keysOf(en), [
      "common.a",
      "common.fk",
      "common.b",
      "common.up",
      "common.c",
      "common.z",
      "items.item_one",
      "items.item_other",
      "extra.x",
    ]);
    assert.equal(en.common.a, "A fork");
    assert.equal(en.common.b, "B up");
    assert.equal(en.common.c, "C2"); // conflict resolved to theirs
    assert.equal(en.common.d, undefined); // deleted upstream, unchanged by the fork
    assert.ok(read("en-US.json").endsWith("\n"));
    assert.ok(read("en-US.json").startsWith('{\n\t"common": {\n\t\t"a"'));

    const pl = JSON.parse(read("pl-PL.json"));
    assert.deepEqual(
      keysOf(pl),
      keysOf(en).flatMap((key) =>
        key === "items.item_other"
          ? [key, "items.item_few", "items.item_many"]
          : [key],
      ),
    );
    assert.equal(pl.common.a, "Apl fork"); // only the fork translated "A fork"
    assert.equal(pl.common.b, "Bpl up"); // only upstream translated "B up"
    assert.equal(pl.common.fk, "FKpl"); // fork-only key
    assert.equal(pl.common.up, "UPpl"); // upstream-only key
    assert.equal(pl.common.c, "Cpl"); // both sides kept the old text
    assert.equal(pl.common.z, "Zpl fork"); // both valid, pl-PL prefers the fork
    assert.equal(pl.common.d, undefined);
    assert.equal(pl.items.item_few, "few");

    const de = JSON.parse(read("de-DE.json"));
    assert.equal(de.common.z, "Zde up"); // both valid, other locales prefer upstream
    assert.equal(de.common.fk, "Fork key"); // nobody translated it: English placeholder
    assert.equal(de.common.up, "Up key");
    assert.equal(de.extra.x, "X");

    const fr = JSON.parse(read("fr-FR.json")); // locale added only by upstream
    assert.equal(fr.extra.x, "Xfr");
    assert.equal(fr.common.a, "A fork");
    assert.deepEqual(keysOf(fr), keysOf(en));
  } finally {
    removeDir(dir);
  }
});

test("merge-i18n --dry-run writes nothing and --help works", () => {
  const dir = createMergeRepo(fixtures());
  try {
    const before = readFileSync(join(dir, "i18n/pl-PL.json"), "utf8");
    const dry = runNode(SCRIPT, [
      "--repo",
      dir,
      "--upstream-ref",
      "upstream",
      "--dry-run",
    ]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(readFileSync(join(dir, "i18n/pl-PL.json"), "utf8"), before);
    assert.equal(runNode(SCRIPT, ["--help"]).status, 0);
    assert.equal(runNode(SCRIPT, ["--en-prefer", "nope"]).status, 2);
  } finally {
    removeDir(dir);
  }
});

test("--en-prefer ours and --prefer-fork-locales are honoured", () => {
  const dir = createMergeRepo(fixtures());
  try {
    const result = runNode(SCRIPT, [
      "--repo",
      dir,
      "--upstream-ref",
      "upstream",
      "--en-prefer",
      "ours",
      "--prefer-fork-locales",
      "de-DE",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const read = (name) =>
      JSON.parse(readFileSync(join(dir, "i18n", name), "utf8"));
    assert.equal(read("en-US.json").common.c, "C1");
    assert.equal(read("de-DE.json").common.z, "Zde fork");
    assert.equal(read("pl-PL.json").common.z, "Zpl up");
  } finally {
    removeDir(dir);
  }
});

test("serialize uses tabs, keeps UTF-8 and ends with a newline", () => {
  assert.equal(
    serialize({ a: { b: "Zażółć" } }),
    '{\n\t"a": {\n\t\t"b": "Zażółć"\n\t}\n}\n',
  );
});
