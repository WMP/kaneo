import { describe, expect, it, vi } from "vitest";
import {
  isRetryableTransactionError,
  isUniqueViolation,
  pgErrorCode,
} from "../../../apps/api/src/utils/pg-error";
import { retryTransaction } from "../../../apps/api/src/utils/retry-transaction";
import { runIndependently } from "../../../apps/api/src/utils/run-independently";

const pgError = (code: string) => Object.assign(new Error("pg"), { code });
const wrapped = (code: string) =>
  Object.assign(new Error("Failed query"), { cause: pgError(code) });

describe("pg error classification", () => {
  it("reads the SQLSTATE whether it is thrown as is or wrapped", () => {
    expect(pgErrorCode(pgError("23505"))).toBe("23505");
    expect(pgErrorCode(wrapped("40P01"))).toBe("40P01");
    expect(pgErrorCode(new Error("plain"))).toBeUndefined();
    expect(
      pgErrorCode(Object.assign(new Error("x"), { code: "ECONNRESET" })),
    ).toBe(undefined);
    expect(pgErrorCode(undefined)).toBeUndefined();
  });

  it("tells a unique violation and the retryable failures apart", () => {
    expect(isUniqueViolation(wrapped("23505"))).toBe(true);
    expect(isUniqueViolation(pgError("40P01"))).toBe(false);
    expect(isRetryableTransactionError(pgError("40P01"))).toBe(true);
    expect(isRetryableTransactionError(wrapped("40001"))).toBe(true);
    expect(isRetryableTransactionError(pgError("23505"))).toBe(false);
  });
});

describe("retryTransaction", () => {
  const fast = { backoffMs: 0 };

  it("returns the result without retrying when the first attempt works", async () => {
    const run = vi.fn().mockResolvedValue("done");
    expect(await retryTransaction(run, fast)).toBe("done");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs again after a deadlock and after a serialization failure", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(wrapped("40P01"))
      .mockRejectedValueOnce(pgError("40001"))
      .mockResolvedValue("done");
    expect(await retryTransaction(run, fast)).toBe("done");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("gives up after three attempts and throws the last error", async () => {
    const error = wrapped("40P01");
    const run = vi.fn().mockRejectedValue(error);
    await expect(retryTransaction(run, fast)).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("does not retry any other error", async () => {
    const error = pgError("23505");
    const run = vi.fn().mockRejectedValue(error);
    await expect(retryTransaction(run, fast)).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("runIndependently", () => {
  it("runs every step, logs each failure and throws the first", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = new Error("first");
    const second = new Error("second");
    const ran: string[] = [];
    await expect(
      runIndependently([
        [
          "A",
          async () => {
            ran.push("A");
            throw first;
          },
        ],
        [
          "B",
          async () => {
            ran.push("B");
          },
        ],
        [
          "C",
          async () => {
            ran.push("C");
            throw second;
          },
        ],
      ]),
    ).rejects.toBe(first);
    expect(ran).toEqual(["A", "B", "C"]);
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it("resolves when every step works", async () => {
    await expect(
      runIndependently([["A", async () => undefined]]),
    ).resolves.toBeUndefined();
  });
});
