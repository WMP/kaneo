import path from "node:path";
import { parseArgs } from "node:util";
import { formatKeyList, i18nDir, repoRoot } from "./shared.mjs";
import {
  baselinePath,
  collectUntranslated,
  compareWithBaseline,
  readBaseline,
  writeBaseline,
} from "./untranslated-baseline.mjs";

// Reports locale values that are still byte-identical to en-US, i.e.
// untranslated placeholders. Detection is shared with `i18n:report` (see
// collectUntranslatedKeys) so the two commands never disagree, including on
// locale-specific plural forms.
//
//   (no flag)   informational: counts per locale (--keys lists them); exits 0.
//   --check     blocking: fails on placeholders missing from the committed
//               baseline and on baseline entries that are no longer
//               placeholders, so new text must be translated in the same
//               change and the backlog only shrinks.
//   --update    rewrites the baseline from the current state.
//   --dir <p>, --baseline <p>  override i18n/ and the baseline file (tests).
//
// Exit codes: 0 ok; 1 --check found differences; 2 usage or baseline error.

const updateCommand = "pnpm i18n:untranslated:update";

let options;
try {
  options = parseArgs({
    args: process.argv.slice(2),
    options: {
      check: { type: "boolean" },
      update: { type: "boolean" },
      keys: { type: "boolean" },
      dir: { type: "string" },
      baseline: { type: "string" },
    },
    strict: true,
  }).values;
} catch (error) {
  fail(error.message);
}

if (options.check && options.update) {
  fail("--check and --update cannot be combined.");
}
if (options.keys && (options.check || options.update)) {
  fail("--keys only applies to the informational report.");
}

const dir = options.dir ? path.resolve(options.dir) : i18nDir;
const baselineFile = options.baseline
  ? path.resolve(options.baseline)
  : baselinePath;

const untranslated = await collectUntranslated(dir);

if (options.check) {
  await runCheck();
} else if (options.update) {
  await runUpdate();
} else {
  runReport();
}

function runReport() {
  for (const [locale, keys] of Object.entries(untranslated)) {
    console.log(`${locale}: ${keys.length} untranslated`);

    if (options.keys) {
      for (const key of formatKeyList(keys)) {
        console.log(`  - ${key}`);
      }
    }
  }

  // Informational only: it never fails, so it is safe to run anywhere.
  process.exit(0);
}

async function runCheck() {
  const results = compareWithBaseline(untranslated, await loadBaseline());
  const failing = results.filter(
    ({ added, stale }) => added.length > 0 || stale.length > 0,
  );

  console.log(`Untranslated keys vs baseline (${displayPath(baselineFile)}):`);
  for (const { locale, untranslated: count, added, stale } of results) {
    console.log(
      `  ${locale}: ${count} untranslated, ${added.length} new, ${stale.length} stale`,
    );
  }

  if (failing.length === 0) {
    console.log("No new untranslated keys and no stale baseline entries.");
    process.exit(0);
  }

  const withNew = failing.filter(({ added }) => added.length > 0);
  const withStale = failing.filter(({ stale }) => stale.length > 0);

  if (withNew.length > 0) {
    console.log("\nNew untranslated keys (identical to en-US):");
    for (const { locale, added } of withNew) {
      console.log(`  ${locale}:`);
      for (const key of added) {
        console.log(`    - ${key}`);
      }
    }
    console.log(
      `\nTranslate these keys in the listed locales. If the English text is the correct translation (a brand name or a loanword, say), run \`${updateCommand}\` and explain each accepted key in the PR.`,
    );
  }

  if (withStale.length > 0) {
    console.log(
      "\nStale baseline entries (translated, or removed from en-US, or their locale is gone):",
    );
    for (const { locale, stale } of withStale) {
      console.log(`  ${locale}:`);
      for (const key of stale) {
        console.log(`    - ${key}`);
      }
    }
    console.log(
      withNew.length > 0
        ? `\nThe baseline may only shrink. Once the new keys above are translated, run \`${updateCommand}\` and commit the smaller ${displayPath(baselineFile)}; running it earlier would accept them into the baseline.`
        : `\nThe baseline may only shrink. Run \`${updateCommand}\` and commit the smaller ${displayPath(baselineFile)}.`,
    );
  }

  process.exit(1);
}

async function runUpdate() {
  // A missing or unreadable baseline is not an obstacle to rewriting it.
  const previous = await readBaseline(baselineFile).catch(() => ({}));
  const changes = compareWithBaseline(untranslated, previous).filter(
    ({ added, stale }) => added.length > 0 || stale.length > 0,
  );

  await writeBaseline(baselineFile, untranslated);

  const total = Object.values(untranslated).reduce(
    (sum, keys) => sum + keys.length,
    0,
  );
  console.log(
    `Wrote ${displayPath(baselineFile)}: ${Object.keys(untranslated).length} locales, ${total} untranslated keys.`,
  );
  for (const { locale, added, stale } of changes) {
    console.log(
      `  ${locale}: +${added.length} accepted, -${stale.length} gone`,
    );
  }
  if (changes.some(({ added }) => added.length > 0)) {
    console.log(
      "The baseline grew: every accepted key is a placeholder that ships untranslated. Explain each one in the PR.",
    );
  }
}

async function loadBaseline() {
  try {
    return await readBaseline(baselineFile);
  } catch (error) {
    fail(`${error.message}\nCreate it with \`${updateCommand}\`.`);
  }
}

function displayPath(filePath) {
  const relative = path.relative(repoRoot, filePath);
  return relative.startsWith("..") ? filePath : relative;
}

function fail(message) {
  console.error(`i18n:untranslated: ${message}`);
  process.exit(2);
}
