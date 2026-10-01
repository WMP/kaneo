import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectUntranslatedKeys,
  defaultLocale,
  flattenLocale,
  loadLocales,
  writeJson,
} from "./shared.mjs";

// Shared logic of `i18n:untranslated:check` / `:update` (see untranslated.mjs).
//
// A locale value that is byte-identical to en-US is an untranslated
// placeholder. The baseline records the placeholders that existed when the
// blocking check was introduced, so the check fails only on NEW ones and the
// backlog can only shrink. It lives next to the scripts rather than in i18n/
// because every tool that reads i18n/*.json treats each file there as a locale.

export const baselinePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "untranslated-baseline.json",
);

// Plain code-unit order, unlike formatKeyList's localeCompare: the baseline is
// committed, so its order must not depend on the ICU data of whoever runs it.
export function compareKeys(a, b) {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

// Every untranslated key per target locale, as { "<locale>": ["<key>", ...] }.
// Detection is collectUntranslatedKeys, the same function the reports use, so
// the baseline and `i18n:report` never disagree, plural forms included.
export async function collectUntranslated(dir) {
  const { locales, reference } = await loadLocales(dir);
  const referenceKeys = flattenLocale(reference.data);
  const untranslated = {};

  for (const { locale, data } of locales
    .filter(({ locale }) => locale !== defaultLocale)
    .sort((a, b) => compareKeys(a.locale, b.locale))) {
    untranslated[locale] = collectUntranslatedKeys(
      data,
      reference.data,
      referenceKeys,
    ).sort(compareKeys);
  }

  return untranslated;
}

// Throws an Error with a readable message when the file is missing or is not
// { "<locale>": ["<key>", ...] }.
export async function readBaseline(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Baseline file not found: ${filePath}`, { cause: error });
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Baseline is not valid JSON: ${filePath}`, {
      cause: error,
    });
  }

  const isRecord =
    parsed && typeof parsed === "object" && !Array.isArray(parsed);
  if (
    !isRecord ||
    !Object.values(parsed).every(
      (keys) =>
        Array.isArray(keys) && keys.every((key) => typeof key === "string"),
    )
  ) {
    throw new Error(
      `Baseline must be an object of string arrays ({ "<locale>": ["<key>"] }): ${filePath}`,
    );
  }

  return parsed;
}

// Sorted by locale and key so a regenerated baseline only differs by the keys
// that really changed. Empty locales stay as [] to record "fully translated".
export async function writeBaseline(filePath, untranslated) {
  const sorted = {};

  for (const locale of Object.keys(untranslated).sort(compareKeys)) {
    sorted[locale] = [...new Set(untranslated[locale])].sort(compareKeys);
  }

  await writeJson(filePath, sorted);
}

// Per locale (union of both sides, sorted):
//   added  keys untranslated now but absent from the baseline (new placeholders)
//   stale  baseline keys no longer untranslated (translated, or removed)
// A locale missing from the baseline has an empty baseline, so a newly added
// locale must ship translated. A baseline locale with no locale file left is
// entirely stale.
export function compareWithBaseline(current, baseline) {
  const currentByLocale = new Map(Object.entries(current));
  const baselineByLocale = new Map(Object.entries(baseline));
  const locales = [
    ...new Set([...currentByLocale.keys(), ...baselineByLocale.keys()]),
  ].sort(compareKeys);

  return locales.map((locale) => {
    const now = new Set(currentByLocale.get(locale) ?? []);
    const known = new Set(baselineByLocale.get(locale) ?? []);

    return {
      locale,
      untranslated: now.size,
      baseline: known.size,
      added: [...now].filter((key) => !known.has(key)).sort(compareKeys),
      stale: [...known].filter((key) => !now.has(key)).sort(compareKeys),
    };
  });
}
