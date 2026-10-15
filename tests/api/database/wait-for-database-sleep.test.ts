import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForDatabase } from "../../../apps/api/src/database/wait-for-database";

describe("waitForDatabase default sleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits the retry delay in real time between attempts when no sleep is injected", async () => {
    const query = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("starting up"))
      .mockResolvedValueOnce(undefined);

    const done = waitForDatabase({ query, retryDelayMs: 1_000 });
    let settled = false;
    void done.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(query).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(query).toHaveBeenCalledTimes(2);
  });
});
