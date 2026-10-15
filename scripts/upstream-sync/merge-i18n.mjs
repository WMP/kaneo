#!/usr/bin/env node
// Resolves the i18n locale files of an in-progress merge.
//
// en-US.json gets a recursive 3-way merge. Every other locale is rebuilt from
// the merged English key set, choosing each value from the fork or from
// upstream (see chooseValue). Files are written but not staged.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fail, gitOrNull, isMain, REPO_ROOT } from "./lib.mjs";

const HELP = `Usage: node scripts/upstream-sync/merge-i18n.mjs [options]

Resolves i18n/*.json of an in-progress merge. Writes the files (not staged).

Options:
  --locales-dir <dir>            Locale directory, relative to the repo (default: i18n)
  --en-prefer theirs|ours        Winner of an en-US value conflict (default: theirs)
  --prefer-fork-locales <list>   Comma-separated locales that prefer the fork value
                                 when both sides are valid translations (default: pl-PL)
  --upstream-ref <ref>           Upstream ref (default: upstream/main)
  --fork-ref <ref>               Fork ref (default: HEAD)
  --repo <dir>                   Repository directory (default: this repository)
  --dry-run                      Report only, write nothing
  -h, --help                     Show this help

Exit codes: 0 done, 2 error.`;

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const has = (object, key) => isObject(object) && Object.hasOwn(object, key);

export function deepEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => has(b, key) && deepEqual(a[key], b[key]))
    );
  }
  return false;
}

/**
 * Recursive 3-way merge of en-US. The key order is the one of `theirs`; keys
 * only in `ours` go right after their nearest preceding sibling (in ours
 * order) that exists in the result.
 * Returns { merged, conflicts, notes }.
 */
export function mergeEnglish(base, ours, theirs, { prefer = "theirs" } = {}) {
  const conflicts = [];
  const notes = [];

  function mergeValue(b, inBase, o, t, path) {
    if (isObject(o) && isObject(t)) {
      return mergeObjects(isObject(b) ? b : {}, o, t, path);
    }
    if (deepEqual(o, t)) {
      return t;
    }
    if (inBase && deepEqual(o, b)) {
      return t;
    }
    if (inBase && deepEqual(t, b)) {
      return o;
    }
    const chosen = prefer === "ours" ? o : t;
    conflicts.push({ path: path.join("."), ours: o, theirs: t, chosen });
    return chosen;
  }

  function mergeObjects(b, o, t, path) {
    const out = [];
    for (const key of Object.keys(t)) {
      const here = [...path, key];
      if (has(o, key)) {
        out.push([key, mergeValue(b[key], has(b, key), o[key], t[key], here)]);
      } else if (has(b, key)) {
        if (!deepEqual(b[key], t[key])) {
          out.push([key, t[key]]);
          notes.push({
            path: here.join("."),
            note: "deleted by fork, changed upstream: kept upstream",
          });
        }
      } else {
        out.push([key, t[key]]);
      }
    }
    const oursKeys = Object.keys(o);
    oursKeys.forEach((key, index) => {
      if (has(t, key)) {
        return;
      }
      const here = [...path, key];
      if (has(b, key) && deepEqual(b[key], o[key])) {
        return; // deleted by upstream, unchanged by the fork
      }
      if (has(b, key)) {
        notes.push({
          path: here.join("."),
          note: "deleted by upstream, changed by fork: kept fork",
        });
      }
      let position = 0;
      for (let i = index - 1; i >= 0; i--) {
        const found = out.findIndex(([k]) => k === oursKeys[i]);
        if (found !== -1) {
          position = found + 1;
          break;
        }
      }
      out.splice(position, 0, [key, o[key]]);
    });
    return Object.fromEntries(out);
  }

  const merged = mergeObjects(base ?? {}, ours ?? {}, theirs ?? {}, []);
  return { merged, conflicts, notes };
}

/** Ordered leaf entries [dotPath, segments, value]; an empty object is a leaf. */
export function flatten(tree, prefix = [], out = []) {
  if (!isObject(tree)) {
    return out;
  }
  for (const [key, value] of Object.entries(tree)) {
    const segments = [...prefix, key];
    if (isObject(value) && Object.keys(value).length > 0) {
      flatten(value, segments, out);
    } else {
      out.push({ key: segments.join("."), segments, value });
    }
  }
  return out;
}

function flatMap(tree) {
  return new Map(flatten(tree).map((entry) => [entry.key, entry.value]));
}

export function unflatten(entries) {
  const root = {};
  for (const { segments, value } of entries) {
    let node = root;
    segments.slice(0, -1).forEach((segment) => {
      if (!isObject(node[segment])) {
        node[segment] = {};
      }
      node = node[segment];
    });
    node[segments.at(-1)] = value;
  }
  return root;
}

