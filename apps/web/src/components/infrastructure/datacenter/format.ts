import { formatDate } from "@/lib/format";

const TB_FROM_GB = 10_000;

const numberFormatCache = new Map<string, Intl.NumberFormat>();

function numberFormat(
  locale: string | undefined,
  maximumFractionDigits: number,
) {
  const key = `${locale ?? ""}|${maximumFractionDigits}`;
  let formatter = numberFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits });
    numberFormatCache.set(key, formatter);
  }
  return formatter;
}

/** A plain count or size, with the thousands separators of the user's locale. */
export function formatNumber(value: number, locale?: string): string {
  return numberFormat(locale, 0).format(value);
}

/**
 * Capacity in GB with thousands separators; from 10 000 GB as TB with one
 * decimal (decimal TB, as disks and nodes are sold).
 */
export function formatGb(gb: number, locale?: string): string {
  if (gb >= TB_FROM_GB) {
    return `${numberFormat(locale, 1).format(gb / 1000)} TB`;
  }
  return `${numberFormat(locale, 0).format(gb)} GB`;
}

/**
 * A date-only value (YYYY-MM-DD) as a calendar date. It is anchored at UTC and
 * formatted in UTC so it never slips a day in negative-offset time zones.
 */
export function formatDay(value: string, locale?: string): string {
  return formatDate(
    `${value.slice(0, 10)}T00:00:00Z`,
    { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" },
    locale,
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  ovh: "OVH",
  azure: "Azure",
};

/** Providers are product names; only an unknown one is left to the caller to translate. */
export function providerName(provider: string | null): string | null {
  if (provider == null) return null;
  return PROVIDER_LABELS[provider] ?? null;
}
