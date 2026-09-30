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

// Migration 0058 adds `ganttpro_resource.ganttpro_invitation_id`: a nullable
// foreign key to `invitation.id` (ON DELETE SET NULL) with an index. It
// backfills nothing. The scratch database is migrated to 0057, populated with a
// resource that has an assignment, then upgraded; a fresh database (every other
// integration test) is checked for the same objects.

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../apps/api/drizzle");
const TARGET_TAG = "0058_ganttpro_resource_invitation";

function withDatabase(connectionString: string, database: string) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

describe("migration 0058 resource invitation", () => {
  const baseUrl = process.env.DATABASE_URL as string;
  const scratchName = `${new URL(baseUrl).pathname
    .replace(/^\//, "")
    .replace(/_test$/, "")}_resource_upgrade_test`;
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
    if (!scratchName.endsWith("_resource_upgrade_test")) {
      throw new Error(`Refusing to drop "${scratchName}"`);
    }
    await withAdmin((admin) =>
      admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`),
    );
  }

  beforeAll(() => {
    priorFolder = mkdtempSync(join(tmpdir(), "kaneo-migrations-0057-"));
    cpSync(migrationsFolder, priorFolder, { recursive: true });
    const journalPath = join(priorFolder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: { tag: string }[];
    };
    const cut = journal.entries.findIndex((entry) => entry.tag === TARGET_TAG);
    expect(cut).toBeGreaterThan(0);
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

  const now = new Date();

  async function seed(client: Pool) {
    await client.query(
      `INSERT INTO "user" (id, name, email, email_verified) VALUES ('u1', 'u1', 'u1@example.com', true)`,
    );
    await client.query(
      `INSERT INTO workspace (id, name, slug, created_at) VALUES ('w1', 'w1', 'w1', $1)`,
      [now],
    );
    await client.query(
      `INSERT INTO project (id, workspace_id, slug, name) VALUES ('p1', 'w1', 'p1', 'p1')`,
    );
    await client.query(
      `INSERT INTO ganttpro_resource (id, workspace_id, kind, name, email)
       VALUES ('r-person', 'w1', 'person', 'Alice', 'alice@example.com'),
              ('r-linked', 'w1', 'person', 'Linked', 'linked@example.com'),
              ('r-tool', 'w1', 'equipment', 'Drill', NULL)`,
    );
    await client.query(
      `UPDATE ganttpro_resource SET ganttpro_user_id = 'u1' WHERE id = 'r-linked'`,
    );
    await client.query(
      `INSERT INTO task (id, project_id, title, status, priority, number, position)
       VALUES ('t1', 'p1', 't1', 'to-do', 'medium', 1, 1)`,
    );
    await client.query(
      `INSERT INTO ganttpro_task_assignment (id, task_id, ganttpro_resource_id, units, work)
       VALUES ('a1', 't1', 'r-person', 80, 5)`,
    );
  }

  async function upgraded() {
    const scratch = new Pool({ connectionString: scratchUrl });
    pool = scratch;
    const scratchDb = drizzle(scratch);
    await runMigrations(scratchDb, { migrationsFolder: priorFolder });
    const before = await scratch.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'ganttpro_resource' AND column_name = 'ganttpro_invitation_id'`,
    );
    expect(before.rows[0].n).toBe(0);
    await seed(scratch);
    await runMigrations(scratchDb, { migrationsFolder });
    return scratch;
  }

  it("upgrades a populated database and backfills nothing", async () => {
    const client = await upgraded();

    const resources = await client.query(
      "SELECT id, ganttpro_user_id, ganttpro_invitation_id FROM ganttpro_resource ORDER BY id",
    );
    expect(resources.rows).toEqual([
      { id: "r-linked", ganttpro_user_id: "u1", ganttpro_invitation_id: null },
      { id: "r-person", ganttpro_user_id: null, ganttpro_invitation_id: null },
      { id: "r-tool", ganttpro_user_id: null, ganttpro_invitation_id: null },
    ]);
    // The assignments are untouched.
    const assignments = await client.query(
      "SELECT ganttpro_resource_id, units, work FROM ganttpro_task_assignment",
    );
    expect(assignments.rows).toEqual([
      { ganttpro_resource_id: "r-person", units: 80, work: 5 },
    ]);
  });

  it("clears the link when the invitation row disappears, and follows its id", async () => {
    const client = await upgraded();
    await client.query(
      `INSERT INTO invitation (id, workspace_id, email, role, status, expires_at, created_at, inviter_id)
       VALUES ('inv', 'w1', 'alice@example.com', 'viewer', 'pending', $1, $2, 'u1')`,
      [new Date(Date.now() + 3_600_000), now],
    );
    await client.query(
      `UPDATE ganttpro_resource SET ganttpro_invitation_id = 'inv' WHERE id = 'r-person'`,
    );

    await expect(
      client.query(
        `UPDATE ganttpro_resource SET ganttpro_invitation_id = 'missing' WHERE id = 'r-tool'`,
      ),
    ).rejects.toThrow(
      /ganttpro_resource_ganttpro_invitation_id_invitation_id_fk/,
    );

    await client.query(`UPDATE invitation SET id = 'inv2' WHERE id = 'inv'`);
    const renamed = await client.query(
      `SELECT ganttpro_invitation_id FROM ganttpro_resource WHERE id = 'r-person'`,
    );
    expect(renamed.rows[0].ganttpro_invitation_id).toBe("inv2");

    await client.query(`DELETE FROM invitation WHERE id = 'inv2'`);
    const cleared = await client.query(
      `SELECT ganttpro_invitation_id FROM ganttpro_resource WHERE id = 'r-person'`,
    );
    expect(cleared.rows[0].ganttpro_invitation_id).toBeNull();
    // The resource itself and its assignment are still there.
    const kept = await client.query(
      `SELECT count(*)::int AS n FROM ganttpro_task_assignment WHERE ganttpro_resource_id = 'r-person'`,
    );
    expect(kept.rows[0].n).toBe(1);
  });

  it("creates the same objects on a fresh database", async () => {
    await resetTestDatabase();
    const result = await db.$client.query(
      `SELECT
         (SELECT is_nullable FROM information_schema.columns
            WHERE table_name = 'ganttpro_resource' AND column_name = 'ganttpro_invitation_id') AS nullable,
         EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ganttpro_resource_invitation_id_idx') AS "index",
         (SELECT confdeltype FROM pg_constraint
            WHERE conname = 'ganttpro_resource_ganttpro_invitation_id_invitation_id_fk') AS on_delete`,
    );
    // confdeltype "n" is ON DELETE SET NULL.
    expect(result.rows[0]).toEqual({
      nullable: "YES",
      index: true,
      on_delete: "n",
    });
  });
});
