import { getTableName, is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { beforeAll, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import * as schema from "../../apps/api/src/database/schema";
import { ensureTestDatabaseMigrated } from "./helpers/database";

// docs/agent-guide/database.md: schema.ts and the migrations ship together.
// These tests compare the Drizzle schema with the database that the migration
// runner built, so a foreign key or id default that exists in one place only
// is detected.
const tables = Object.values(schema).filter((value): value is PgTable =>
  is(value, PgTable),
);

const ACTIONS: Record<string, string> = {
  a: "no action",
  r: "restrict",
  c: "cascade",
  n: "set null",
  d: "set default",
};

type StoredForeignKey = {
  tbl: string;
  cols: string[];
  ftbl: string;
  fcols: string[];
  del: string;
  upd: string;
};

async function storedForeignKeys() {
  const result = await db.execute<{
    tbl: string;
    cols: string[];
    ftbl: string;
    fcols: string[];
    del: string;
    upd: string;
  }>(sql`
    SELECT c.relname AS tbl,
           (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS cols,
           f.relname AS ftbl,
           (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS fcols,
           con.confdeltype::text AS del,
           con.confupdtype::text AS upd
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_class f ON f.oid = con.confrelid
    WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace
  `);
  return result.rows as StoredForeignKey[];
}

const keyOf = (fk: Pick<StoredForeignKey, "tbl" | "cols" | "ftbl" | "fcols">) =>
  `${fk.tbl}(${fk.cols.join(",")})->${fk.ftbl}(${fk.fcols.join(",")})`;

beforeAll(async () => {
  await ensureTestDatabaseMigrated();
});

describe("schema.ts and the migrated database agree", () => {
  it("declares every foreign key with the same columns, target and actions as the database", async () => {
    const stored = new Map(
      (await storedForeignKeys()).map((fk) => [keyOf(fk), fk]),
    );
    const problems: string[] = [];
    let declared = 0;

    for (const table of tables) {
      for (const fk of getTableConfig(table).foreignKeys) {
        declared += 1;
        const ref = fk.reference();
        const wanted = {
          tbl: getTableName(table),
          cols: ref.columns.map((column) => column.name),
          ftbl: getTableName(ref.foreignTable),
          fcols: ref.foreignColumns.map((column) => column.name),
        };
        const actual = stored.get(keyOf(wanted));
        if (!actual) {
          problems.push(`missing in database: ${keyOf(wanted)}`);
          continue;
        }
        const onDelete = fk.onDelete ?? "no action";
        const onUpdate = fk.onUpdate ?? "no action";
        if (ACTIONS[actual.del] !== onDelete) {
          problems.push(
            `${keyOf(wanted)} ON DELETE schema=${onDelete} database=${ACTIONS[actual.del]}`,
          );
        }
        if (ACTIONS[actual.upd] !== onUpdate) {
          problems.push(
            `${keyOf(wanted)} ON UPDATE schema=${onUpdate} database=${ACTIONS[actual.upd]}`,
          );
        }
      }
    }

    expect(declared).toBeGreaterThan(50);
    expect(problems).toEqual([]);
  });

  it("has no foreign key in the database that the schema does not declare", async () => {
    const declared = new Set<string>();
    const knownTables = new Set<string>();
    for (const table of tables) {
      knownTables.add(getTableName(table));
      for (const fk of getTableConfig(table).foreignKeys) {
        const ref = fk.reference();
        declared.add(
          keyOf({
            tbl: getTableName(table),
            cols: ref.columns.map((column) => column.name),
            ftbl: getTableName(ref.foreignTable),
            fcols: ref.foreignColumns.map((column) => column.name),
          }),
        );
      }
    }

    const extra = (await storedForeignKeys())
      .filter((fk) => knownTables.has(fk.tbl))
      .map(keyOf)
      .filter((key) => !declared.has(key));

    expect(extra).toEqual([]);
  });

  it("generates distinct, non-empty text ids and a Date for every default and on-update function", () => {
    let idColumns = 0;
    for (const table of tables) {
      for (const column of getTableConfig(table).columns) {
        if (column.defaultFn) {
          const first = column.defaultFn();
          const second = column.defaultFn();
          if (column.name === "id") {
            idColumns += 1;
            expect(typeof first).toBe("string");
            expect((first as string).length).toBeGreaterThanOrEqual(20);
            expect(first).not.toBe(second);
          } else {
            expect(first).not.toBeUndefined();
          }
        }
        if (column.onUpdateFn) {
          expect(column.onUpdateFn()).toBeInstanceOf(Date);
        }
      }
    }
    expect(idColumns).toBeGreaterThan(20);
  });
});
