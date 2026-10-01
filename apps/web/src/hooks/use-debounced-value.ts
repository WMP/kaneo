import { useEffect, useState } from "react";

/**
 * `value`, but only after it stayed the same for `delayMs`. When `resetKey`
 * changes (a dialog opened again) the current value applies at once, so a
 * stale value from before never outlives the reset.
 */
export function useDebouncedValue<T>(
  value: T,
  delayMs: number,
  resetKey?: unknown,
): T {
  const [state, setState] = useState({ value, resetKey });
  const isReset = !Object.is(state.resetKey, resetKey);
  if (isReset) setState({ value, resetKey });

  useEffect(() => {
    const timer = setTimeout(
      () => setState((current) => ({ ...current, value })),
      delayMs,
    );
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return isReset ? value : state.value;
}
