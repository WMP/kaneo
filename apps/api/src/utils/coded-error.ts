import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { errorResponse, z } from "../openapi";

/**
 * An error whose JSON body carries a machine-readable `code` next to the
 * message, so a client branches on the code instead of on English text. The
 * shared access middleware still answers plain text; routes that use this
 * describe both shapes in their OpenAPI responses (`codedErrorResponse`).
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

export const codedErrorSchema = z
  .object({ code: z.string(), message: z.string() })
  .openapi("CodedError");

export function codedErrorResponse(description: string) {
  return {
    description,
    content: {
      "application/json": { schema: codedErrorSchema },
      ...errorResponse(description).content,
    },
  };
}
