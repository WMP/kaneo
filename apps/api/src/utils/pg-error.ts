// PostgreSQL error classification for code that has to react to a specific
// failure. The driver's error carries the SQLSTATE in `code`; the query layer
// may wrap it (`cause`), so the chain is followed a few levels.

export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

// `23505`: a unique constraint or index was violated.
export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === "23505";
}

// `40P01` (deadlock detected) and `40001` (serialization failure): the
// transaction was rolled back by the server and can simply be run again.
export function isRetryableTransactionError(error: unknown): boolean {
  const code = pgErrorCode(error);
  return code === "40P01" || code === "40001";
}
