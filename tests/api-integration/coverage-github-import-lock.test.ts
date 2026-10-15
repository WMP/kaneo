import { afterEach, describe, expect, it, vi } from "vitest";
import { getDatabasePool } from "../../apps/api/src/database";
import { withGithubImportLock } from "../../apps/api/src/github-integration/import-lock";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withGithubImportLock release failure", () => {
  it("returns the result, destroys the connection whose unlock failed and frees the lock", async () => {
    const pool = getDatabasePool();
    const originalConnect = pool.connect.bind(pool);
    const released: unknown[] = [];
    vi.spyOn(pool, "connect").mockImplementationOnce((async () => {
      const client = await originalConnect();
      const query = client.query.bind(client) as (
        ...args: unknown[]
      ) => Promise<unknown>;
      const release = client.release.bind(client);
      client.query = ((text: unknown, ...rest: unknown[]) =>
        typeof text === "string" && text.includes("pg_advisory_unlock(hash")
          ? Promise.reject(new Error("unlock failed"))
          : query(text, ...rest)) as typeof client.query;
      client.release = ((error?: Error | boolean) => {
        released.push(error);
        return release(error);
      }) as typeof client.release;
      return client;
    }) as never);

    expect(
      await withGithubImportLock("project-x", async () => "imported"),
    ).toBe("imported");
    expect(released).toHaveLength(1);
    expect(released[0]).toBeInstanceOf(Error);
    expect((released[0] as Error).message).toBe("unlock failed");

    // The destroyed session released its advisory locks: the same project can
    // be imported again and the in-flight counter was decremented.
    expect(await withGithubImportLock("project-x", async () => "again")).toBe(
      "again",
    );
  });
});
