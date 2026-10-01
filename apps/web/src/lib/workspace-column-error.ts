import { readCode } from "@/lib/workspace-role-error";

// Errors of the workspace column routes, and of the project column routes they
// lock, answer JSON `{ code, message }` (the fetchers throw them through
// `readProjectApiError`, which keeps the `code`). The codes a person can act on
// map to translated copy; the API's English message is never shown. Static keys
// keep the i18n checker able to see every string in use.
const ERROR_KEYS_BY_CODE = {
  WORKSPACE_COLUMNS_ENFORCED: "settings:workspaceWorkflow.errors.enforced",
  WORKSPACE_COLUMNS_EMPTY: "settings:workspaceWorkflow.errors.empty",
  WORKSPACE_COLUMN_NOT_EMPTY: "settings:workspaceWorkflow.errors.notEmpty",
  WORKSPACE_COLUMN_LAST: "settings:workspaceWorkflow.errors.last",
  WORKSPACE_COLUMN_SLUG_CONFLICT:
    "settings:workspaceWorkflow.errors.slugConflict",
  WORKSPACE_COLUMN_RESERVED_SLUG:
    "settings:workspaceWorkflow.errors.reservedSlug",
} as const;

export const WORKSPACE_COLUMNS_ENFORCED = "WORKSPACE_COLUMNS_ENFORCED";
export const WORKSPACE_COLUMN_NOT_EMPTY = "WORKSPACE_COLUMN_NOT_EMPTY";

/** The `code` of a failed workspace column request, when the API sent one. */
export function getWorkspaceColumnErrorCode(
  error: unknown,
): string | undefined {
  return readCode(error);
}

/** Translated text for a known code, else `fallbackKey`. */
export function getWorkspaceColumnErrorMessage(
  error: unknown,
  t: (key: string) => string,
  fallbackKey: string,
): string {
  const code = readCode(error);
  if (code && Object.hasOwn(ERROR_KEYS_BY_CODE, code)) {
    return t(ERROR_KEYS_BY_CODE[code as keyof typeof ERROR_KEYS_BY_CODE]);
  }
  return t(fallbackKey);
}
