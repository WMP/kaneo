import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./use-debounced-value";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedValue", () => {
  it("follows the value only after it stayed the same for the delay", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 250),
      { initialProps: { value: "a" } },
    );
    expect(result.current).toBe("a");

    rerender({ value: "ab" });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe("a");
    rerender({ value: "abc" });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe("a");
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(result.current).toBe("abc");
  });

  it("applies the value at once when the reset key changes, so a stale value never outlives a reset", () => {
    const { result, rerender } = renderHook(
      ({ value, open }) => useDebouncedValue(value, 250, open),
      { initialProps: { value: "old text", open: true } },
    );
    expect(result.current).toBe("old text");

    // The dialog closes and opens again with nothing typed.
    rerender({ value: "", open: false });
    rerender({ value: "", open: true });

    expect(result.current).toBe("");
  });
});
