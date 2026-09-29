import * as Sentry from "@sentry/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { useConnectivityStore } from "@/store/connectivity";

vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));

const { default: queryClient } = await import("./index");

afterEach(() => {
  vi.mocked(Sentry.captureException).mockClear();
  queryClient.clear();
  useConnectivityStore.setState({
    browserOffline: false,
    serverUnreachable: false,
    hasReachedServer: false,
  });
});

type RetryFn = (failureCount: number, error: unknown) => boolean;

describe("queryClient connectivity handling", () => {
  it("does not retry a request that got no response", () => {
    const retry = queryClient.getDefaultOptions().queries?.retry as RetryFn;
    expect(retry(0, new TypeError("Failed to fetch"))).toBe(false);
  });

  it("does not retry a 403, which asking again cannot change", () => {
    const retry = queryClient.getDefaultOptions().queries?.retry as RetryFn;
    expect(retry(0, new HttpError(403, "No access to the project"))).toBe(
      false,
    );
  });

  it("still retries an API error whose message merely says 'Failed to fetch …'", () => {
    // The server answered (HTTP 500); the old substring match treated this as
    // a network failure and skipped the retry.
    const retry = queryClient.getDefaultOptions().queries?.retry as RetryFn;
    expect(retry(0, new HttpError(500, "Failed to fetch tasks"))).toBe(true);
  });

  it("marks the server unreachable when a query gets no response, and reachable again on the next success", async () => {
    await expect(
      queryClient.fetchQuery({
        queryKey: ["connectivity-test", "down"],
        queryFn: () => Promise.reject(new TypeError("Failed to fetch")),
      }),
    ).rejects.toThrow("Failed to fetch");
    expect(useConnectivityStore.getState().serverUnreachable).toBe(true);

    await queryClient.fetchQuery({
      queryKey: ["connectivity-test", "up"],
      queryFn: () => Promise.resolve("ok"),
    });
    expect(useConnectivityStore.getState()).toMatchObject({
      serverUnreachable: false,
      hasReachedServer: true,
    });
  });

  it("treats an API error response as proof the server is reachable", async () => {
    useConnectivityStore.getState().markServerUnreachable();
    await expect(
      queryClient.fetchQuery({
        queryKey: ["connectivity-test", "api-error"],
        queryFn: () => Promise.reject(new HttpError(404, "Not found")),
        retry: false,
      }),
    ).rejects.toThrow("Not found");
    expect(useConnectivityStore.getState().serverUnreachable).toBe(false);
  });

  it("does not report the 403 of a probe that expects it, but still reports other failures of it", async () => {
    await expect(
      queryClient.fetchQuery({
        queryKey: ["probe", "forbidden"],
        queryFn: () => Promise.reject(new HttpError(403, "No access")),
        meta: { expectForbidden: true },
        retry: false,
      }),
    ).rejects.toThrow("No access");
    expect(Sentry.captureException).not.toHaveBeenCalled();

    await expect(
      queryClient.fetchQuery({
        queryKey: ["probe", "broken"],
        queryFn: () => Promise.reject(new HttpError(500, "boom")),
        meta: { expectForbidden: true },
        retry: false,
      }),
    ).rejects.toThrow("boom");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("reports an unexpected 403", async () => {
    await expect(
      queryClient.fetchQuery({
        queryKey: ["other", "forbidden"],
        queryFn: () => Promise.reject(new HttpError(403, "No access")),
        retry: false,
      }),
    ).rejects.toThrow("No access");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
