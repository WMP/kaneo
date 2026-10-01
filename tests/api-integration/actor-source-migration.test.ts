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

// Migration 0059 adds the nullable `activity.actor_via`, `activity.actor_token_hint`
// and `session.auth_via`. It backfills nothing: existing rows stay null and are
// shown as a plain user. The scratch database is migrated to 0058, populated
// with an activity row and a session, then upgraded; a fresh database (every
// other integration test) is checked for the same columns.

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../apps/api/drizzle");
const TARGET_TAG = "0059_ganttpro_actor_source";

function withDatabase(connectionString: string, database: string) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

describe("migration 0059 actor source", () => {
  const baseUrl = process.env.DATABASE_URL as string;
  const scratchName = `${new URL(baseUrl).pathname
    .replace(/^\//, "")
    .replace(/_test$/, "")}_actor_source_upgrade_test`;
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
    if (!scratchName.endsWith("_actor_source_upgrade_test")) {
      throw new Error(`Refusing to drop "${scratchName}"`);
    }
    await withAdmin((admin) =>
      admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`),
    );
  }

  beforeAll(() => {
    priorFolder = mkdtempSync(join(tmpdir(), "kaneo-migrations-0058-"));
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

  async function columnCount(client: Pool) {
    const result = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE (table_name = 'activity' AND column_name IN ('actor_via', 'actor_token_hint'))
          OR (table_name = 'session' AND column_name = 'auth_via')`,
    );
    return result.rows[0].n as number;
  }

  it("upgrades a populated database and leaves existing rows null", async () => {
    const scratch = new Pool({ connectionString: scratchUrl });
    pool = scratch;
    const scratchDb = drizzle(scratch);
    await migrate(scratchDb, { migrationsFolder: priorFolder });
    expect(await columnCount(scratch)).toBe(0);

    await scratch.query(
      `INSERT INTO "user" (id, name, email, email_verified) VALUES ('u1', 'u1', 'u1@example.com', true)`,
    );
    await scratch.query(
      `INSERT INTO workspace (id, name, slug, created_at) VALUES ('w1', 'w1', 'w1', $1)`,
      [now],
    );
    await scratch.query(
      `INSERT INTO project (id, workspace_id, slug, name) VALUES ('p1', 'w1', 'p1', 'p1')`,
    );
    await scratch.query(
      `INSERT INTO task (id, project_id, title, status, priority, number, position)
       VALUES ('t1', 'p1', 't1', 'to-do', 'medium', 1, 1)`,
    );
    await scratch.query(
      `INSERT INTO activity (id, task_id, type, user_id, content) VALUES ('a1', 't1', 'comment', 'u1', 'hello')`,
    );
    await scratch.query(
      `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id)
       VALUES ('s1', $1, 'token-1', $2, $2, 'u1')`,
      [new Date(Date.now() + 3_600_000), now],
    );

    await migrate(scratchDb, { migrationsFolder });

    expect(await columnCount(scratch)).toBe(3);
    const activity = await scratch.query(
      "SELECT id, content, actor_via, actor_token_hint FROM activity",
    );
    expect(activity.rows).toEqual([
      { id: "a1", content: "hello", actor_via: null, actor_token_hint: null },
    ]);
    const session = await scratch.query("SELECT id, auth_via FROM session");
    expect(session.rows).toEqual([{ id: "s1", auth_via: null }]);
  });

  it("creates nullable columns without defaults on a fresh database", async () => {
    await resetTestDatabase();
    const result = await db.$client.query(
      `SELECT table_name, column_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE (table_name = 'activity' AND column_name IN ('actor_via', 'actor_token_hint'))
          OR (table_name = 'session' AND column_name = 'auth_via')
       ORDER BY table_name, column_name`,
    );
    expect(result.rows).toEqual([
      {
        table_name: "activity",
        column_name: "actor_token_hint",
        is_nullable: "YES",
        column_default: null,
      },
      {
        table_name: "activity",
        column_name: "actor_via",
        is_nullable: "YES",
        column_default: null,
      },
      {
        table_name: "session",
        column_name: "auth_via",
        is_nullable: "YES",
        column_default: null,
      },
    ]);
  });
});
