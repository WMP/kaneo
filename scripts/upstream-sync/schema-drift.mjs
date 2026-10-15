#!/usr/bin/env node
// Compares the schema that apps/api/drizzle produces with the one that
// schema.ts describes (drizzle-kit push). Needs a PostgreSQL server; creates
// and drops scratch databases named kaneo_sync_drift_<random>_test.
// Triggers and functions are not compared.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fail, isMain, REPO_ROOT, SCRIPT_DIR } from "./lib.mjs";

const HELP = `Usage: node scripts/upstream-sync/schema-drift.mjs --database-url <url> [options]

Creates scratch database A, applies apps/api/drizzle with the fork's runner,
creates scratch database B and runs "drizzle-kit push --force" from apps/api
against it, then compares columns, indexes and constraints (public schema).
Differences listed in the allowlist are reported but do not fail the run.
Scratch databases are named kaneo_sync_drift_<random>_test and dropped at the
end; the script refuses to create or drop any other name.

Options:
  --database-url <url>             Server and maintenance database to connect to (required)
  --from-database-template <name>  Create A as a copy of this existing database (for
                                   example an upgraded copy of a production-like one)
                                   instead of an empty database. The template must have
                                   no open connections.
  --allowlist <file>               Allowed differences (default: scripts/upstream-sync/schema-drift-allowlist.json)
  --keep                           Do not drop the scratch databases
  -h, --help                       Show this help

Exit codes: 0 no unexpected difference, 1 unexpected differences, 2 error.`;

const SCRATCH_NAME = /^kaneo_sync_drift_[a-z0-9]+_test$/;

export function assertScratchName(name) {
  if (!SCRATCH_NAME.test(name)) {
    throw new Error(
      `Refusing to touch database "${name}": scratch names must match ${SCRATCH_NAME}.`,
    );
  }
}

export function scratchName() {
  return `kaneo_sync_drift_${randomBytes(4).toString("hex")}_test`;
}

export function withDatabase(url, database) {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

const quoteIdent = (name) => `"${name.replaceAll('"', '""')}"`;

/** Index definition without the index name: "CREATE INDEX ON public.t USING ...". */
export function indexDefinitionWithoutName(definition) {
  return definition.replace(/^(CREATE (?:UNIQUE )?INDEX )\S+ ON /, "$1ON ");
}

const COLUMN_FIELDS = ["data_type", "is_nullable", "column_default"];

/**
 * Compares two schema descriptions { columns, indexes, constraints }, each an
 * array of rows (see readSchema). Returns difference records
 * { kind, key, fields, a, b } where a/b are undefined when the object is missing.
 */
export function compareSchemas(a, b) {
  const differences = [];

  const byKey = (rows, keyOf) => new Map(rows.map((row) => [keyOf(row), row]));
  const compare = (kind, rowsA, rowsB, keyOf, valueOf, fieldsOf) => {
    const mapA = byKey(rowsA, keyOf);
    const mapB = byKey(rowsB, keyOf);
    for (const key of [...new Set([...mapA.keys(), ...mapB.keys()])].sort()) {
      const left = mapA.get(key);
      const right = mapB.get(key);
      if (!left || !right) {
        differences.push({
          kind,
          key,
          fields: ["missing"],
          a: left ? valueOf(left) : undefined,
          b: right ? valueOf(right) : undefined,
        });
        continue;
      }
      const fields = fieldsOf(left, right);
      if (fields.length > 0) {
        differences.push({
          kind,
          key,
          fields,
          a: valueOf(left),
          b: valueOf(right),
        });
      }
    }
  };

  compare(
    "column",
    a.columns,
    b.columns,
    (r) => `${r.table_name}.${r.column_name}`,
    (r) => ({
      data_type: r.data_type,
      is_nullable: r.is_nullable,
      column_default: r.column_default,
    }),
    (l, r) =>
      COLUMN_FIELDS.filter(
        (field) => (l[field] ?? null) !== (r[field] ?? null),
      ),
  );
  compare(
    "index",
    a.indexes,
    b.indexes,
    (r) => `${r.tablename}.${r.indexname}`,
    (r) => indexDefinitionWithoutName(r.indexdef),
    (l, r) =>
      indexDefinitionWithoutName(l.indexdef) ===
      indexDefinitionWithoutName(r.indexdef)
        ? []
        : ["definition"],
  );
  compare(
    "constraint",
    a.constraints,
    b.constraints,
    (r) => `${r.rel}.${r.conname}`,
    (r) => r.def,
    (l, r) => (l.def === r.def ? [] : ["definition"]),
  );
  return differences;
}

/**
 * Splits differences into allowed and unexpected. An allowlist entry
 * { kind, key, fields? } allows a difference of that object; with `fields` the
 * differing fields must all be listed (a missing object is never allowed by it).
 * Also returns the allowlist entries that matched nothing.
 */
export function applyAllowlist(differences, allowlist) {
  const used = new Set();
  const allowed = [];
  const unexpected = [];
  for (const difference of differences) {
    const index = allowlist.findIndex(
      (entry) =>
        entry.kind === difference.kind &&
        entry.key === difference.key &&
        (!entry.fields ||
          difference.fields.every((field) => entry.fields.includes(field))),
    );
    if (index === -1) {
      unexpected.push(difference);
    } else {
      used.add(index);
      allowed.push({ ...difference, reason: allowlist[index].reason });
    }
  }
  return {
    allowed,
    unexpected,
    stale: allowlist.filter((_, index) => !used.has(index)),
  };
}

export function formatDifference(d) {
  const show = (value) =>
    value === undefined ? "(missing)" : JSON.stringify(value);
  return `${d.kind} ${d.key} [${d.fields.join(", ")}]\n    migrations: ${show(d.a)}\n    schema.ts:  ${show(d.b)}`;
}

const QUERIES = {
  columns: `SELECT table_name, column_name, data_type, is_nullable, column_default
            FROM information_schema.columns WHERE table_schema = 'public'`,
  indexes: `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`,
  constraints: `SELECT conrelid::regclass::text AS rel, conname, pg_get_constraintdef(oid) AS def
                FROM pg_constraint WHERE connamespace = 'public'::regnamespace`,
};

async function readSchema(Client, url) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const schema = {};
    for (const [name, query] of Object.entries(QUERIES)) {
      schema[name] = (await client.query(query)).rows;
    }
    return schema;
  } finally {
    await client.end();
  }
}

