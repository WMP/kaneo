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

// Exported so the tasks-drill-through controller can normalize its own
// (non-bucketed) date range the same way.
export function startOfUtcDay(date: Date): Date {
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

export type WorkloadTaskAssignee = {
  userId: string;
  /** Percent allocation (`ganttpro_task_assignment.units`); default 100. */
  units: number;
};

export type WorkloadTaskInput = {
  /** Every current assignee row for this task; empty means unassigned. */
  assignees: WorkloadTaskAssignee[];
  startDate: Date | null;
  dueDate: Date | null;
};

export type WorkloadRow = {
  assigneeId: string | null;
  /** One count per bucket, aligned by index with the `buckets` argument. */
  counts: number[];
};

/**
 * Groups tasks by assignee (`null` for unassigned) and sums, per bucket, each
 * assignee's fractional *share* of the tasks "active" there: a task's span
 * runs from its start date to its due date inclusive, or is a single day
 * when only one of the two is set. A task with neither date never
 * contributes and is silently skipped, so callers may pass the raw,
 * unfiltered task list.
 *
 * A task with several assignees splits its per-bucket contribution across
 * them weighted by `units` (share = units / sum(units) for that task, so
 * all-default units of 100 collapse to an even 1/N split); a task's total
 * contribution to a bucket it overlaps is always 1, distributed across its
 * assignees. A task with no assignees contributes its full 1 to the
 * unassigned (`null`) row instead.
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

    // Unassigned: the task's full weight of 1 goes to the null row, same as
    // before assignees were split out.
    const shares: Array<{ key: string | null; share: number }> =
      task.assignees.length === 0
        ? [{ key: null, share: 1 }]
        : (() => {
            const totalUnits = task.assignees.reduce(
              (sum, assignee) => sum + assignee.units,
              0,
            );
            return task.assignees.map((assignee) => ({
              key: assignee.userId,
              share:
                totalUnits > 0
                  ? assignee.units / totalUnits
                  : 1 / task.assignees.length,
            }));
          })();

    for (const { key, share } of shares) {
      let counts = rows.get(key);
      if (!counts) {
        counts = new Array(buckets.length).fill(0);
        rows.set(key, counts);
      }

      for (const [i, bucket] of buckets.entries()) {
        if (spanStartDay < bucket.end && spanEndExclusive > bucket.start) {
          counts[i] = (counts[i] ?? 0) + share;
        }
      }
    }
  }

  return Array.from(rows.entries()).map(([assigneeId, counts]) => ({
    assigneeId,
    counts,
  }));
}
