import { useCallback, useMemo, useState } from "react";
import { matchesSearch } from "@/lib/search-match";

/**
 * Search state for a picker list. Filters over the whole list (not only what
 * a list renders incrementally), case- and diacritics-insensitively.
 * `getText` should return everything a person may type to find the item.
 */
export function usePickerSearch<T>(
  items: readonly T[] | undefined,
  getText: (item: T) => string,
) {
  const [query, setQuery] = useState("");
  const isSearching = query.trim().length > 0;

  const filtered = useMemo(() => {
    const source = items ?? [];
    if (!isSearching) return source;
    return source.filter((item) => matchesSearch(getText(item), query));
  }, [items, query, isSearching, getText]);

  const reset = useCallback(() => setQuery(""), []);

  return { query, setQuery, isSearching, filtered, reset };
}
