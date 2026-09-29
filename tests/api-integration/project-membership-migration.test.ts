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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Proves migration 0056 on a populated database: the schema is migrated to
// 0055, workspaces with every kind of member and several projects are
// inserted, then 0056 is applied. Runs on its own scratch database next to the
// test database (`kaneo_x_test` -> `kaneo_x_upgrade_test`), which is dropped
// before and after the test.

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../apps/api/drizzle");
const TARGET_TAG = "0056_ganttpro_project_members";

function scratchDatabaseName(connectionString: string) {
  const name = new URL(connectionString).pathname.replace(/^\//, "");
  return `${name.replace(/_test$/, "")}_upgrade_test`;
}

function withDatabase(connectionString: string, database: string) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

describe("migration 0056 project membership backfill", () => {
  const baseUrl = process.env.DATABASE_URL as string;
  const scratchName = scratchDatabaseName(baseUrl);
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
    if (!scratchName.endsWith("_upgrade_test")) {
      throw new Error(`Refusing to drop "${scratchName}"`);
    }
    await withAdmin((admin) =>
      admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`),
    );
  }

  beforeAll(async () => {
    await dropScratch();
    await withAdmin((admin) => admin.query(`CREATE DATABASE "${scratchName}"`));

    // A copy of the migrations folder whose journal stops before 0056.
    priorFolder = mkdtempSync(join(tmpdir(), "kaneo-migrations-0055-"));
    cpSync(migrationsFolder, priorFolder, { recursive: true });
    const journalPath = join(priorFolder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: { tag: string }[];
    };
    const cut = journal.entries.findIndex((entry) => entry.tag === TARGET_TAG);
    expect(cut).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, cut);
    writeFileSync(journalPath, JSON.stringify(journal));

    pool = new Pool({ connectionString: scratchUrl });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (priorFolder) rmSync(priorFolder, { recursive: true, force: true });
    await dropScratch();
  });

  it("creates memberships only for owners and admins, with role admin", async () => {
    const scratch = pool as Pool;
    const scratchDb = drizzle(scratch);
    await migrate(scratchDb, { migrationsFolder: priorFolder });

    const before = await scratch.query(
      "SELECT to_regclass('public.ganttpro_project_member') AS t",
    );
    expect(before.rows[0].t).toBeNull();

    const now = new Date();
    const users = ["owner", "admin", "member", "viewer", "custom", "coowner"];
    for (const name of users) {
      await scratch.query(
        `INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, $1, $2, true)`,
        [`u-${name}`, `${name}@example.com`],
      );
    }
    for (const id of ["w1", "w2"]) {
      await scratch.query(
        "INSERT INTO workspace (id, name, slug, created_at) VALUES ($1, $1, $1, $2)",
        [id, now],
      );
    }
    const memberships: [string, string, string][] = [
      ["w1", "owner", "owner"],
      ["w1", "admin", "admin"],
      ["w1", "member", "member"],
      ["w1", "viewer", "viewer"],
      ["w1", "custom", "triager"],
      ["w1", "coowner", "admin,owner"],
      // The same person is an ordinary member elsewhere.
      ["w2", "owner", "member"],
      ["w2", "admin", "owner"],
    ];
    for (const [workspaceId, user, role] of memberships) {
      await scratch.query(
        `INSERT INTO workspace_member (id, workspace_id, user_id, role, joined_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [`m-${workspaceId}-${user}`, workspaceId, `u-${user}`, role, now],
      );
    }
    const projects: [string, string][] = [
      ["p1", "w1"],
      ["p2", "w1"],
      ["p3", "w2"],
    ];
    for (const [id, workspaceId] of projects) {
      await scratch.query(
        "INSERT INTO project (id, workspace_id, slug, name) VALUES ($1, $2, $1, $1)",
        [id, workspaceId],
      );
    }

    await migrate(scratchDb, { migrationsFolder });

    const { rows } = await scratch.query<{
      project_id: string;
      user_id: string;
      role: string;
    }>(
      `SELECT project_id, user_id, role FROM ganttpro_project_member
       ORDER BY project_id, user_id`,
    );
    expect(rows).toEqual([
      { project_id: "p1", user_id: "u-admin", role: "admin" },
      { project_id: "p1", user_id: "u-coowner", role: "admin" },
      { project_id: "p1", user_id: "u-owner", role: "admin" },
      { project_id: "p2", user_id: "u-admin", role: "admin" },
      { project_id: "p2", user_id: "u-coowner", role: "admin" },
      { project_id: "p2", user_id: "u-owner", role: "admin" },
      // w2: only its owner is backfilled; the plain member is not.
      { project_id: "p3", user_id: "u-admin", role: "admin" },
    ]);

    // Constraints the application relies on.
    await expect(
      scratch.query(
        `INSERT INTO ganttpro_project_member (id, project_id, user_id, role)
         VALUES ('dup', 'p1', 'u-admin', 'viewer')`,
      ),
    ).rejects.toThrow(/ganttpro_project_member_project_user_unique/);
    await scratch.query("DELETE FROM project WHERE id = 'p3'");
    const cascaded = await scratch.query(
      "SELECT 1 FROM ganttpro_project_member WHERE project_id = 'p3'",
    );
    expect(cascaded.rowCount).toBe(0);
  }, 120_000);

  it("is idempotent when the backfill statement is run again", async () => {
    const scratch = pool as Pool;
    const before = await scratch.query(
      "SELECT count(*)::int AS n FROM ganttpro_project_member",
    );
    const sqlText = readFileSync(
      join(migrationsFolder, `${TARGET_TAG}.sql`),
      "utf8",
    );
    const backfill = sqlText
      .split("--> statement-breakpoint")
      .map((part) => part.trim())
      .find((part) => part.includes("INSERT INTO"));
    expect(backfill).toBeTruthy();
    await scratch.query(backfill as string);
    const after = await scratch.query(
      "SELECT count(*)::int AS n FROM ganttpro_project_member",
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
