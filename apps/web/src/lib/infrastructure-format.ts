import { formatDate } from "@/lib/format";

// Dates of the infrastructure API are date-only strings (YYYY-MM-DD). They are
// read as UTC midnight, so they are formatted in UTC: a local time zone would
// move the day.
export function formatInfraDate(value: string): string {
  return formatDate(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Date-only strings sort like dates.
export function isBeforeDay(date: string | null, today: string | undefined) {
  return Boolean(date && today && date < today);
}

// A VM name for a copied row: "billing-db-1" becomes "billing-db-2", "web"
// becomes "web-2"; the first free number among `taken` wins.
export function nextVmName(name: string, taken: string[]): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const match = /^(.*?)-(\d+)$/.exec(trimmed);
  const base = match ? match[1] : trimmed;
  let n = match ? Number(match[2]) + 1 : 2;
  const used = new Set(taken.map((item) => item.trim()));
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
