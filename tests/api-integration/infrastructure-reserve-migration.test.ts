import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import db from "../../apps/api/src/database";
import { runMigrations } from "../../apps/api/src/database/run-migrations";
import { resetTestDatabase } from "./helpers/database";

// Migration 20261013170301_ganttpro_infrastructure_reserve_gb adds
// `ganttpro_infra_model.hypervisor_reserve_gb` (default 8) and a check that the
// reserve is below the RAM. A hand-written backfill converts the old percent
// to GB before the check: ceil(ram * percent / 100), at most ram - 1. The
// scratch database is migrated to the zones migration, populated, then upgraded
// with the runner that the API uses at start-up.

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../apps/api/drizzle");
const TARGET_TAG = "20261013170301_ganttpro_infrastructure_reserve_gb";
const PREVIOUS_TAG = "20261013140000_ganttpro_infrastructure_zones";

function withDatabase(connectionString: string, database: string) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

describe("migration ganttpro_infrastructure_reserve_gb", () => {
  const baseUrl = process.env.DATABASE_URL as string;
  const scratchName = `${new URL(baseUrl).pathname
    .replace(/^\//, "")
    .replace(/_test$/, "")}_infra_reserve_upgrade_test`;
  const scratchUrl = withDatabase(baseUrl, scratchName);
  let priorFolder = "";
  let pool: Pool | null = null;

  async function withAdmin<T>(fn: (client: Client) => Promise<T>) {
    const admin = new Client({
      connectionString: withDatabase(baseUrl, "postgres"),
    });
    await admin.connect();
    try {
      return await fn(admin);
    } finally {
      await admin.end();
    }
  }

  async function dropScratch() {
    if (!scratchName.endsWith("_infra_reserve_upgrade_test")) {
      throw new Error(`Refusing to drop "${scratchName}"`);
    }
    await withAdmin((admin) =>
      admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`),
    );
  }

  beforeAll(() => {
    priorFolder = mkdtempSync(join(tmpdir(), "kaneo-migrations-reserve-"));
    cpSync(migrationsFolder, priorFolder, { recursive: true });
    const journalPath = join(priorFolder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: { tag: string }[];
    };
    const cut = journal.entries.findIndex((entry) => entry.tag === TARGET_TAG);
    expect(cut).toBeGreaterThan(0);
    expect(journal.entries[cut - 1].tag).toBe(PREVIOUS_TAG);
    journal.entries = journal.entries.slice(0, cut);
    writeFileSync(journalPath, JSON.stringify(journal));
  });

  afterAll(() => {
    if (priorFolder) rmSync(priorFolder, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await dropScratch();
    await withAdmin((admin) => admin.query(`CREATE DATABASE "${scratchName}"`));
  }, 120_000);

  afterEach(async () => {
    await pool?.end();
    pool = null;
    await dropScratch();
  });

  async function seed(client: Pool) {
    await client.query(
      `INSERT INTO workspace (id, name, slug, created_at)
       VALUES ('w1', 'w1', 'w1', $1)`,
      [new Date()],
    );
    await client.query(
      `INSERT INTO project (id, workspace_id, slug, name)
       VALUES ('p1', 'w1', 'p1', 'p1')`,
    );
    await client.query(
      `INSERT INTO ganttpro_infra_model
         (id, project_id, name, provider, ram_gb, vcpu, storage_gb, regions, hypervisor_reserve_percent)
       VALUES ('m256', 'p1', 'A', 'ovh', 256, 32, 1920, '["GRA"]', 5),
              ('m128', 'p1', 'B', 'ovh', 128, 32, 1920, '["GRA"]', 90),
              ('m1', 'p1', 'C', 'ovh', 1, 1, 0, '["GRA"]', 90),
              ('m0', 'p1', 'D', 'ovh', 64, 8, 0, '["GRA"]', 0)`,
    );
  }

  async function upgraded() {
    const scratch = new Pool({ connectionString: scratchUrl });
    pool = scratch;
    const scratchDb = drizzle(scratch);
    await runMigrations(scratchDb, { migrationsFolder: priorFolder });
    const before = await scratch.query(
      `SELECT column_name AS name FROM information_schema.columns
       WHERE table_name = 'ganttpro_infra_model' AND column_name = 'hypervisor_reserve_gb'`,
    );
    expect(before.rows).toHaveLength(0);
    await seed(scratch);
    await runMigrations(scratchDb, { migrationsFolder });
    return scratch;
  }

  it("converts the percent to GB and keeps the old column", async () => {
    const client = await upgraded();
    const rows = await client.query(
      `SELECT id, hypervisor_reserve_gb AS gb, hypervisor_reserve_percent AS percent
       FROM ganttpro_infra_model ORDER BY id`,
    );
    expect(rows.rows).toEqual([
      { id: "m0", gb: 0, percent: 0 },
      { id: "m1", gb: 0, percent: 90 }, // ceil(0.9) = 1, capped at ram - 1
      { id: "m128", gb: 116, percent: 90 }, // ceil(115.2): usable 12, as before
      { id: "m256", gb: 13, percent: 5 },
    ]);
  });

  it("enforces the reserve check and defaults new models to 8 GB", async () => {
    const client = await upgraded();
    await expect(
      client.query(
        `INSERT INTO ganttpro_infra_model
           (id, project_id, name, provider, ram_gb, vcpu, storage_gb, regions, hypervisor_reserve_gb)
         VALUES ('bad', 'p1', 'E', 'ovh', 64, 8, 0, '["GRA"]', 64)`,
      ),
    ).rejects.toThrow(/ganttpro_infra_model_hypervisor_reserve_gb_check/);
    await expect(
      client.query(
        `INSERT INTO ganttpro_infra_model
           (id, project_id, name, provider, ram_gb, vcpu, storage_gb, regions, hypervisor_reserve_gb)
         VALUES ('neg', 'p1', 'F', 'ovh', 64, 8, 0, '["GRA"]', -1)`,
      ),
    ).rejects.toThrow(/ganttpro_infra_model_hypervisor_reserve_gb_check/);
    await client.query(
      `INSERT INTO ganttpro_infra_model
         (id, project_id, name, provider, ram_gb, vcpu, storage_gb, regions)
       VALUES ('def', 'p1', 'G', 'ovh', 64, 8, 0, '["GRA"]')`,
    );
    const row = await client.query(
      "SELECT hypervisor_reserve_gb AS gb FROM ganttpro_infra_model WHERE id = 'def'",
    );
    expect(row.rows[0].gb).toBe(8);
  });
});

describe("a fresh database", () => {
  beforeEach(resetTestDatabase);

  it("has the reserve column with the 8 GB default", async () => {
    const result = await db.execute(
      sql`SELECT column_default FROM information_schema.columns
          WHERE table_name = 'ganttpro_infra_model' AND column_name = 'hypervisor_reserve_gb'`,
    );
    expect(result.rows[0]?.column_default).toBe("8");
  });
});
