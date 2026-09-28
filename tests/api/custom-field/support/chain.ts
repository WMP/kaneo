// Minimal drizzle query-builder stand-in: any property access returns a
// function that, when called, returns the same chainable proxy, and the
// proxy resolves to `result` when awaited (drizzle's builders are
// thenable). This lets a mock satisfy any call shape — `.from().where()`,
// `.orderBy().limit()`, `.returning()`, `.onConflictDoNothing()`, etc. —
// without hard-coding which chain a given controller happens to use.
export function chain<T>(result: T): T {
  const proxy: unknown = new Proxy(() => {}, {
    get(_target, prop) {
      if (prop === "then") {
        return (
          resolve: (value: T) => void,
          reject?: (reason: unknown) => void,
        ) => Promise.resolve(result).then(resolve, reject);
      }
      return (..._args: unknown[]) => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy as T;
}
