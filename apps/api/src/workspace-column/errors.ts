import type { HTTPException } from "hono/http-exception";
import { codedError } from "../utils/coded-error";

// JSON `{ code, message }` errors of the workspace column API and of the
// project column routes it locks, so a client branches on the code.
export const WORKSPACE_COLUMN_ERROR_CODES = {
  enforced: "WORKSPACE_COLUMNS_ENFORCED",
  empty: "WORKSPACE_COLUMNS_EMPTY",
  notEmpty: "WORKSPACE_COLUMN_NOT_EMPTY",
  last: "WORKSPACE_COLUMN_LAST",
  slugConflict: "WORKSPACE_COLUMN_SLUG_CONFLICT",
  reservedSlug: "WORKSPACE_COLUMN_RESERVED_SLUG",
} as const;

export function workspaceColumnError(
  status: 400 | 404 | 409,
  code: string,
  message: string,
): HTTPException {
  return codedError(status, code, message);
}

export function columnsEnforcedError(): HTTPException {
  return workspaceColumnError(
    409,
    WORKSPACE_COLUMN_ERROR_CODES.enforced,
    "The workspace enforces its columns. Change them in the workspace workflow settings.",
  );
}
