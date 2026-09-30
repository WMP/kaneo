import type { Context, Next } from "hono";
import { invitationRateLimiter } from "../project-invitation/rate-limit";
import { codedError } from "../utils/coded-error";
import { createFixedWindowRateLimiter } from "../utils/fixed-window-rate-limit";
import { isCloud } from "../utils/is-cloud";

// The user directory answers "does an account with this name or email exist",
// so it is rate limited per user on every instance (not only on cloud): a
// typeahead needs a few requests per second at most, enumeration needs many.
// Counters live in this process (no Redis), so with several instances the limit
// is per instance.
export const userDirectoryRateLimiter = createFixedWindowRateLimiter({
  windowMs: 60_000,
  max: 120,
});

// Adding an existing account without an invitation notifies that person
// (in-app and by email) without their consent, so one person cannot add an
// unlimited number of accounts: 30 adds per 10 minutes per user, on every
// instance. The limit is shared by `POST /workspace/{id}/members` and the
// project member route when it adds somebody to the workspace as well.
export const DIRECT_ADD_LIMIT = { windowMs: 10 * 60_000, max: 30 } as const;
export const directAddRateLimiter =
  createFixedWindowRateLimiter(DIRECT_ADD_LIMIT);

function rateLimited(retryAfterSeconds: number, message: string) {
  return codedError(429, "RATE_LIMITED", message, {
    "Retry-After": String(retryAfterSeconds),
  });
}

// Route middleware, placed after the permission check so refused requests do
// not use up the budget.
export async function requireUserDirectoryRateLimit(c: Context, next: Next) {
  const result = userDirectoryRateLimiter.hit(c.get("userId"));
  if (!result.allowed) {
    throw rateLimited(
      result.retryAfterSeconds,
      "Too many searches, try again in a moment.",
    );
  }
  return next();
}

// One attempt to add somebody to a workspace: the limit of adds on every
// instance and, on cloud, the limit of invitations (5 per minute, shared with
// creating and re-sending invitations) exactly as for the workspace route.
export function consumeAddRateLimits(userId: string): void {
  const adds = directAddRateLimiter.hit(userId);
  if (!adds.allowed) {
    throw rateLimited(
      adds.retryAfterSeconds,
      "Too many people added, try again later.",
    );
  }
  if (isCloud()) {
    const invitations = invitationRateLimiter.hit(userId);
    if (!invitations.allowed) {
      throw rateLimited(
        invitations.retryAfterSeconds,
        "Too many invitations, try again later.",
      );
    }
  }
}

export async function requireAddRateLimit(c: Context, next: Next) {
  consumeAddRateLimits(c.get("userId"));
  return next();
}
