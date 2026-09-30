// Helpers shared by the email copy lookups (workspace invitation, member added):
// which catalog entry a locale gets, and how `{{key}}` placeholders are filled.

// The entry whose language prefix matches the locale ("de-DE" -> "de"), else
// the `fallback` entry. `catalog` is keyed by lower-case language code.
export function pickEmailCopy<T>(
  catalog: Record<string, T>,
  fallback: string,
  locale?: string | null,
): T {
  const normalized = locale?.toLowerCase();
  if (normalized) {
    for (const [language, copy] of Object.entries(catalog)) {
      if (normalized.startsWith(language)) return copy;
    }
  }
  return catalog[fallback] as T;
}

// Replaces `{{key}}` with `values[key]`, unknown keys with nothing.
export function fillEmailCopy(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return values[key] ?? "";
  });
}
