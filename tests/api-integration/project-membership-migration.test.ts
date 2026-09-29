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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Proves migration 0056 on a populated database: a scratch database is
// migrated to 0055, populated with workspaces holding every kind of member and
// several projects, then upgraded. The migration creates the project
// membership tables and NO rows: owners and admins keep reaching every existing
// project through the full-access rule, everybody else has to be added.
//
// Every test builds its own scratch database (`kaneo_x_test` ->
// `kaneo_x_upgrade_test`), so the tests do not depend on each other.

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../apps/api/drizzle");
const TARGET_TAG = "0056_ganttpro_project_members";

function withDatabase(connectionString: string, database: string) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

describe("migration 0056 project membership", () => {
  const baseUrl = process.env.DATABASE_URL as string;
  const scratchName = `${new URL(baseUrl).pathname
    .replace(/^\//, "")
    .replace(/_test$/, "")}_upgrade_test`;
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

  // A fresh scratch database at 0055, populated by `populate`, then upgraded.
  async function upgraded(populate: (db: Pool) => Promise<void>) {
    const scratch = new Pool({ connectionString: scratchUrl });
    pool = scratch;
    const scratchDb = drizzle(scratch);
    await migrate(scratchDb, { migrationsFolder: priorFolder });
    const before = await scratch.query(
      "SELECT to_regclass('public.ganttpro_project_member') AS t",
    );
    expect(before.rows[0].t).toBeNull();
    await populate(scratch);
    await migrate(scratchDb, { migrationsFolder });
    return scratch;
  }

  beforeEach(async () => {
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
  }, 120_000);

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await pool?.end();
    pool = null;
    if (priorFolder) rmSync(priorFolder, { recursive: true, force: true });
    await dropScratch();
  });

  const now = new Date();

  async function seed(db: Pool) {
    for (const name of ["owner", "admin", "member", "viewer", "manager"]) {
      await db.query(
        `INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, $1, $2, true)`,
        [`u-${name}`, `${name}@example.com`],
      );
    }
    await db.query(
      `INSERT INTO workspace (id, name, slug, created_at) VALUES ('w1', 'w1', 'w1', $1)`,
      [now],
    );
    // A custom role that grants workspace:manage_settings.
    await db.query(
      `INSERT INTO workspace_role (id, workspace_id, role, permission, created_at)
       VALUES ('r-manager', 'w1', 'manager', $1, $2)`,
      [JSON.stringify({ workspace: ["read", "manage_settings"] }), now],
    );
    const roles: [string, string][] = [
      ["owner", "owner"],
      ["admin", "admin"],
      ["member", "member"],
      ["viewer", "viewer"],
      ["manager", "manager"],
    ];
    for (const [user, role] of roles) {
      await db.query(
        `INSERT INTO workspace_member (id, workspace_id, user_id, role, joined_at)
         VALUES ($1, 'w1', $2, $3, $4)`,
        [`m-${user}`, `u-${user}`, role, now],
      );
    }
    for (const id of ["p1", "p2"]) {
      await db.query(
        `INSERT INTO project (id, workspace_id, slug, name) VALUES ($1, 'w1', $1, $1)`,
        [id],
      );
    }
  }

  it("creates the tables and constraints and no rows", async () => {
    const db = await upgraded(seed);

    const rows = await db.query(
      "SELECT count(*)::int AS n FROM ganttpro_project_member",
    );
    expect(rows.rows[0].n).toBe(0);
    const invitations = await db.query(
      "SELECT count(*)::int AS n FROM ganttpro_invitation_project",
    );
    expect(invitations.rows[0].n).toBe(0);

    // The unique (project, user) pair.
    await db.query(
      `INSERT INTO ganttpro_project_member (id, project_id, user_id, role)
       VALUES ('a', 'p1', 'u-member', 'viewer')`,
    );
    await expect(
      db.query(
        `INSERT INTO ganttpro_project_member (id, project_id, user_id, role)
         VALUES ('b', 'p1', 'u-member', 'member')`,
      ),
    ).rejects.toThrow(/ganttpro_project_member_project_user_unique/);

    // owner is never a project role, alone or inside a composite name.
    for (const role of ["owner", "admin,owner", "member, owner"]) {
      await expect(
        db.query(
          `INSERT INTO ganttpro_project_member (id, project_id, user_id, role)
           VALUES ('c', 'p2', 'u-viewer', $1)`,
          [role],
        ),
      ).rejects.toThrow(/ganttpro_project_member_role_not_owner/);
    }
    await db.query(
      `INSERT INTO invitation (id, workspace_id, email, role, status, expires_at, inviter_id)
       VALUES ('i1', 'w1', 'x@example.com', 'member', 'pending', $1, 'u-owner')`,
      [new Date(now.getTime() + 86_400_000)],
    );
    await expect(
      db.query(
        `INSERT INTO ganttpro_invitation_project (id, invitation_id, project_id, role)
         VALUES ('ip1', 'i1', 'p1', 'owner')`,
      ),
    ).rejects.toThrow(/ganttpro_invitation_project_role_not_owner/);
    await db.query(
      `INSERT INTO ganttpro_invitation_project (id, invitation_id, project_id, role)
       VALUES ('ip2', 'i1', 'p1', 'viewer')`,
    );
    await expect(
      db.query(
        `INSERT INTO ganttpro_invitation_project (id, invitation_id, project_id, role)
         VALUES ('ip3', 'i1', 'p1', 'member')`,
      ),
    ).rejects.toThrow(/ganttpro_invitation_project_invitation_project_unique/);

    // Rows follow their project and user.
    await db.query("DELETE FROM project WHERE id = 'p1'");
    const cascaded = await db.query(
      "SELECT 1 FROM ganttpro_project_member WHERE project_id = 'p1'",
    );
    expect(cascaded.rowCount).toBe(0);
    const cascadedInvites = await db.query(
      "SELECT 1 FROM ganttpro_invitation_project WHERE project_id = 'p1'",
    );
    expect(cascadedInvites.rowCount).toBe(0);
  }, 120_000);

  it("keeps existing projects reachable for full-access users only", async () => {
    await upgraded(seed);

    // Run the real access rule against the migrated data: point the lazily
    // created database pool at the scratch database for a fresh module graph.
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", scratchUrl);
    const access = await import("../../apps/api/src/utils/project-access");
    const database = await import("../../apps/api/src/database");
    try {
      for (const project of ["p1", "p2"]) {
        expect(
          await access.resolveProjectAccess("u-owner", project),
        ).toMatchObject({ mode: "full", unrestricted: true });
        expect(
          await access.resolveProjectAccess("u-admin", project),
        ).toMatchObject({ mode: "full", unrestricted: false });
        expect(
          await access.resolveProjectAccess("u-manager", project),
        ).toMatchObject({ mode: "full", unrestricted: false });
        expect(
          await access.resolveProjectAccess("u-member", project),
        ).toBeNull();
        expect(
          await access.resolveProjectAccess("u-viewer", project),
        ).toBeNull();
      }
      expect(await access.accessibleProjectIds("u-admin", "w1")).toBeNull();
      expect(await access.accessibleProjectIds("u-member", "w1")).toEqual([]);

      // Adding a member opens exactly that project.
      await database.default.insert(database.schema.projectMemberTable).values({
        projectId: "p1",
        userId: "u-member",
        role: "member",
      });
      expect(await access.resolveProjectAccess("u-member", "p1")).toMatchObject(
        { mode: "member" },
      );
      expect(await access.resolveProjectAccess("u-member", "p2")).toBeNull();
    } finally {
      await database.getDatabasePool().end();
    }
  }, 120_000);
});
