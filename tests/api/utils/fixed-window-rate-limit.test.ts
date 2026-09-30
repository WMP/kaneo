import { describe, expect, it } from "vitest";
import { createFixedWindowRateLimiter } from "../../../apps/api/src/utils/fixed-window-rate-limit";

describe("createFixedWindowRateLimiter", () => {
  it("allows `max` hits per key and window, then refuses with a retry delay", () => {
    const limiter = createFixedWindowRateLimiter({ windowMs: 60_000, max: 3 });
    const start = 1_000_000;
    expect(limiter.hit("a", start).allowed).toBe(true);
    expect(limiter.hit("a", start + 1000).allowed).toBe(true);
    expect(limiter.hit("a", start + 2000).allowed).toBe(true);
    const refused = limiter.hit("a", start + 3000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(57);
    // Refused attempts do not extend the window.
    expect(limiter.hit("a", start + 30_000).retryAfterSeconds).toBe(30);
  });

  it("keeps keys apart and starts a new window after the old one ends", () => {
    const limiter = createFixedWindowRateLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.hit("a", 0).allowed).toBe(true);
    expect(limiter.hit("a", 500).allowed).toBe(false);
    expect(limiter.hit("b", 500).allowed).toBe(true);
    expect(limiter.hit("a", 1000).allowed).toBe(true);
    expect(limiter.hit("a", 1001).allowed).toBe(false);
  });

  it("sweeps expired windows when it grows, at most once per window", () => {
    const limiter = createFixedWindowRateLimiter({ windowMs: 1000, max: 1 });
    for (let i = 0; i < 1000; i++) limiter.hit(`k${i}`, 0);
    expect(limiter.size).toBe(1000);
    // Everything is expired: the first hit past the threshold sweeps.
    limiter.hit("fresh", 5000);
    expect(limiter.size).toBe(1);

    // Grown again with entries that expire soon; a hit within the window of
    // the last sweep does not walk the map, the next window's does.
    for (let i = 0; i < 1000; i++) limiter.hit(`j${i}`, 5100);
    expect(limiter.size).toBe(1001);
    limiter.hit("early", 5900);
    expect(limiter.size).toBe(1002);
    limiter.hit("later", 6200);
    expect(limiter.size).toBe(2);
    limiter.reset();
    expect(limiter.size).toBe(0);
  });

  it("peeks without counting: what hit would answer, nothing spent", () => {
    const limiter = createFixedWindowRateLimiter({ windowMs: 60_000, max: 2 });
    for (let i = 0; i < 10; i++) {
      expect(limiter.peek("a", 0).allowed).toBe(true);
    }
    expect(limiter.size).toBe(0);
    expect(limiter.hit("a", 0).allowed).toBe(true);
    expect(limiter.peek("a", 1000).allowed).toBe(true);
    expect(limiter.hit("a", 1000).allowed).toBe(true);
    // Full: the next hit would be refused, and peek says so with the delay.
    const peeked = limiter.peek("a", 2000);
    expect(peeked.allowed).toBe(false);
    expect(peeked.retryAfterSeconds).toBe(58);
    expect(limiter.hit("a", 2000).allowed).toBe(false);
    // A new window starts clean.
    expect(limiter.peek("a", 61_000).allowed).toBe(true);
  });
});
