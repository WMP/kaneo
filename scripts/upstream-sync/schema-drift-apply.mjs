// Helper of schema-drift.mjs, run with tsx: applies apps/api/drizzle with the
// fork's runner (apps/api/src/database/run-migrations.ts) to DATABASE_URL.
// Not meant to be run by hand.
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const apiDir = resolve(process.argv[2] ?? "apps/api");
const migrationsFolder = join(apiDir, "drizzle");
const apiRequire = createRequire(join(apiDir, "package.json"));
const { Pool } = apiRequire("pg");
const { drizzle } = apiRequire("drizzle-orm/node-postgres");

const { runMigrations } = await import(
  pathToFileURL(join(apiDir, "src/database/run-migrations.ts")).href
);
const { reconcileMigrationJournal } = await import(
  pathToFileURL(join(apiDir, "src/utils/adopt-existing-database.ts")).href
);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const db = drizzle(pool);
  // Same order as runStartupTasks in apps/api/src/index.ts.
  await reconcileMigrationJournal(migrationsFolder, db);
  const applied = await runMigrations(db, { migrationsFolder });
  console.log(`Applied ${applied.length} migration(s).`);
} finally {
  await pool.end();
}
