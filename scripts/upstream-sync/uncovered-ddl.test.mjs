import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  findUncovered,
  normalize,
  render,
  splitStatements,
} from "./uncovered-ddl.mjs";
import { makeTempDir, removeDir, runNode } from "./test-utils.mjs";

const SCRIPT = new URL("./uncovered-ddl.mjs", import.meta.url).pathname;

test("splitStatements splits on breakpoints and semicolons but not inside $$ blocks", () => {
  const sql = [
    'CREATE TABLE "a" (id int);--> statement-breakpoint',
    "-- a comment",
    "CREATE FUNCTION f() RETURNS int AS $$",
    "BEGIN",
    "  SELECT 1;",
    "END;",
    "$$ LANGUAGE plpgsql;",
    "--> statement-breakpoint",
    'ALTER TABLE "a" ADD COLUMN "b" text;',
    'ALTER TABLE "a" ADD COLUMN "c" text;',
  ].join("\n");
  const statements = splitStatements(sql);
  assert.equal(statements.length, 4);
  assert.ok(statements[1].startsWith("CREATE FUNCTION"));
  assert.ok(statements[1].endsWith("plpgsql;"));
});

test("normalize ignores IF [NOT] EXISTS, whitespace, case, public qualifier and the semicolon", () => {
  assert.equal(
    normalize(
      'ALTER TABLE IF EXISTS "public"."t"\n  ADD COLUMN IF NOT EXISTS "c"   text;',
    ),
    'alter table "t" add column "c" text',
  );
});

test("findUncovered returns only the statements that upstream does not perform", () => {
  const generated = [
    'ALTER TABLE "t" ADD COLUMN "c" text;',
    "--> statement-breakpoint",
    'CREATE INDEX "t_c_idx" ON "t" USING btree ("c");',
    "--> statement-breakpoint",
    'ALTER TABLE "t" ADD COLUMN "d" text;',
  ].join("\n");
  const upstream = [
    'ALTER TABLE IF EXISTS "t" ADD COLUMN IF NOT EXISTS "c" text;--> statement-breakpoint',
    'CREATE INDEX IF NOT EXISTS "t_c_idx" ON "t" USING btree ("c");',
  ].join("\n");
  const { uncovered, verifyByHand } = findUncovered(generated, [upstream]);
  assert.deepEqual(uncovered, ['ALTER TABLE "t" ADD COLUMN "d" text;']);
  assert.deepEqual(verifyByHand, []);
});

test("a statement that is part of an upstream DO block counts as covered", () => {
  const generated =
    'ALTER TABLE "a" ADD CONSTRAINT "a_fk" FOREIGN KEY ("b") REFERENCES "b"("id");';
  const upstream = `DO $$ BEGIN
  ALTER TABLE "a" ADD CONSTRAINT "a_fk" FOREIGN KEY ("b") REFERENCES "b"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;`;
  assert.deepEqual(findUncovered(generated, [upstream]).uncovered, []);
});

test("SET DEFAULT is verified by hand only when an upstream DO loop exists", () => {
  const generated = [
    `ALTER TABLE "x" ALTER COLUMN "y" SET DEFAULT (now() AT TIME ZONE 'utc');`,
    "--> statement-breakpoint",
    'ALTER TABLE "x" ADD COLUMN "z" text;',
  ].join("\n");
  const loop = `DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT 1 LOOP
    EXECUTE 'ALTER TABLE ' || quote_ident('x') || ' ALTER COLUMN y SET DEFAULT now()';
  END LOOP;
END $$;`;
  const withLoop = findUncovered(generated, [loop]);
  assert.equal(withLoop.verifyByHand.length, 1);
  assert.deepEqual(withLoop.uncovered, [
    'ALTER TABLE "x" ADD COLUMN "z" text;',
  ]);

  const withoutLoop = findUncovered(generated, ["SELECT 1;"]);
  assert.equal(withoutLoop.verifyByHand.length, 0);
  assert.equal(withoutLoop.uncovered.length, 2);
});

test("render joins statements with breakpoints and lists hand checks as comments", () => {
  const text = render({
    uncovered: ['ALTER TABLE "a" ADD COLUMN "b" text', 'DROP TABLE "c";'],
    verifyByHand: ['ALTER TABLE "x" ALTER COLUMN "y" SET DEFAULT 1;'],
  });
  assert.equal(
    text,
    [
      'ALTER TABLE "a" ADD COLUMN "b" text;',
      "--> statement-breakpoint",
      'DROP TABLE "c";',
      '-- VERIFY BY HAND (an upstream DO $$ loop may set this default): ALTER TABLE "x" ALTER COLUMN "y" SET DEFAULT 1;',
    ].join("\n"),
  );
});

test("the command line reads files and reports usage errors", () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir, "gen.sql"),
      'ALTER TABLE "t" ADD COLUMN "c" text;\n',
    );
    writeFileSync(join(dir, "up.sql"), "SELECT 1;\n");
    const ok = runNode(SCRIPT, [join(dir, "gen.sql"), join(dir, "up.sql")]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /ADD COLUMN "c" text;/);
    const json = runNode(SCRIPT, [
      "--json",
      join(dir, "gen.sql"),
      join(dir, "up.sql"),
    ]);
    assert.equal(JSON.parse(json.stdout).uncovered.length, 1);
    assert.equal(runNode(SCRIPT, [join(dir, "gen.sql")]).status, 2);
    assert.equal(runNode(SCRIPT, ["--help"]).status, 0);
  } finally {
    removeDir(dir);
  }
});
