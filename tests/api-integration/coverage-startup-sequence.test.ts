import { createServer } from "node:net";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// The GitHub migration drops the legacy `github_integration` table, which a
// freshly migrated database still has. The table belongs to the shared test
// database, so that one step is replaced here; the other steps run for real.
const githubMigration = vi.hoisted(() => ({ run: vi.fn(async () => {}) }));
vi.mock("../../apps/api/src/plugins/github/migration", () => ({
  migrateGitHubIntegration: githubMigration.run,
}));

// The API start-up sequence (docs/agent-guide/database.md, "How migrations
// apply"): wait for the database, migrate, repair legacy data, start the
// background services. The data repairs run against the real test database.

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

// runStartupTasks registers the integration plugins, which a process does once.
// Every scenario therefore starts from a fresh module registry, like a new
// process would.
const stoppers: Array<() => Promise<void>> = [];

async function freshApi() {
  vi.resetModules();
  const index = await import("../../apps/api/src/index");
  const database = await import("../../apps/api/src/database");
  const scheduler = await import("../../apps/api/src/scheduler");
  const ws = await import("../../apps/api/src/ws");
  stoppers.push(async () => {
    scheduler.shutdownScheduler();
    await ws.shutdownWebSocketAdapter();
    await database.getDatabasePool().end();
  });
  return {
    runStartupTasks: index.runStartupTasks,
    startServer: index.startServer,
    getDatabase: database.getDatabase,
    shutdownScheduler: scheduler.shutdownScheduler,
  };
}

async function columnNames(table: string) {
  const result = await db.execute<{ column_name: string }>(
    sql`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}`,
  );
  return result.rows.map((row) => row.column_name);
}

beforeEach(async () => {
  githubMigration.run.mockClear();
  await resetTestDatabase();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  for (const stop of stoppers.splice(0)) await stop();
  vi.restoreAllMocks();
});

describe("runStartupTasks", () => {
  it("repairs a legacy-shaped database and is safe to run again", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    // Legacy project: no column rows; tasks only carry a status slug and a
    // single assignee. Legacy session/invitation shapes are written too.
    await db
      .delete(schema.columnTable)
      .where(eq(schema.columnTable.projectId, project.id));
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        userId: member.user.id,
        assigneeId: member.user.id,
        title: "Legacy task",
        status: "in-progress",
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning();
    await db.execute(
      sql`ALTER TABLE session RENAME COLUMN active_organization_id TO active_workspace_id`,
    );
    await db.execute(sql`ALTER TABLE invitation DROP COLUMN created_at`);

    const { runStartupTasks } = await freshApi();
    await runStartupTasks();
    expect(githubMigration.run).toHaveBeenCalledTimes(1);

    // Column repairs.
    const sessionColumns = await columnNames("session");
    expect(sessionColumns).toContain("active_organization_id");
    expect(sessionColumns).not.toContain("active_workspace_id");
    expect(await columnNames("invitation")).toContain("created_at");
    // Project columns and the task link.
    const columns = await db
      .select()
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, project.id));
    expect(columns.map((c) => c.slug).sort()).toEqual([
      "done",
      "in-progress",
      "in-review",
      "to-do",
    ]);
    const [linked] = await db
      .select({ columnId: schema.taskTable.columnId })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    expect(linked.columnId).toBe(
      columns.find((c) => c.slug === "in-progress")?.id,
    );
    // Assignment backfill with the full allocation.
    const assignments = await db
      .select()
      .from(schema.taskAssignmentTable)
      .where(eq(schema.taskAssignmentTable.taskId, task.id));
    expect(assignments).toEqual([
      expect.objectContaining({ userId: member.user.id, units: 100 }),
    ]);
    // Default roles for the workspace that had none.
    const roles = await db
      .select({ role: schema.workspaceRoleTable.role })
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, member.workspace.id));
    expect(roles.map((r) => r.role).sort()).toEqual([
      "admin",
      "member",
      "viewer",
    ]);
    // The background services were started.
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Scheduler started"),
    );
  });

  it("stops with a descriptive error when a repair fails", async () => {
    const { runStartupTasks, getDatabase } = await freshApi();
    const execute = getDatabase().execute.bind(getDatabase());
    vi.spyOn(getDatabase(), "execute").mockImplementation(((query: {
      queryChunks?: unknown[];
    }) =>
      JSON.stringify(query.queryChunks ?? []).includes("workspace_member")
        ? Promise.reject(new Error("repair exploded"))
        : execute(query as never)) as never);

    await expect(runStartupTasks()).rejects.toThrow(
      new RegExp(
        `Database migrations failed for .*/${new URL(process.env.DATABASE_URL ?? "").pathname.slice(1)} `,
      ),
    );
  });
});

describe("startServer", () => {
  it("serves the API after start-up and shuts down once on repeated signals", async () => {
    const { startServer } = await freshApi();
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const port = await freePort();

    await startServer(
      // The app wires its own WebSocket server; a no-op keeps the test local.
      (() => undefined) as never,
      port,
    );
    await vi.waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(await response.json()).toEqual({ status: "ok" });
    });

    process.emit("SIGTERM");
    process.emit("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith("🛑 Shutting down gracefully...");
    await expect(
      fetch(`http://127.0.0.1:${port}/api/health`),
    ).rejects.toThrow();
  });

  it("exits with status 1 and starts no server when start-up fails", async () => {
    const { startServer, getDatabase } = await freshApi();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit called");
    }) as never);
    const execute = getDatabase().execute.bind(getDatabase());
    vi.spyOn(getDatabase(), "execute").mockImplementation(((query: {
      queryChunks?: unknown[];
    }) =>
      JSON.stringify(query.queryChunks ?? []).includes("workspace_member")
        ? Promise.reject(new Error("repair exploded"))
        : execute(query as never)) as never);
    const port = await freePort();

    await expect(startServer((() => undefined) as never, port)).rejects.toThrow(
      "exit called",
    );

    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      "❌ Database migration failed!",
      expect.any(Error),
    );
    await expect(
      fetch(`http://127.0.0.1:${port}/api/health`),
    ).rejects.toThrow();
  });
});
