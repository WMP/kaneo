import { config } from "dotenv-mono";
import { type Config, defineConfig } from "drizzle-kit";
import { resolveDatabaseConnectionString } from "./src/database/resolve-database-url";

config();

export default defineConfig({
  out: "./drizzle",
  schema: "./src/database/schema.ts",
  dialect: "postgresql",
  // New migrations are named <UTC timestamp>_<name>; 0000-0059 are frozen.
  migrations: { prefix: "timestamp" },
  dbCredentials: {
    url: resolveDatabaseConnectionString(),
  },
}) satisfies Config;
