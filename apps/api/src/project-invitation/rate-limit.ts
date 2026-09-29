import type { Context, Next } from "hono";
import { createFixedWindowRateLimiter } from "../utils/fixed-window-rate-limit";
import { isCloud } from "../utils/is-cloud";
import { invitationError } from "./delegation";

// Creating and re-sending share one budget per user, like Better Auth's
// `/organization/invite-member` (which serves both) under
// `rateLimit.customRules` in auth.ts: 5 per 60 seconds, and only where Better
// Auth's own rate limit runs, that is on cloud. Better Auth keys by client
// address; these routes are authenticated, so the user is the key. The
// counters live in this process (no Redis needed); see the limiter.
export const invitationRateLimiter = createFixedWindowRateLimiter({
  windowMs: 60_000,
  max: 5,
});

// Route middleware, placed after the permission check so requests that would
// be refused anyway do not use up the budget. Every attempt that gets this far
// counts, accepted or not, as Better Auth counts them.
export async function requireInvitationRateLimit(c: Context, next: Next) {
  if (isCloud()) {
    const result = invitationRateLimiter.hit(c.get("userId"));
    if (!result.allowed) {
      throw invitationError(
        429,
        "RATE_LIMITED",
        "Too many invitations, try again later.",
        { "Retry-After": String(result.retryAfterSeconds) },
      );
    }
  }
  return next();
}
