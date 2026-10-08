// Letters that do not decompose under NFD but are still typed as their plain
// Latin counterpart by people without the matching keyboard layout.
const FOLDED_LETTERS: Record<string, string> = {
  ł: "l", // ł
  ø: "o", // ø
  đ: "d", // đ
  ı: "i", // dotless ı
};

/**
 * Lower-cases text and strips diacritics so "Łoś" and "los" compare equal.
 */
export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[łøđı]/g, (letter) => FOLDED_LETTERS[letter]);
}

/**
 * Whether `text` matches a picker search `query`: case- and
 * diacritics-insensitive, and every whitespace-separated word of the query
 * must appear in the text. An empty query matches everything.
 */
export function matchesSearch(text: string, query: string): boolean {
  const words = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeSearchText(text);
  return words.every((word) => haystack.includes(word));
}
