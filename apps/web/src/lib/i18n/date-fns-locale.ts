import type { Locale } from "date-fns/locale";
import {
  az,
  de,
  el,
  enUS,
  es,
  fr,
  hi,
  id,
  it,
  ja,
  ko,
  mk,
  nl,
  pl,
  ptBR,
  ru,
  tr,
  uk,
  vi,
  zhCN,
} from "date-fns/locale";

// Maps each app locale to its matching date-fns locale so date-fns-backed UI
// (the date-picker calendar) localizes month captions, weekday names, and
// screen-reader date labels alongside the rest of the interface.
const dateFnsLocales: Record<string, Locale> = {
  "az-AZ": az,
  "de-DE": de,
  "el-GR": el,
  "en-US": enUS,
  "es-ES": es,
  "fr-FR": fr,
  "hi-IN": hi,
  "id-ID": id,
  "it-IT": it,
  "ja-JP": ja,
  "ko-KR": ko,
  "mk-MK": mk,
  "nl-NL": nl,
  "pl-PL": pl,
  "pt-BR": ptBR,
  "ru-RU": ru,
  "tr-TR": tr,
  "uk-UA": uk,
  "vi-VN": vi,
  "zh-CN": zhCN,
};

/**
 * Resolves a date-fns locale from an app language tag, falling back to the
 * bare language subtag (e.g. "pl" -> "pl-PL") and finally to en-US so an
 * unknown value never leaves the calendar untranslated with a hard error.
 */
export function resolveDateFnsLocale(language?: string): Locale {
  const tag = language || "en-US";
  const exact = dateFnsLocales[tag];
  if (exact) {
    return exact;
  }

  const base = tag.split("-")[0]?.toLowerCase();
  if (base) {
    const match = Object.entries(dateFnsLocales).find(([key]) =>
      key.toLowerCase().startsWith(`${base}-`),
    );
    if (match) {
      return match[1];
    }
  }

  return enUS;
}
