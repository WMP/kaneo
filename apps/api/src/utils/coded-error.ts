import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { errorResponse } from "../openapi";

/**
 * An error whose JSON body carries a machine-readable `code` next to the
 * message, so a client branches on the code instead of on English text. Every
 * API error answers that JSON shape (`ApiError` schema); the error handler
 * keeps the `code` of a custom JSON body such as this one.
 */
export function codedError(
  status: ContentfulStatusCode,
  code: string,
  message: string,
  headers?: Record<string, string>,
): HTTPException {
  return new HTTPException(status, {
    message,
    res: Response.json({ code, message }, { status, headers }),
  });
}

// Kept as a named wrapper so routes that raise coded errors say so; the
// documented shape is the shared `ApiError` one.
export function codedErrorResponse(description: string) {
  return errorResponse(description);
}
