import { describe, expect, it } from "vitest";
import {
  bucketizeWorkload,
  buildWeekBuckets,
  MAX_WEEK_BUCKETS,
} from "../../../apps/api/src/workload/bucket-workload";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("buildWeekBuckets", () => {
  it("builds fixed 7-day windows anchored to `from`", () => {
    const buckets = buildWeekBuckets(day("2024-01-01"), day("2024-01-15"));

    expect(buckets).toHaveLength(3);
    expect(buckets[0]).toEqual({
      start: day("2024-01-01"),
      end: day("2024-01-08"),
    });
    expect(buckets[1]).toEqual({
      start: day("2024-01-08"),
      end: day("2024-01-15"),
    });
    // `to`'s day (Jan 15) still needs a bucket even though the window only
    // needs one more day, so the last one runs a few days past `to`.
    expect(buckets[2]).toEqual({
      start: day("2024-01-15"),
      end: day("2024-01-22"),
    });
  });

  it("returns a single bucket for a same-day range", () => {
    const buckets = buildWeekBuckets(day("2024-03-01"), day("2024-03-01"));
    expect(buckets).toEqual([
      { start: day("2024-03-01"), end: day("2024-03-08") },
    ]);
  });

  it("rejects a reversed range", () => {
    expect(() =>
      buildWeekBuckets(day("2024-01-15"), day("2024-01-01")),
    ).toThrow(RangeError);
  });

  it("rejects invalid dates", () => {
    expect(() => buildWeekBuckets(new Date("nope"), day("2024-01-01"))).toThrow(
      RangeError,
    );
  });

  it("rejects a range that would need more than the max buckets", () => {
    const from = day("2024-01-01");
    const tooFar = new Date(
      from.getTime() + (MAX_WEEK_BUCKETS + 1) * 7 * 24 * 60 * 60 * 1000,
    );
    expect(() => buildWeekBuckets(from, tooFar)).toThrow(RangeError);
  });

  it("accepts a range at exactly the max bucket count", () => {
    const from = day("2024-01-01");
    const to = new Date(
      from.getTime() + (MAX_WEEK_BUCKETS - 1) * 7 * 24 * 60 * 60 * 1000,
    );
    expect(buildWeekBuckets(from, to)).toHaveLength(MAX_WEEK_BUCKETS);
  });
});

describe("bucketizeWorkload", () => {
  // Jan1-8, Jan8-15, Jan15-22: 3 buckets (the "to" day still needs its own
  // bucket, so the window runs a day past Jan 21).
  const buckets = buildWeekBuckets(day("2024-01-01"), day("2024-01-21"));

  it("counts a single-day task (only a due date) in one bucket", () => {
    const rows = bucketizeWorkload(
      [{ assigneeId: "alice", startDate: null, dueDate: day("2024-01-10") }],
      buckets,
    );

    expect(rows).toEqual([{ assigneeId: "alice", counts: [0, 1, 0] }]);
  });

  it("counts a single-day task (only a start date) in one bucket", () => {
    const rows = bucketizeWorkload(
      [{ assigneeId: "alice", startDate: day("2024-01-02"), dueDate: null }],
      buckets,
    );

    expect(rows).toEqual([{ assigneeId: "alice", counts: [1, 0, 0] }]);
  });

  it("counts a multi-week task in every bucket it spans", () => {
    const rows = bucketizeWorkload(
      [
        {
          assigneeId: "bob",
          startDate: day("2024-01-05"),
          dueDate: day("2024-01-16"),
        },
      ],
      buckets,
    );

    // Jan 5-16 touches buckets 0 (Jan1-8), 1 (Jan8-15) and 2 (Jan15-22).
    expect(rows).toEqual([{ assigneeId: "bob", counts: [1, 1, 1] }]);
  });

  it("groups tasks with no assignee under the null key", () => {
    const rows = bucketizeWorkload(
      [{ assigneeId: null, startDate: null, dueDate: day("2024-01-03") }],
      buckets,
    );

    expect(rows).toEqual([{ assigneeId: null, counts: [1, 0, 0] }]);
  });

  it("skips a task with neither date", () => {
    const rows = bucketizeWorkload(
      [{ assigneeId: "alice", startDate: null, dueDate: null }],
      buckets,
    );

    expect(rows).toEqual([]);
  });

  it("skips a task entirely outside the bucketed range", () => {
    const rows = bucketizeWorkload(
      [
        {
          assigneeId: "alice",
          startDate: day("2024-05-01"),
          dueDate: day("2024-05-02"),
        },
      ],
      buckets,
    );

    expect(rows).toEqual([]);
  });

  it("tolerates a due date stored before the start date", () => {
    const rows = bucketizeWorkload(
      [
        {
          assigneeId: "alice",
          startDate: day("2024-01-10"),
          dueDate: day("2024-01-03"),
        },
      ],
      buckets,
    );

    // Jan 3-10 touches buckets 0 and 1.
    expect(rows).toEqual([{ assigneeId: "alice", counts: [1, 1, 0] }]);
  });

  it("sums multiple assignees and multiple tasks independently", () => {
    const rows = bucketizeWorkload(
      [
        { assigneeId: "alice", startDate: null, dueDate: day("2024-01-02") },
        { assigneeId: "alice", startDate: null, dueDate: day("2024-01-03") },
        { assigneeId: "bob", startDate: null, dueDate: day("2024-01-09") },
      ],
      buckets,
    );

    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ assigneeId: "alice", counts: [2, 0, 0] });
    expect(rows).toContainEqual({ assigneeId: "bob", counts: [0, 1, 0] });
  });

  it("returns no rows for an empty bucket list", () => {
    expect(
      bucketizeWorkload(
        [{ assigneeId: "alice", startDate: null, dueDate: day("2024-01-01") }],
        [],
      ),
    ).toEqual([]);
  });
});
