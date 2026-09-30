import type { Context, Next } from "hono";
import { codedError } from "../utils/coded-error";
import { createFixedWindowRateLimiter } from "../utils/fixed-window-rate-limit";

// The user directory answers "does an account with this name or email exist",
// so it is rate limited per user on every instance (not only on cloud): a
// typeahead needs a few requests per second at most, enumeration needs many.
// Counters live in this process (no Redis), so with several instances the limit
// is per instance.
export const userDirectoryRateLimiter = createFixedWindowRateLimiter({
  windowMs: 60_000,
  max: 120,
});

// Route middleware, placed after the permission check so refused requests do
// not use up the budget.
export async function requireUserDirectoryRateLimit(c: Context, next: Next) {
  const result = userDirectoryRateLimiter.hit(c.get("userId"));
  if (!result.allowed) {
    throw codedError(
      429,
      "RATE_LIMITED",
      "Too many searches, try again in a moment.",
      { "Retry-After": String(result.retryAfterSeconds) },
    );
  }
  return next();
}
