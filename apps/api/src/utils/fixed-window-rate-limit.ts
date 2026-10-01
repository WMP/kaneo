// A small fixed-window limiter kept in this process's memory: enough for a
// single instance without Redis. With several instances each keeps its own
// counters, so the effective limit is `max` per instance. Windows start at the
// first hit of a key and expire on their own; the map is swept when it grows,
// at most once per window, so a flood of distinct keys cannot make every hit
// walk the whole map.

type Bucket = { count: number; resetAt: number };

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

const SWEEP_THRESHOLD = 1000;

export function createFixedWindowRateLimiter({
  windowMs,
  max,
}: {
  windowMs: number;
  max: number;
}) {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Number.NEGATIVE_INFINITY;

  function sweep(now: number) {
    lastSweep = now;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return {
    // Counts one attempt for `key`; refused once the window holds `max`.
    hit(key: string, now: number = Date.now()): RateLimitResult {
      if (buckets.size >= SWEEP_THRESHOLD && now - lastSweep >= windowMs) {
        sweep(now);
      }
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      return {
        allowed: bucket.count <= max,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.resetAt - now) / 1000),
        ),
      };
    },
    // What `hit` would answer, without counting an attempt. For a request
    // that must pass several limits: ask all of them, then `hit` all of them.
    peek(key: string, now: number = Date.now()): RateLimitResult {
      const bucket = buckets.get(key);
      const live = bucket && bucket.resetAt > now ? bucket : undefined;
      return {
        allowed: (live?.count ?? 0) + 1 <= max,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(((live?.resetAt ?? now + windowMs) - now) / 1000),
        ),
      };
    },
    reset() {
      buckets.clear();
    },
    get size() {
      return buckets.size;
    },
  };
}
