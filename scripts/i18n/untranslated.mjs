import {
  defaultLocale,
  flattenLocale,
  formatKeyList,
  getValueAtKey,
  loadLocales,
} from "./shared.mjs";

// Informational only: reports how many locale values are still byte-identical
// to en-US (i.e. untranslated placeholders). It never fails the build, since
// most locales currently carry many placeholders and that is expected, not a
// regression.

const args = process.argv.slice(2);
const showKeys = args.includes("--keys");

const { locales, reference } = await loadLocales();
const referenceKeys = flattenLocale(reference.data);
const targetLocales = locales.filter(({ locale }) => locale !== defaultLocale);

for (const locale of targetLocales) {
  const localeKeys = flattenLocale(locale.data);

  const untranslated = new Set(
    [...localeKeys].filter((key) => {
      if (!referenceKeys.has(key)) {
        return false;
      }
      const localeValue = getValueAtKey(locale.data, key);
      const referenceValue = getValueAtKey(reference.data, key);
      return (
        typeof localeValue === "string" &&
        typeof referenceValue === "string" &&
        localeValue === referenceValue
      );
    }),
  );

  console.log(`${locale.locale}: ${untranslated.size} untranslated`);

  if (showKeys && untranslated.size > 0) {
    for (const key of formatKeyList(untranslated)) {
      console.log(`  - ${key}`);
    }
  }
}

// Always exit 0: this report is informational and must never block CI.
process.exit(0);