const EXTRA_PLURAL_FORMS = ["zero", "two", "few", "many"];
const EXTRA_PLURAL = /^(.*)_(zero|two|few|many)$/s;
const ANY_PLURAL = /^(.*)_(zero|one|two|few|many|other)$/s;

/**
 * Picks the value of one key of a non-English locale.
 * o/t: fork/upstream value; oe/te: English of fork/upstream for the key;
 * me: merged English; lb: base locale value.
 */
export function chooseValue({ o, t, oe, te, me, lb, preferFork }) {
  if (o === undefined && t === undefined) {
    return me;
  }
  if (t === undefined) {
    return o;
  }
  if (o === undefined) {
    return t;
  }
  if (deepEqual(o, t)) {
    return o;
  }
  const oValid = deepEqual(oe, me) && !deepEqual(o, oe);
  const tValid = deepEqual(te, me) && !deepEqual(t, te);
  if (tValid && !oValid) {
    return t;
  }
  if (oValid && !tValid) {
    return o;
  }
  if (oValid && tValid) {
    if (deepEqual(lb, o)) {
      return t;
    }
    if (deepEqual(lb, t)) {
      return o;
    }
    return preferFork ? o : t;
  }
  return !deepEqual(t, te) ? t : o;
}

/**
 * Rebuilds a locale from the merged English. Returns { tree, total, identical }
 * where `identical` counts English keys whose value equals the English text.
 */
export function mergeLocale({
  mergedEnglish,
  oursEnglish,
  theirsEnglish,
  oursLocale,
  theirsLocale,
  baseLocale,
  preferFork = false,
}) {
  const me = flatMap(mergedEnglish);
  const oe = flatMap(oursEnglish);
  const te = flatMap(theirsEnglish);
  const o = flatMap(oursLocale);
  const t = flatMap(theirsLocale);
  const lb = flatMap(baseLocale);

  const order = flatten(mergedEnglish).map(({ key, segments }) => ({
    key,
    segments,
  }));

  // Locale-only plural forms follow the last English form of the same base.
  const extras = new Map();
  for (const key of [...o.keys(), ...t.keys()]) {
    const match = EXTRA_PLURAL.exec(key);
    if (match && !me.has(key) && me.has(`${match[1]}_other`)) {
      extras.set(key, match);
    }
  }
  const byBase = new Map();
  for (const [key, match] of extras) {
    byBase.set(match[1], [
      ...(byBase.get(match[1]) ?? []),
      { key, form: match[2] },
    ]);
  }
  for (const [base, items] of byBase) {
    items.sort(
      (a, b) =>
        EXTRA_PLURAL_FORMS.indexOf(a.form) - EXTRA_PLURAL_FORMS.indexOf(b.form),
    );
    let anchor = -1;
    order.forEach(({ key }, index) => {
      const match = ANY_PLURAL.exec(key);
      if (match && match[1] === base) {
        anchor = index;
      }
    });
    const baseEntry = order.find((entry) => entry.key === `${base}_other`);
    order.splice(
      anchor + 1,
      0,
      ...items.map(({ key, form }) => ({
        key,
        segments: [
          ...baseEntry.segments.slice(0, -1),
          `${baseEntry.segments.at(-1).replace(/_other$/, "")}_${form}`,
        ],
      })),
    );
  }

  let identical = 0;
  let total = 0;
  const entries = order.map(({ key, segments }) => {
    const value = chooseValue({
      o: o.get(key),
      t: t.get(key),
      oe: oe.get(key),
      te: te.get(key),
      me: me.get(key),
      lb: lb.get(key),
      preferFork,
    });
    if (me.has(key)) {
      total += 1;
      if (deepEqual(value, me.get(key))) {
        identical += 1;
      }
    }
    return { segments, value };
  });
  return { tree: unflatten(entries), total, identical };
}

export function serialize(tree) {
  return `${JSON.stringify(tree, null, "\t")}\n`;
}

function readJsonSpec({ repo, specs }) {
  for (const spec of specs) {
    const content = gitOrNull(["show", spec], { cwd: repo });
    if (content !== null) {
      return JSON.parse(content);
    }
  }
  return null;
}

function readSides({ repo, path, forkRef, upstreamRef, mergeBase }) {
  return {
    base: readJsonSpec({
      repo,
      specs: [`:1:${path}`, ...(mergeBase ? [`${mergeBase}:${path}`] : [])],
    }),
    ours: readJsonSpec({ repo, specs: [`:2:${path}`, `${forkRef}:${path}`] }),
    theirs: readJsonSpec({
      repo,
      specs: [`:3:${path}`, `${upstreamRef}:${path}`],
    }),
  };
}

