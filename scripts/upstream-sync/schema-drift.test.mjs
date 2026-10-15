import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyAllowlist,
  assertScratchName,
  compareSchemas,
  indexDefinitionWithoutName,
  scratchName,
  withDatabase,
} from "./schema-drift.mjs";

const column = (table_name, column_name, extra = {}) => ({
  table_name,
  column_name,
  data_type: "text",
  is_nullable: "YES",
  column_default: null,
  ...extra,
});
const index = (tablename, indexname, indexdef) => ({
  tablename,
  indexname,
  indexdef,
});
const constraint = (rel, conname, def) => ({ rel, conname, def });
const schema = ({ columns = [], indexes = [], constraints = [] } = {}) => ({
  columns,
  indexes,
  constraints,
});

test("identical schemas have no differences", () => {
  const s = schema({
    columns: [column("t", "a")],
    indexes: [
      index("t", "t_a_idx", "CREATE INDEX t_a_idx ON public.t USING btree (a)"),
    ],
    constraints: [constraint("t", "t_pkey", "PRIMARY KEY (a)")],
  });
  assert.deepEqual(compareSchemas(s, structuredClone(s)), []);
});

test("column differences name the differing fields", () => {
  const a = schema({
    columns: [
      column("label", "workspace_id", { is_nullable: "NO" }),
      column("t", "only_a"),
    ],
  });
  const b = schema({
    columns: [
      column("label", "workspace_id", { is_nullable: "YES" }),
      column("t", "only_b"),
    ],
  });
  const diffs = compareSchemas(a, b);
  assert.deepEqual(
    diffs.map((d) => [d.kind, d.key, d.fields]),
    [
      ["column", "label.workspace_id", ["is_nullable"]],
      ["column", "t.only_a", ["missing"]],
      ["column", "t.only_b", ["missing"]],
    ],
  );
  assert.equal(diffs[1].b, undefined);
});

test("column_default null and undefined are equal", () => {
  const a = schema({
    columns: [column("t", "a", { column_default: undefined })],
  });
  const b = schema({ columns: [column("t", "a", { column_default: null })] });
  assert.deepEqual(compareSchemas(a, b), []);
});

test("index and constraint definitions are compared by name; the index name inside the definition is ignored", () => {
  assert.equal(
    indexDefinitionWithoutName(
      "CREATE UNIQUE INDEX foo ON public.t USING btree (a)",
    ),
    "CREATE UNIQUE INDEX ON public.t USING btree (a)",
  );
  const a = schema({
    indexes: [
      index("t", "i1", "CREATE INDEX i1 ON public.t USING btree (a)"),
      index("t", "i2", "CREATE INDEX i2 ON public.t USING btree (b)"),
    ],
    constraints: [
      constraint("t", "c1", "CHECK ((a > 0))"),
      constraint("t", "c2", "UNIQUE (a)"),
    ],
  });
  const b = schema({
    indexes: [
      index("t", "i1", "CREATE INDEX i1 ON public.t USING btree (a)"),
      index("t", "i2", "CREATE INDEX i2 ON public.t USING btree (c)"),
    ],
    constraints: [constraint("t", "c1", "CHECK ((a > 1))")],
  });
  assert.deepEqual(
    compareSchemas(a, b).map((d) => [d.kind, d.key, d.fields[0]]),
    [
      ["index", "t.i2", "definition"],
      ["constraint", "t.c1", "definition"],
      ["constraint", "t.c2", "missing"],
    ],
  );
});

test("applyAllowlist allows listed differences and reports stale entries", () => {
  const diffs = compareSchemas(
    schema({
      columns: [
        column("label", "workspace_id", { is_nullable: "NO" }),
        column("user", "email_verified", {
          column_default: "false",
          data_type: "boolean",
        }),
        column("t", "other", { is_nullable: "NO" }),
      ],
    }),
    schema({
      columns: [
        column("label", "workspace_id", { is_nullable: "YES" }),
        column("user", "email_verified", {
          column_default: null,
          data_type: "boolean",
        }),
        column("t", "other", { is_nullable: "YES" }),
      ],
    }),
  );
  const result = applyAllowlist(diffs, [
    {
      kind: "column",
      key: "label.workspace_id",
      fields: ["is_nullable"],
      reason: "r1",
    },
    {
      kind: "column",
      key: "user.email_verified",
      fields: ["column_default"],
      reason: "r2",
    },
    { kind: "column", key: "gone.column", reason: "r3" },
  ]);
  assert.deepEqual(
    result.allowed.map((d) => d.key),
    ["label.workspace_id", "user.email_verified"],
  );
  assert.deepEqual(
    result.unexpected.map((d) => d.key),
    ["t.other"],
  );
  assert.deepEqual(
    result.stale.map((e) => e.key),
    ["gone.column"],
  );
});

test("an allowlist entry with fields does not allow another field or a missing object", () => {
  const diffs = compareSchemas(
    schema({
      columns: [
        column("label", "workspace_id", { data_type: "text" }),
        column("x", "y"),
      ],
    }),
    schema({
      columns: [column("label", "workspace_id", { data_type: "uuid" })],
    }),
  );
  const result = applyAllowlist(diffs, [
    {
      kind: "column",
      key: "label.workspace_id",
      fields: ["is_nullable"],
      reason: "r",
    },
    { kind: "column", key: "x.y", fields: ["is_nullable"], reason: "r" },
  ]);
  assert.equal(result.allowed.length, 0);
  assert.equal(result.unexpected.length, 2);
});

test("scratch names must end in _test and match the prefix", () => {
  assert.doesNotThrow(() => assertScratchName(scratchName()));
  assert.doesNotThrow(() =>
    assertScratchName("kaneo_sync_drift_ab12cd34_test"),
  );
  for (const bad of [
    "postgres",
    "kaneo",
    "kaneo_sync_drift_ab12",
    "kaneo_sync_drift_x_prod",
    'kaneo_sync_drift_a"b_test',
  ]) {
    assert.throws(() => assertScratchName(bad), /Refusing/);
  }
});

test("withDatabase replaces only the database of the URL", () => {
  assert.equal(
    withDatabase(
      "postgresql://u:p@localhost:5432/postgres?sslmode=disable",
      "kaneo_sync_drift_a_test",
    ),
    "postgresql://u:p@localhost:5432/kaneo_sync_drift_a_test?sslmode=disable",
  );
});
