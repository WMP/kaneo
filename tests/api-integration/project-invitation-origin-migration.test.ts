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

// Migration 0057 adds `ganttpro_invitation_origin` and a trigger that cancels a
// project-origin pending invitation when its last project row goes away. It
// backfills nothing: invitations that exist before the upgrade have no origin
// and are never canceled by the trigger. The scratch database is migrated to
// 0056, populated, then upgraded; a fresh database (every other integration
// test) is checked for the same objects.

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../apps/api/drizzle");
const TARGET_TAG = "0057_ganttpro_invitation_origin";

function withDatabase(connectionString: string, database: string) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

describe("migration 0057 invitation origin", () => {
  const baseUrl = process.env.DATABASE_URL as string;
  const scratchName = `${new URL(baseUrl).pathname
    .replace(/^\//, "")
    .replace(/_test$/, "")}_origin_upgrade_test`;
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
    if (!scratchName.endsWith("_origin_upgrade_test")) {
      throw new Error(`Refusing to drop "${scratchName}"`);
    }
    await withAdmin((admin) =>
      admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`),
    );
  }

  beforeAll(() => {
    priorFolder = mkdtempSync(join(tmpdir(), "kaneo-migrations-0056-"));
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
    for (const id of ["p1", "p2"]) {
      await client.query(
        `INSERT INTO project (id, workspace_id, slug, name) VALUES ($1, 'w1', $1, $1)`,
        [id],
      );
    }
    // An invitation from before the upgrade: pending, with a project.
    await client.query(
      `INSERT INTO invitation (id, workspace_id, email, role, status, expires_at, created_at, inviter_id)
       VALUES ('old', 'w1', 'old@example.com', 'viewer', 'pending', $1, $2, 'u1')`,
      [new Date(Date.now() + 3_600_000), now],
    );
    await client.query(
      `INSERT INTO ganttpro_invitation_project (id, invitation_id, project_id, role)
       VALUES ('old-p1', 'old', 'p1', 'viewer')`,
    );
  }

  async function upgraded() {
    const scratch = new Pool({ connectionString: scratchUrl });
    pool = scratch;
    const scratchDb = drizzle(scratch);
    await runMigrations(scratchDb, { migrationsFolder: priorFolder });
    const before = await scratch.query(
      "SELECT to_regclass('public.ganttpro_invitation_origin') AS t",
    );
    expect(before.rows[0].t).toBeNull();
    await seed(scratch);
    await runMigrations(scratchDb, { migrationsFolder });
    return scratch;
  }

  async function statusOf(client: Pool, id: string) {
    const result = await client.query(
      "SELECT status FROM invitation WHERE id = $1",
      [id],
    );
    return result.rows[0]?.status as string | undefined;
  }

  async function newInvitation(client: Pool, id: string, projects: string[]) {
    await client.query(
      `INSERT INTO invitation (id, workspace_id, email, role, status, expires_at, created_at, inviter_id)
       VALUES ($1, 'w1', $2, 'viewer', 'pending', $3, $4, 'u1')`,
      [id, `${id}@example.com`, new Date(Date.now() + 3_600_000), now],
    );
    await client.query(
      `INSERT INTO ganttpro_invitation_origin (invitation_id, source) VALUES ($1, 'project')`,
      [id],
    );
    for (const project of projects) {
      await client.query(
        `INSERT INTO ganttpro_invitation_project (id, invitation_id, project_id, role)
         VALUES ($1, $2, $3, 'viewer')`,
        [`${id}-${project}`, id, project],
      );
    }
  }

  it("upgrades a populated database without touching existing invitations", async () => {
    const client = await upgraded();

    const origins = await client.query(
      "SELECT count(*)::int AS n FROM ganttpro_invitation_origin",
    );
    expect(origins.rows[0].n).toBe(0);
    expect(await statusOf(client, "old")).toBe("pending");

    // An invitation without an origin row is never canceled by the trigger.
    await client.query("DELETE FROM project WHERE id = 'p1'");
    expect(await statusOf(client, "old")).toBe("pending");
    const rows = await client.query(
      "SELECT count(*)::int AS n FROM ganttpro_invitation_project WHERE invitation_id = 'old'",
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it("cancels a project invitation when its last project row goes away", async () => {
    const client = await upgraded();
    await newInvitation(client, "one", ["p1"]);
    await newInvitation(client, "two", ["p1", "p2"]);

    // Deleting the project cascades to its invitation rows.
    await client.query("DELETE FROM project WHERE id = 'p1'");
    expect(await statusOf(client, "one")).toBe("canceled");
    expect(await statusOf(client, "two")).toBe("pending");

    // Removing the row itself (a move deletes them) does the same.
    await client.query(
      "DELETE FROM ganttpro_invitation_project WHERE invitation_id = 'two'",
    );
    expect(await statusOf(client, "two")).toBe("canceled");
  });

  it("leaves accepted invitations alone and enforces the source", async () => {
    const client = await upgraded();
    await newInvitation(client, "done", ["p2"]);
    await client.query(
      "UPDATE invitation SET status = 'accepted' WHERE id = 'done'",
    );
    await client.query(
      "DELETE FROM ganttpro_invitation_project WHERE invitation_id = 'done'",
    );
    expect(await statusOf(client, "done")).toBe("accepted");

    await expect(
      client.query(
        `INSERT INTO ganttpro_invitation_origin (invitation_id, source) VALUES ('old', 'other')`,
      ),
    ).rejects.toThrow(/ganttpro_invitation_origin_source_check/);

    // The origin row follows its invitation.
    await client.query("DELETE FROM invitation WHERE id = 'done'");
    const left = await client.query(
      "SELECT count(*)::int AS n FROM ganttpro_invitation_origin WHERE invitation_id = 'done'",
    );
    expect(left.rows[0].n).toBe(0);
  });

  it("creates the same objects on a fresh database", async () => {
    await resetTestDatabase();
    const result = await db.$client.query(
      `SELECT
         to_regclass('public.ganttpro_invitation_origin') IS NOT NULL AS "table",
         EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ganttpro_invitation_project_cancel_empty') AS "trigger"`,
    );
    expect(result.rows[0]).toEqual({ table: true, trigger: true });
  });
});
