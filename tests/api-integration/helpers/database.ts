import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import db from "../../../apps/api/src/database";
import * as events from "../../../apps/api/src/events";
import { retryTransaction } from "../../../apps/api/src/utils/retry-transaction";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../../apps/api/drizzle");

let migrationPromise: Promise<void> | null = null;

function getDatabaseName(connectionString: string) {
  return new URL(connectionString).pathname.replace(/^\//, "");
}

function getAdminDatabaseUrl(connectionString: string) {
  const url = new URL(connectionString);
  url.pathname = "/postgres";
  return url.toString();
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function ensureTestDatabaseExists() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL must be defined for integration tests");
  }

  const databaseName = getDatabaseName(connectionString);

  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to manage non-test database "${databaseName}". DATABASE_URL must point to a test database.`,
    );
  }

  const adminClient = new Client({
    connectionString: getAdminDatabaseUrl(connectionString),
  });

  await adminClient.connect();

  try {
    const result = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName],
    );

    if (result.rowCount === 0) {
      await adminClient.query(
        `CREATE DATABASE ${quoteIdentifier(databaseName)}`,
      );
    }
  } finally {
    await adminClient.end();
  }
}

export async function ensureTestDatabaseMigrated() {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      await ensureTestDatabaseExists();
      await migrate(db, {
        migrationsFolder,
      });
    })();
  }

  try {
    await migrationPromise;
  } catch (error) {
    migrationPromise = null;
    throw error;
  }
}

// Ponytail: query Postgres directly. The catalog is the canonical source of
// what tables actually exist after migrations run. Reflecting on the schema
// object in apps/api/src/database misses any table that is not exported from
// the index.ts registry (for example mcp_oauth_state and task_reminder_sent).
async function listPublicTableNames(): Promise<string[]> {
  const result = await db.execute<{ table_name: string }>(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  return result.rows.map((row) => row.table_name);
}

// The event bus discards the promises of its async handlers, so the reactions
// to a test's last event (activity rows, notifications) can still be writing
// when the next test starts. Wait for them: they hold row locks that make the
// TRUNCATE below deadlock (`40P01`). A test that replaces the events module
// wholesale has nothing to wait for.
async function drainEventHandlers() {
  try {
    await (
      events as { waitForPendingEventHandlers?: () => Promise<void> }
    ).waitForPendingEventHandlers?.();
  } catch {
    // The events module is mocked without the helper.
  }
}

export async function resetTestDatabase() {
  await ensureTestDatabaseMigrated();
  await drainEventHandlers();

  const tableNames = await listPublicTableNames();

  if (tableNames.length === 0) {
    throw new Error(
      "resetTestDatabase found no tables to truncate. Did migrations run?",
    );
  }

  const formattedTableNames = tableNames.map(quoteIdentifier).join(", ");

  // Safety net for background work that is not an event handler (a scheduler
  // tick, a delivery started with `void`): if the server picks the TRUNCATE as a
  // deadlock victim, run it again, at most 3 attempts.
  await retryTransaction(
    () =>
      db.execute(
        sql.raw(
          `TRUNCATE TABLE ${formattedTableNames} RESTART IDENTITY CASCADE`,
        ),
      ),
    { backoffMs: 100 },
  );
}
