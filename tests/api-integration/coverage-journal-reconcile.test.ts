import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import { reconcileMigrationJournal } from "../../apps/api/src/utils/adopt-existing-database";
import { resetTestDatabase } from "./helpers/database";

// reconcileMigrationJournal on small synthetic journals. Each scenario works
// inside a transaction that is rolled back, so the shared test database keeps
// its real migration records. Drizzle's bookkeeping table is the only thing it
// may write (docs/agent-guide/database.md, "How migrations apply").

class Rollback extends Error {}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function inRollback(scenario: (tx: Tx) => Promise<void>) {
  let failure: { error: unknown } | null = null;
  try {
    await db.transaction(async (tx) => {
      try {
        await scenario(tx);
      } catch (error) {
        failure = { error };
      }
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  if (failure) throw (failure as { error: unknown }).error;
}

const folders: string[] = [];

function folderWith(tags: { tag: string; when: number; sql: string }[]) {
  const folder = mkdtempSync(join(tmpdir(), "kaneo-journal-"));
  folders.push(folder);
  mkdirSync(join(folder, "meta"));
  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: tags.map((entry, idx) => ({
        idx,
        version: "7",
        when: entry.when,
        tag: entry.tag,
        breakpoints: true,
      })),
    }),
  );
  for (const entry of tags) {
    writeFileSync(join(folder, `${entry.tag}.sql`), entry.sql);
  }
  return folder;
}

async function recorded(tx: Tx) {
  const result = await tx.execute<{ hash: string; created_at: string }>(
    sql`SELECT hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at`,
  );
  return result.rows.map((row) => ({
    hash: row.hash,
    created_at: Number(row.created_at),
  }));
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

describe("reconcileMigrationJournal with synthetic journals", () => {
  it("records an upstream-only baseline for an older database and replaces unrelated rows", async () => {
    const folder = folderWith([
      { tag: "0049_first", when: 1000, sql: "SELECT 1;" },
      { tag: "0050_resumable_github_import", when: 2000, sql: "SELECT 2;" },
    ]);
    await inRollback(async (tx) => {
      await tx.execute(sql`DELETE FROM "drizzle"."__drizzle_migrations"`);
      await tx.execute(
        sql`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ('stale', 5), ('also-stale', NULL)`,
      );

      await reconcileMigrationJournal(folder, tx);

      const sha = (text: string) =>
        createHash("sha256").update(text).digest("hex");
      expect(await recorded(tx)).toEqual([
        { hash: sha("SELECT 1;"), created_at: 1000 },
        { hash: sha("SELECT 2;"), created_at: 2000 },
      ]);

      // A second run finds a baseline row recorded and changes nothing.
      await reconcileMigrationJournal(folder, tx);
      expect(await recorded(tx)).toHaveLength(2);
    });
  });

  it("leaves the records alone when the journal has no cutoff entry", async () => {
    const folder = folderWith([
      { tag: "0001_other", when: 1000, sql: "SELECT 1;" },
    ]);
    await inRollback(async (tx) => {
      await tx.execute(sql`DELETE FROM "drizzle"."__drizzle_migrations"`);
      await tx.execute(
        sql`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ('keep', 5)`,
      );

      await reconcileMigrationJournal(folder, tx);

      expect(await recorded(tx)).toEqual([{ hash: "keep", created_at: 5 }]);
    });
  });

  it("does nothing on a database that has no account table", async () => {
    const folder = folderWith([
      { tag: "0050_resumable_github_import", when: 2000, sql: "SELECT 2;" },
    ]);
    await inRollback(async (tx) => {
      await tx.execute(sql`DROP TABLE account CASCADE`);
      await tx.execute(sql`DELETE FROM "drizzle"."__drizzle_migrations"`);

      await reconcileMigrationJournal(folder, tx);

      expect(await recorded(tx)).toEqual([]);
    });
  });
});
