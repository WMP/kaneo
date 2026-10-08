import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInvalidationBatcher,
  INVALIDATION_COALESCE_MS,
} from "./coalesced-invalidation";

type Call = { aborted: boolean; resolve: (value: string) => void };

// A tasks-like query that holds data (a revisit, or a cache another view
// filled) and whose fetch stays in flight until the test resolves it.
function setup(key: readonly unknown[] = ["tasks", "p"]) {
  const client = new QueryClient();
  const calls: Call[] = [];
  const queryFn = ({ signal }: { signal: AbortSignal }) =>
    new Promise<string>((resolve, reject) => {
      const call: Call = { aborted: false, resolve };
      signal.addEventListener("abort", () => {
        call.aborted = true;
        reject(new Error("aborted"));
      });
      calls.push(call);
    });
  client.setQueryData(key, "cached");
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn,
    staleTime: 0,
  });
  const unsubscribe = observer.subscribe(() => {});
  return { client, calls, observer, unsubscribe };
}

const aborted = (calls: Call[]) => calls.filter((call) => call.aborted).length;

describe("realtime invalidation of a query that is fetching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reproduces the abort storm: default invalidations abort the running fetch every time", async () => {
    const { client, calls, unsubscribe } = setup();
    expect(calls).toHaveLength(1); // the mount fetch is in flight

    for (let i = 0; i < 5; i++) {
      void client.invalidateQueries({ queryKey: ["tasks", "p"] });
      await vi.advanceTimersByTimeAsync(150);
    }

    // Five invalidations: five aborted requests, five restarts, and the only
    // request left running is the sixth. Nothing ever completed.
    expect(aborted(calls)).toBe(5);
    expect(calls).toHaveLength(6);
    unsubscribe();
  });

  it("does not abort the running fetch and lets it complete", async () => {
    const { client, calls, observer, unsubscribe } = setup();
    const batcher = createInvalidationBatcher(client);

    for (let i = 0; i < 5; i++) {
      batcher.invalidate(["tasks", "p"]);
      await vi.advanceTimersByTimeAsync(150);
    }

    expect(aborted(calls)).toBe(0);
    expect(calls).toHaveLength(1);

    calls[0].resolve("first");
    await vi.advanceTimersByTimeAsync(0);
    expect(observer.getCurrentResult().data).toBe("first");
    batcher.dispose();
    unsubscribe();
  });

  it("refetches once after the running fetch so a change made mid-fetch is picked up", async () => {
    const { client, calls, observer, unsubscribe } = setup();
    const batcher = createInvalidationBatcher(client);

    batcher.invalidate(["tasks", "p"]);
    await vi.advanceTimersByTimeAsync(INVALIDATION_COALESCE_MS);
    expect(calls).toHaveLength(1); // deferred, not started and not aborted

    calls[0].resolve("before the change");
    await vi.advanceTimersByTimeAsync(0);

    // The invalidation was applied after the fetch settled: one more request.
    expect(calls).toHaveLength(2);
    expect(aborted(calls)).toBe(0);
    calls[1].resolve("after the change");
    await vi.advanceTimersByTimeAsync(0);
    expect(observer.getCurrentResult().data).toBe("after the change");
    expect(calls).toHaveLength(2);
    batcher.dispose();
    unsubscribe();
  });

  it("coalesces a burst on an idle query into one refetch per key", async () => {
    const { client, calls, observer, unsubscribe } = setup();
    calls[0].resolve("loaded");
    await vi.advanceTimersByTimeAsync(0);
    expect(observer.getCurrentResult().fetchStatus).toBe("idle");

    const batcher = createInvalidationBatcher(client);
    for (let i = 0; i < 20; i++) batcher.invalidate(["tasks", "p"]);
    expect(calls).toHaveLength(1); // nothing before the window closes
    await vi.advanceTimersByTimeAsync(INVALIDATION_COALESCE_MS);

    expect(calls).toHaveLength(2);
    expect(aborted(calls)).toBe(0);
    batcher.dispose();
    unsubscribe();
  });

  it("invalidates each distinct key once", async () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const batcher = createInvalidationBatcher(client);

    batcher.invalidate(["tasks", "a"]);
    batcher.invalidate(["tasks", "b"]);
    batcher.invalidate(["tasks", "a"]);
    await vi.advanceTimersByTimeAsync(INVALIDATION_COALESCE_MS);

    const keys = spy.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual([
      ["tasks", "a"],
      ["tasks", "b"],
    ]);
    for (const [, options] of spy.mock.calls) {
      expect(options).toEqual({ cancelRefetch: false });
    }
    batcher.dispose();
  });

  it("applies what is pending when disposed, and then stops", async () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const batcher = createInvalidationBatcher(client);

    batcher.invalidate(["tasks", "a"]);
    batcher.dispose();
    expect(spy).toHaveBeenCalledTimes(1);

    batcher.invalidate(["tasks", "b"]);
    await vi.advanceTimersByTimeAsync(INVALIDATION_COALESCE_MS);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
