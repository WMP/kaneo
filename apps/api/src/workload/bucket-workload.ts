// Pure date-bucketing math for the workspace workload view, kept free of any
// database access so it can be unit tested directly.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

// A single request can never ask for more than this many weekly buckets,
// which bounds both the response size and the per-task loop below.
export const MAX_WEEK_BUCKETS = 53;

export type WeekBucket = {
  /** Inclusive start of the bucket, at UTC midnight. */
  start: Date;
  /** Exclusive end of the bucket (start + 7 days). */
  end: Date;
};

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Fixed 7-day windows starting at `from`'s day, covering through at least
 * `to`'s day. Because buckets are anchored to `from` rather than the
 * calendar week, the final bucket can run a few days past `to` to complete a
 * full week; callers that need the exact requested end should clip against
 * it themselves.
 *
 * Throws a RangeError for an invalid or reversed range, or one that would
 * need more than `MAX_WEEK_BUCKETS` buckets.
 */
export function buildWeekBuckets(from: Date, to: Date): WeekBucket[] {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new RangeError("`from` and `to` must be valid dates");
  }

  const start = startOfUtcDay(from);
  const end = startOfUtcDay(to);

  if (end < start) {
    throw new RangeError("`to` must not be before `from`");
  }

  const buckets: WeekBucket[] = [];
  let cursor = start;
  while (cursor <= end) {
    if (buckets.length >= MAX_WEEK_BUCKETS) {
      throw new RangeError(
        `Range too large: at most ${MAX_WEEK_BUCKETS} weekly buckets are supported`,
      );
    }
    const bucketEnd = new Date(cursor.getTime() + WEEK_MS);
    buckets.push({ start: cursor, end: bucketEnd });
    cursor = bucketEnd;
  }

  return buckets;
}

export type WorkloadTaskInput = {
  assigneeId: string | null;
  startDate: Date | null;
  dueDate: Date | null;
};

export type WorkloadRow = {
  assigneeId: string | null;
  /** One count per bucket, aligned by index with the `buckets` argument. */
  counts: number[];
};

/**
 * Groups tasks by assignee (`null` for unassigned) and counts, per bucket,
 * how many are "active" there: a task's span runs from its start date to its
 * due date inclusive, or is a single day when only one of the two is set. A
 * task with neither date never contributes and is silently skipped, so
 * callers may pass the raw, unfiltered task list.
 */
export function bucketizeWorkload(
  tasks: WorkloadTaskInput[],
  buckets: WeekBucket[],
): WorkloadRow[] {
  const firstBucket = buckets[0];
  const lastBucket = buckets[buckets.length - 1];
  if (!firstBucket || !lastBucket) {
    return [];
  }

  const overallStart = firstBucket.start;
  const overallEnd = lastBucket.end;
  const rows = new Map<string | null, number[]>();

  for (const task of tasks) {
    const rawStart = task.startDate ?? task.dueDate;
    const rawEnd = task.dueDate ?? task.startDate;
    if (!rawStart || !rawEnd) continue;

    // Dates are day-granular; normalize so a due date exactly on a bucket
    // boundary still counts as active through the end of that day.
    const spanStartDay =
      rawStart <= rawEnd ? startOfUtcDay(rawStart) : startOfUtcDay(rawEnd);
    const spanEndExclusive = new Date(
      (rawStart <= rawEnd
        ? startOfUtcDay(rawEnd)
        : startOfUtcDay(rawStart)
      ).getTime() + DAY_MS,
    );

    if (spanEndExclusive <= overallStart || spanStartDay >= overallEnd) {
      continue; // Outside the requested range entirely.
    }

    const key = task.assigneeId;
    let counts = rows.get(key);
    if (!counts) {
      counts = new Array(buckets.length).fill(0);
      rows.set(key, counts);
    }

    for (const [i, bucket] of buckets.entries()) {
      if (spanStartDay < bucket.end && spanEndExclusive > bucket.start) {
        counts[i] = (counts[i] ?? 0) + 1;
      }
    }
  }

  return Array.from(rows.entries()).map(([assigneeId, counts]) => ({
    assigneeId,
    counts,
  }));
}
