import { isRetryableTransactionError } from "./pg-error";

export const MAX_TRANSACTION_ATTEMPTS = 3;

// Runs a whole transaction (`run` opens it) again when the server rolled it back
// because of a deadlock (`40P01`) or a serialization failure (`40001`), at most
// `attempts` times in total. Any other error, and the last retryable one, is
// thrown as is. `run` must have no effect outside the transaction (publish
// events after this returns), since every attempt starts over.
export async function retryTransaction<T>(
  run: () => Promise<T>,
  {
    attempts = MAX_TRANSACTION_ATTEMPTS,
    backoffMs = 25,
  }: { attempts?: number; backoffMs?: number } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !isRetryableTransactionError(error)) {
        throw error;
      }
      // A short, jittered pause so two transactions that just deadlocked do not
      // collide again in lockstep.
      await new Promise((resolve) =>
        setTimeout(resolve, backoffMs * attempt * (0.5 + Math.random())),
      );
    }
  }
}
