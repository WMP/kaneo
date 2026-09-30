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
import { migrate } from "drizzle-orm/node-postgres/migrator";
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
import { resetTestDatabase } from "./helpers/database";

// Migration 0060 adds workspace columns: the table `ganttpro_workspace_column`,
// `workspace.ganttpro_enforce_columns` (default false) and the nullable link
// `column.ganttpro_workspace_column_id` (ON DELETE SET NULL, ON UPDATE CASCADE).
// It backfills nothing. The scratch database is migrated to 0059, populated with
// workspaces, projects, columns, tasks and a workflow rule, then upgraded; a
// fresh database (every other integration test) is checked for the same objects.

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../apps/api/drizzle");
const TARGET_TAG = "0060_ganttpro_workspace_columns";

function withDatabase(connectionString: string, database: string) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

describe("migration 0060 workspace columns", () => {
  const baseUrl = process.env.DATABASE_URL as string;
  const scratchName = `${new URL(baseUrl).pathname
    .replace(/^\//, "")
    .replace(/_test$/, "")}_workspace_columns_upgrade_test`;
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
    if (!scratchName.endsWith("_workspace_columns_upgrade_test")) {
      throw new Error(`Refusing to drop "${scratchName}"`);
    }
    await withAdmin((admin) =>
      admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`),
    );
  }

  beforeAll(() => {
    priorFolder = mkdtempSync(join(tmpdir(), "kaneo-migrations-0059-"));
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
      `INSERT INTO workspace (id, name, slug, created_at)
       VALUES ('w1', 'w1', 'w1', $1), ('w2', 'w2', 'w2', $1)`,
      [now],
    );
    await client.query(
      `INSERT INTO project (id, workspace_id, slug, name)
       VALUES ('p1', 'w1', 'p1', 'p1'), ('p2', 'w2', 'p2', 'p2')`,
    );
    await client.query(
      `INSERT INTO "column" (id, project_id, name, slug, position, is_final)
       VALUES ('c1', 'p1', 'To Do', 'to-do', 0, false),
              ('c2', 'p1', 'Done', 'done', 1, true),
              ('c3', 'p2', 'To Do', 'to-do', 0, false)`,
    );
    await client.query(
      `INSERT INTO task (id, project_id, title, status, column_id, priority, number, position)
       VALUES ('t1', 'p1', 't1', 'to-do', 'c1', 'medium', 1, 1),
              ('t2', 'p1', 't2', 'done', 'c2', 'medium', 2, 1)`,
    );
    await client.query(
      `INSERT INTO workflow_rule (id, project_id, integration_type, event_type, column_id)
       VALUES ('r1', 'p1', 'github', 'pull_request_opened', 'c1')`,
    );
  }

  async function upgraded() {
    const scratch = new Pool({ connectionString: scratchUrl });
    pool = scratch;
    const scratchDb = drizzle(scratch);
    await migrate(scratchDb, { migrationsFolder: priorFolder });
    const before = await scratch.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE (table_name = 'column' AND column_name = 'ganttpro_workspace_column_id')
          OR (table_name = 'workspace' AND column_name = 'ganttpro_enforce_columns')`,
    );
    expect(before.rows[0].n).toBe(0);
    const tableBefore = await scratch.query(
      `SELECT to_regclass('public.ganttpro_workspace_column') AS name`,
    );
    expect(tableBefore.rows[0].name).toBeNull();
    await seed(scratch);
    await migrate(scratchDb, { migrationsFolder });
    return scratch;
  }

  it("upgrades a populated database with defaults and changes nothing", async () => {
    const client = await upgraded();

    const workspaces = await client.query(
      "SELECT id, ganttpro_enforce_columns FROM workspace ORDER BY id",
    );
    expect(workspaces.rows).toEqual([
      { id: "w1", ganttpro_enforce_columns: false },
      { id: "w2", ganttpro_enforce_columns: false },
    ]);

    const workspaceColumns = await client.query(
      "SELECT count(*)::int AS n FROM ganttpro_workspace_column",
    );
    expect(workspaceColumns.rows[0].n).toBe(0);

    // Existing project columns are as they were, none linked.
    const columns = await client.query(
      `SELECT id, project_id, name, slug, position, is_final, ganttpro_workspace_column_id
       FROM "column" ORDER BY id`,
    );
    expect(columns.rows).toEqual([
      {
        id: "c1",
        project_id: "p1",
        name: "To Do",
        slug: "to-do",
        position: 0,
        is_final: false,
        ganttpro_workspace_column_id: null,
      },
      {
        id: "c2",
        project_id: "p1",
        name: "Done",
        slug: "done",
        position: 1,
        is_final: true,
        ganttpro_workspace_column_id: null,
      },
      {
        id: "c3",
        project_id: "p2",
        name: "To Do",
        slug: "to-do",
        position: 0,
        is_final: false,
        ganttpro_workspace_column_id: null,
      },
    ]);

    // Tasks and workflow rules are untouched.
    const tasks = await client.query(
      "SELECT id, status, column_id, position FROM task ORDER BY id",
    );
    expect(tasks.rows).toEqual([
      { id: "t1", status: "to-do", column_id: "c1", position: 1 },
      { id: "t2", status: "done", column_id: "c2", position: 1 },
    ]);
    const rules = await client.query(
      "SELECT id, column_id FROM workflow_rule ORDER BY id",
    );
    expect(rules.rows).toEqual([{ id: "r1", column_id: "c1" }]);
  });

  it("links project columns, follows an id change and unlinks on delete", async () => {
    const client = await upgraded();
    await client.query(
      `INSERT INTO ganttpro_workspace_column (id, workspace_id, name, slug, position)
       VALUES ('wc1', 'w1', 'Backlog', 'backlog', 0)`,
    );
    await client.query(
      `UPDATE "column" SET ganttpro_workspace_column_id = 'wc1' WHERE id = 'c1'`,
    );

    await expect(
      client.query(
        `UPDATE "column" SET ganttpro_workspace_column_id = 'missing' WHERE id = 'c2'`,
      ),
    ).rejects.toThrow(/column_ganttpro_workspace_column_fk/);

    // The same slug cannot exist twice in a workspace, but may in another one.
    await expect(
      client.query(
        `INSERT INTO ganttpro_workspace_column (id, workspace_id, name, slug)
         VALUES ('wc-dup', 'w1', 'Backlog again', 'backlog')`,
      ),
    ).rejects.toThrow(/ganttpro_workspace_column_workspace_id_slug_unique/);
    await client.query(
      `INSERT INTO ganttpro_workspace_column (id, workspace_id, name, slug)
       VALUES ('wc-other', 'w2', 'Backlog', 'backlog')`,
    );

    // ON UPDATE CASCADE.
    await client.query(
      `UPDATE ganttpro_workspace_column SET id = 'wc1-renamed' WHERE id = 'wc1'`,
    );
    const renamed = await client.query(
      `SELECT ganttpro_workspace_column_id AS link FROM "column" WHERE id = 'c1'`,
    );
    expect(renamed.rows[0].link).toBe("wc1-renamed");

    // ON DELETE SET NULL: the project column and its tasks stay.
    await client.query(
      `DELETE FROM ganttpro_workspace_column WHERE id = 'wc1-renamed'`,
    );
    const unlinked = await client.query(
      `SELECT ganttpro_workspace_column_id AS link FROM "column" WHERE id = 'c1'`,
    );
    expect(unlinked.rows[0].link).toBeNull();
    const kept = await client.query(
      `SELECT count(*)::int AS n FROM task WHERE column_id = 'c1'`,
    );
    expect(kept.rows[0].n).toBe(1);

    // Deleting the workspace removes its workspace columns.
    await client.query(`DELETE FROM workspace WHERE id = 'w2'`);
    const gone = await client.query(
      `SELECT count(*)::int AS n FROM ganttpro_workspace_column WHERE workspace_id = 'w2'`,
    );
    expect(gone.rows[0].n).toBe(0);
  });

  it("creates the same objects on a fresh database", async () => {
    await resetTestDatabase();
    const result = await db.$client.query(
      `SELECT
         (SELECT is_nullable FROM information_schema.columns
            WHERE table_name = 'column' AND column_name = 'ganttpro_workspace_column_id') AS link_nullable,
         (SELECT is_nullable || ':' || column_default FROM information_schema.columns
            WHERE table_name = 'workspace' AND column_name = 'ganttpro_enforce_columns') AS flag,
         EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'column_ganttpro_workspace_column_id_idx') AS link_index,
         EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ganttpro_workspace_column_workspaceId_idx') AS workspace_index,
         (SELECT confdeltype::text || confupdtype::text FROM pg_constraint
            WHERE conname = 'column_ganttpro_workspace_column_fk') AS link_fk,
         (SELECT confdeltype FROM pg_constraint
            WHERE conname = 'ganttpro_workspace_column_workspace_id_workspace_id_fk') AS workspace_fk,
         EXISTS (SELECT 1 FROM pg_constraint
            WHERE conname = 'ganttpro_workspace_column_workspace_id_slug_unique') AS slug_unique`,
    );
    // confdeltype "n" is ON DELETE SET NULL, "c" is CASCADE; confupdtype "c" is
    // ON UPDATE CASCADE.
    expect(result.rows[0]).toEqual({
      link_nullable: "YES",
      flag: "NO:false",
      link_index: true,
      workspace_index: true,
      link_fk: "nc",
      workspace_fk: "c",
      slug_unique: true,
    });
  });
});