function runChild(command, args, { cwd, env }) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (exit ${result.status})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        "database-url": { type: "string" },
        "from-database-template": { type: "string" },
        allowlist: {
          type: "string",
          default: join(SCRIPT_DIR, "schema-drift-allowlist.json"),
        },
        keep: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    fail(`${error.message}\n\n${HELP}`);
  }
  const { values } = parsed;
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (!values["database-url"]) {
    fail(`--database-url is required.\n\n${HELP}`);
  }
  const apiDir = join(REPO_ROOT, "apps/api");
  const apiRequire = createRequire(join(apiDir, "package.json"));
  const { Client } = apiRequire("pg");
  const allowlist = JSON.parse(readFileSync(values.allowlist, "utf8"));
  const adminUrl = values["database-url"];
  const nameA = scratchName();
  const nameB = scratchName();
  assertScratchName(nameA);
  assertScratchName(nameB);
  const created = [];

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const template = values["from-database-template"];
    await admin.query(
      `CREATE DATABASE ${quoteIdent(nameA)}${template ? ` TEMPLATE ${quoteIdent(template)}` : ""}`,
    );
    created.push(nameA);
    console.log(
      `Database A (migrations): ${nameA}${template ? ` (copy of ${template})` : ""}`,
    );
    await admin.query(`CREATE DATABASE ${quoteIdent(nameB)}`);
    created.push(nameB);
    console.log(`Database B (schema.ts push): ${nameB}`);

    const urlA = withDatabase(adminUrl, nameA);
    const urlB = withDatabase(adminUrl, nameB);
    const tsx = join(apiDir, "node_modules/.bin/tsx");
    const drizzleKit = join(apiDir, "node_modules/.bin/drizzle-kit");

    console.log("Applying apps/api/drizzle with the fork's runner...");
    console.log(
      runChild(tsx, [join(SCRIPT_DIR, "schema-drift-apply.mjs"), apiDir], {
        cwd: apiDir,
        env: { DATABASE_URL: urlA },
      }).trim(),
    );
    console.log("Running drizzle-kit push --force...");
    runChild(drizzleKit, ["push", "--force"], {
      cwd: apiDir,
      env: { DATABASE_URL: urlB },
    });

    const [schemaA, schemaB] = [
      await readSchema(Client, urlA),
      await readSchema(Client, urlB),
    ];
    const differences = compareSchemas(schemaA, schemaB);
    const { allowed, unexpected, stale } = applyAllowlist(
      differences,
      allowlist,
    );

    console.log(
      `\nCompared ${schemaA.columns.length}/${schemaB.columns.length} columns, ${schemaA.indexes.length}/${schemaB.indexes.length} indexes, ${schemaA.constraints.length}/${schemaB.constraints.length} constraints (A/B).`,
    );
    for (const d of allowed) {
      console.log(`allowed: ${formatDifference(d)}\n    reason: ${d.reason}`);
    }
    for (const entry of stale) {
      console.log(
        `note: allowlist entry ${entry.kind} ${entry.key} matched nothing; remove it if it is fixed.`,
      );
    }
    for (const d of unexpected) {
      console.log(`DIFFERENCE: ${formatDifference(d)}`);
    }
    console.log(
      unexpected.length === 0
        ? "\nNo unexpected differences."
        : `\n${unexpected.length} unexpected difference(s). Fix schema.ts or add a migration (see docs/agent-guide/database.md).`,
    );
    process.exitCode = unexpected.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  } finally {
    if (!values.keep) {
      for (const name of created) {
        assertScratchName(name);
        try {
          await admin.query(
            `DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`,
          );
        } catch (error) {
          console.error(`Could not drop ${name}: ${error.message}`);
        }
      }
    } else {
      console.log(`Kept scratch databases: ${created.join(", ")}`);
    }
    await admin.end();
  }
}

if (isMain(import.meta.url)) {
  await main();
}
