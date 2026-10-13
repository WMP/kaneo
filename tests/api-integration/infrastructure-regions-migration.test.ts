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

// Migration 20261013130242_ganttpro_infrastructure_regions adds the region
// catalog `ganttpro_infra_region` and backfills, per workspace, every region
// code that a model, a host or a storage cluster already uses (name = code).
// The scratch database is migrated to the storage migration, populated, then
// upgraded with the runner that the API uses at start-up; a fresh database gets
// the empty table.

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../apps/api/drizzle");
const TARGET_TAG = "20261013130242_ganttpro_infrastructure_regions";
const PREVIOUS_TAG = "20261012105418_ganttpro_infrastructure_storage";

function withDatabase(connectionString: string, database: string) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

describe("migration ganttpro_infrastructure_regions", () => {
  const baseUrl = process.env.DATABASE_URL as string;
  const scratchName = `${new URL(baseUrl).pathname
    .replace(/^\//, "")
    .replace(/_test$/, "")}_infra_regions_upgrade_test`;
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
    if (!scratchName.endsWith("_infra_regions_upgrade_test")) {
      throw new Error(`Refusing to drop "${scratchName}"`);
    }
    await withAdmin((admin) =>
      admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`),
    );
  }

  beforeAll(() => {
    priorFolder = mkdtempSync(join(tmpdir(), "kaneo-migrations-regions-"));
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
    const now = new Date();
    await client.query(
      `INSERT INTO workspace (id, name, slug, created_at)
       VALUES ('w1', 'w1', 'w1', $1), ('w2', 'w2', 'w2', $1)`,
      [now],
    );
    await client.query(
      `INSERT INTO project (id, workspace_id, slug, name)
       VALUES ('p1', 'w1', 'p1', 'p1'), ('p2', 'w2', 'p2', 'p2')`,
    );
    await client.query(
      `INSERT INTO ganttpro_infra_model
         (id, project_id, name, provider, ram_gb, vcpu, storage_gb, regions)
       VALUES ('m1', 'p1', 'ADVANCE-2', 'ovh', 256, 32, 1920, '["GRA","PAR"]'),
              ('m2', 'p2', 'SCALE-1', 'ovh', 256, 48, 3840, '["GRA"]')`,
    );
    await client.query(
      `INSERT INTO ganttpro_infra_host (id, project_id, model_id, region, label)
       VALUES ('h1', 'p1', 'm1', 'GRA', 'ADVANCE-2 256 GB GRA #1')`,
    );
    await client.query(
      `INSERT INTO ganttpro_infra_storage_cluster
         (id, workspace_id, name, region, kind, ec_data_chunks, ec_coding_chunks)
       VALUES ('c1', 'w1', 'Ceph WAW', 'WAW', 'self_managed', 4, 2)`,
    );
  }

  async function upgraded() {
    const scratch = new Pool({ connectionString: scratchUrl });
    pool = scratch;
    const scratchDb = drizzle(scratch);
    await runMigrations(scratchDb, { migrationsFolder: priorFolder });
    const before = await scratch.query(
      `SELECT to_regclass('public.ganttpro_infra_region') AS name`,
    );
    expect(before.rows[0].name).toBeNull();
    await seed(scratch);
    await runMigrations(scratchDb, { migrationsFolder });
    return scratch;
  }

  it("backfills the regions that models, hosts and clusters use, per workspace", async () => {
    const client = await upgraded();
    const rows = await client.query(
      `SELECT workspace_id, code, name, position FROM ganttpro_infra_region
       ORDER BY workspace_id, code`,
    );
    expect(rows.rows).toEqual([
      { workspace_id: "w1", code: "GRA", name: "GRA", position: 0 },
      { workspace_id: "w1", code: "PAR", name: "PAR", position: 0 },
      { workspace_id: "w1", code: "WAW", name: "WAW", position: 0 },
      { workspace_id: "w2", code: "GRA", name: "GRA", position: 0 },
    ]);

    // Zones (migration ganttpro_infrastructure_zones) default to an empty list
    // and existing hosts have no zone.
    const zones = await client.query("SELECT zones FROM ganttpro_infra_region");
    expect(zones.rows.every((row) => row.zones.length === 0)).toBe(true);
    const hostZone = await client.query("SELECT zone FROM ganttpro_infra_host");
    expect(hostZone.rows).toEqual([{ zone: null }]);

    // The existing rows are untouched.
    const hosts = await client.query(
      "SELECT region FROM ganttpro_infra_host ORDER BY id",
    );
    expect(hosts.rows).toEqual([{ region: "GRA" }]);
  });

  it("enforces the code format and uniqueness, and cascades with the workspace", async () => {
    const client = await upgraded();
    await expect(
      client.query(
        `INSERT INTO ganttpro_infra_region (id, workspace_id, code, name)
         VALUES ('bad', 'w1', 'gra', 'lower case')`,
      ),
    ).rejects.toThrow(/ganttpro_infra_region_code_check/);
    await expect(
      client.query(
        `INSERT INTO ganttpro_infra_region (id, workspace_id, code, name)
         VALUES ('dup', 'w1', 'GRA', 'again')`,
      ),
    ).rejects.toThrow(/ganttpro_infra_region_workspace_id_code_unique/);
    await client.query(`DELETE FROM workspace WHERE id = 'w1'`);
    const left = await client.query(
      "SELECT workspace_id FROM ganttpro_infra_region",
    );
    expect(left.rows).toEqual([{ workspace_id: "w2" }]);
  });
});

describe("a fresh database", () => {
  beforeEach(resetTestDatabase);

  it("has the empty region table", async () => {
    const rows = await db.query.infraRegionTable.findMany();
    expect(rows).toEqual([]);
  });
});
