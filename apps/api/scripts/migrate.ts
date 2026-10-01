import { resolve } from "node:path";
import { getDatabase, getDatabasePool } from "../src/database";
import { runMigrations } from "../src/database/run-migrations";
import { reconcileMigrationJournal } from "../src/utils/adopt-existing-database";

// Applies the pending migrations with the runner the API uses on startup
// (apps/api/src/index.ts), not with `drizzle-kit migrate`, which skips an entry
// whose `when` is older than the newest applied one.
const migrationsFolder = resolve(import.meta.dirname, "../drizzle");

try {
  await reconcileMigrationJournal(migrationsFolder);
  const applied = await runMigrations(getDatabase(), { migrationsFolder });
  console.log(
    applied.length > 0
      ? `Applied ${applied.length} migration(s).`
      : "No pending migrations.",
  );
} finally {
  await getDatabasePool().end();
}