function listLocales({ repo, localesDir, forkRef, upstreamRef }) {
  const names = new Set();
  const add = (name) => {
    if (name.endsWith(".json")) {
      names.add(name);
    }
  };
  try {
    readdirSync(join(repo, localesDir)).forEach(add);
  } catch {
    // directory may not exist in the worktree
  }
  for (const ref of [forkRef, upstreamRef]) {
    const listing = gitOrNull(
      ["ls-tree", "--name-only", ref, `${localesDir}/`],
      { cwd: repo },
    );
    for (const line of (listing ?? "").split("\n")) {
      if (line) {
        add(line.slice(localesDir.length + 1));
      }
    }
  }
  names.delete("schema.json");
  names.delete("en-US.json");
  return [...names].sort();
}

function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        "locales-dir": { type: "string", default: "i18n" },
        "en-prefer": { type: "string", default: "theirs" },
        "prefer-fork-locales": { type: "string", default: "pl-PL" },
        "upstream-ref": { type: "string", default: "upstream/main" },
        "fork-ref": { type: "string", default: "HEAD" },
        repo: { type: "string", default: REPO_ROOT },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    fail(`${error.message}\n\n${HELP}`);
  }
  const { values } = parsed;
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (!["theirs", "ours"].includes(values["en-prefer"])) {
    fail(`--en-prefer must be theirs or ours.\n\n${HELP}`);
  }
  const repo = values.repo;
  const localesDir = values["locales-dir"].replace(/\/+$/, "");
  const forkRef = values["fork-ref"];
  const upstreamRef = values["upstream-ref"];
  const preferForkLocales = new Set(
    values["prefer-fork-locales"]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const mergeBase = gitOrNull(["merge-base", forkRef, upstreamRef], {
    cwd: repo,
  })?.trim();
  const ctx = { repo, forkRef, upstreamRef, mergeBase };

  const writes = [];
  let english;
  try {
    english = readSides({ ...ctx, path: `${localesDir}/en-US.json` });
    if (!english.ours || !english.theirs) {
      fail(
        `${localesDir}/en-US.json is missing on the fork or the upstream side.`,
      );
    }
  } catch (error) {
    fail(`Cannot read en-US.json: ${error.message}`);
  }
  const { merged, conflicts, notes } = mergeEnglish(
    english.base,
    english.ours,
    english.theirs,
    { prefer: values["en-prefer"] },
  );
  writes.push({ file: "en-US.json", tree: merged });

  console.log(
    `en-US: ${flatten(merged).length} keys, ${conflicts.length} value conflict(s) (resolved to ${values["en-prefer"]}).`,
  );
  for (const c of conflicts) {
    console.log(
      `  conflict ${c.path}\n    fork:     ${JSON.stringify(c.ours)}\n    upstream: ${JSON.stringify(c.theirs)}`,
    );
  }
  for (const n of notes) {
    console.log(`  note ${n.path}: ${n.note}`);
  }

  const report = [];
  for (const file of listLocales({ repo, localesDir, forkRef, upstreamRef })) {
    const locale = file.replace(/\.json$/, "");
    const sides = readSides({ ...ctx, path: `${localesDir}/${file}` });
    if (!sides.ours && !sides.theirs) {
      continue;
    }
    const result = mergeLocale({
      mergedEnglish: merged,
      oursEnglish: english.ours,
      theirsEnglish: english.theirs,
      oursLocale: sides.ours,
      theirsLocale: sides.theirs,
      baseLocale: sides.base,
      preferFork: preferForkLocales.has(locale),
    });
    writes.push({ file, tree: result.tree });
    report.push({ locale, ...result });
  }

  console.log(
    "\nValues identical to en-US per locale (placeholders or untranslated):",
  );
  for (const { locale, identical, total } of report) {
    console.log(
      `  ${locale.padEnd(8)} ${String(identical).padStart(5)} / ${total}`,
    );
  }

  if (values["dry-run"]) {
    console.log(
      `\nDry run: ${writes.length} file(s) would be written to ${localesDir}/.`,
    );
    return;
  }
  mkdirSync(join(repo, localesDir), { recursive: true });
  for (const { file, tree } of writes) {
    writeFileSync(join(repo, localesDir, file), serialize(tree));
  }
  console.log(
    `\nWrote ${writes.length} file(s) to ${localesDir}/ (not staged: review, then git add).`,
  );
  console.log(
    "Next: pnpm i18n:schema && pnpm i18n:check && pnpm i18n:untranslated:check",
  );
}

if (isMain(import.meta.url)) {
  main();
}
