// A task's short id is its project key plus the task number, e.g. "DEP-23".
// Project keys come from `generateProjectSlug`, which follows the same Unicode
// rules as `toSlug`, so a key can be "ПА" or "测试项" and not only A-Z. Matching
// on ASCII alone left those projects without the "type the task key to jump to
// it" path.
export const TASK_SHORT_ID_PATTERN = /^(\p{L}[\p{L}\p{N}\p{M}_-]*)-(\d+)$/u;

// A bare project key ("DC") or a key with a trailing dash ("DC-", typed on the
// way to "DC-1"). It follows the slug part of `TASK_SHORT_ID_PATTERN`.
const PROJECT_KEY_PATTERN = /^\p{L}[\p{L}\p{N}\p{M}_-]*$/u;

/**
 * The project key a search query names, or `null`. The query is NFKC-normalized
 * and trimmed like a stored key, and one trailing "-" is dropped.
 */
export function parseProjectKeyQuery(query: string): string | null {
  const normalized = query.normalize("NFKC").trim();
  const key = normalized.endsWith("-") ? normalized.slice(0, -1) : normalized;
  return PROJECT_KEY_PATTERN.test(key) ? key : null;
}
