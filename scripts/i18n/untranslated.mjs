import {
  collectUntranslatedKeys,
  defaultLocale,
  flattenLocale,
  formatKeyList,
  loadLocales,
} from "./shared.mjs";

// Informational only: reports how many locale values are still byte-identical
// to en-US (i.e. untranslated placeholders). It never fails the build, since
// most locales currently carry many placeholders and that is expected, not a
// regression. Detection is shared with `i18n:report` (see collectUntranslatedKeys)
// so the two commands never disagree, including on locale-specific plural forms.

const args = process.argv.slice(2);
const showKeys = args.includes("--keys");

const { locales, reference } = await loadLocales();
const referenceKeys = flattenLocale(reference.data);
const targetLocales = locales.filter(({ locale }) => locale !== defaultLocale);

for (const locale of targetLocales) {
  const untranslated = collectUntranslatedKeys(
    locale.data,
    reference.data,
    referenceKeys,
  );

  console.log(`${locale.locale}: ${untranslated.length} untranslated`);

  if (showKeys && untranslated.length > 0) {
    for (const key of formatKeyList(untranslated)) {
      console.log(`  - ${key}`);
    }
  }
}

// Always exit 0: this report is informational and must never block CI.
process.exit(0);
