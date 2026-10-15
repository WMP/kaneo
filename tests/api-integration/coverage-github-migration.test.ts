import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import db, { getDatabase, schema } from "../../apps/api/src/database";
import getGithubIntegrationByRepositoryId from "../../apps/api/src/github-integration/controllers/get-github-integration-by-repository-id";
import { migrateGitHubIntegration } from "../../apps/api/src/plugins/github/migration";
import { findAllIntegrationsByRepo } from "../../apps/api/src/plugins/github/services/task-service";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// The migration drops the legacy table for good. Other tests in this database
// expect the table from migration 0001, so every test starts from, and the
// file ends with, a recreated table (same DDL as migration 0001).
async function recreateLegacyTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "github_integration" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "repository_owner" text NOT NULL,
      "repository_name" text NOT NULL,
      "installation_id" integer,
      "is_active" boolean DEFAULT true,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "github_integration_project_id_unique" UNIQUE("project_id"),
      CONSTRAINT "github_integration_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade
    )`);
}
async function legacyTableExists() {
  const result = await db.execute(
    sql`SELECT to_regclass('public.github_integration') IS NOT NULL AS present`,
  );
  return (result.rows[0] as { present: boolean }).present;
}

beforeEach(async () => {
  await recreateLegacyTable();
  await resetTestDatabase();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(async () => {
  await recreateLegacyTable();
});

async function project(slug?: string) {
  const { workspace } = await createWorkspaceMember();
  const { project } = await createProjectFixture({
    workspaceId: workspace.id,
    ...(slug ? { slug } : {}),
  });
  return project;
}
async function legacy(
  projectId: string,
  values: Partial<typeof schema.githubIntegrationTable.$inferInsert> = {},
) {
  await db.insert(schema.githubIntegrationTable).values({
    projectId,
    repositoryOwner: "example",
    repositoryName: "repo",
    installationId: 5,
    ...values,
  });
}
async function task(projectId: string, number: number, description: string) {
  const [row] = await db
    .insert(schema.taskTable)
    .values({ projectId, number, title: `T${number}`, description })
    .returning();
  return row;
}

describe("migrateGitHubIntegration", () => {
  it("does nothing when the legacy table does not exist", async () => {
    await db.execute(sql`DROP TABLE "github_integration" CASCADE`);
    const p = await project();
    await task(
      p.id,
      1,
      "Linked to GitHub issue: https://github.com/example/repo/issues/1",
    );
    await migrateGitHubIntegration();
    expect(await db.query.integrationTable.findMany()).toHaveLength(0);
    expect(await db.query.externalLinkTable.findMany()).toHaveLength(0);
  });

  it("drops an empty legacy table without touching other data", async () => {
    await migrateGitHubIntegration();
    expect(await legacyTableExists()).toBe(false);
    expect(await db.query.integrationTable.findMany()).toHaveLength(0);
  });

  it("migrates legacy rows as unverified integrations and keeps existing ones", async () => {
    const migrated = await project();
    const inactive = await project();
    const existing = await project();
    const created = new Date("2023-03-04T05:06:07Z");
    await legacy(migrated.id, { createdAt: created, updatedAt: created });
    await legacy(inactive.id, {
      isActive: false,
      repositoryName: "other",
      installationId: null,
    });
    await legacy(existing.id, { repositoryName: "legacy-name" });
    await db.insert(schema.integrationTable).values({
      projectId: existing.id,
      type: "github",
      config: JSON.stringify({
        repositoryOwner: "kept",
        repositoryName: "kept",
      }),
    });

    await migrateGitHubIntegration();

    expect(await legacyTableExists()).toBe(false);
    const byProject = async (id: string) =>
      db.query.integrationTable.findFirst({
        where: eq(schema.integrationTable.projectId, id),
      });
    const a = await byProject(migrated.id);
    expect(a).toMatchObject({ type: "github", isActive: true });
    expect(a?.createdAt).toEqual(created);
    expect(JSON.parse(a?.config ?? "")).toEqual({
      repositoryOwner: "example",
      repositoryName: "repo",
      installationId: 5,
      branchPattern: "{slug}-{number}",
      commentTaskLinkOnGitHubIssue: true,
      statusTransitions: {
        onBranchPush: "in-progress",
        onPROpen: "in-review",
        onPRMerge: "done",
      },
    });
    const b = await byProject(inactive.id);
    expect(b?.isActive).toBe(false);
    expect(JSON.parse(b?.config ?? "").installationId).toBeNull();
    const c = await byProject(existing.id);
    expect(JSON.parse(c?.config ?? "")).toEqual({
      repositoryOwner: "kept",
      repositoryName: "kept",
    });
    expect(await db.query.integrationTable.findMany()).toHaveLength(3);
  });

  it("never turns a legacy binding into a verified one that receives webhooks", async () => {
    const p = await project();
    await legacy(p.id, { installationId: 10 });
    await migrateGitHubIntegration();
    expect(
      await findAllIntegrationsByRepo({
        installation: { id: 10 },
        repository: { id: 20 },
      }),
    ).toEqual([]);
  });

  it("links tasks that mention a GitHub issue of the bound repository and cleans their descriptions", async () => {
    const p = await project();
    await legacy(p.id);
    const linked = await task(
      p.id,
      1,
      "Fix it\n\n---\n\n*Linked to GitHub issue: https://github.com/example/repo/issues/12*",
    );
    const imported = await task(
      p.id,
      2,
      "Created from GitHub issue: https://github.com/example/repo/issues/7",
    );
    const footer = await task(
      p.id,
      3,
      "Body\n---\n<sub>Task: abc</sub>\nLinked to GitHub issue: https://github.com/example/repo/issues/9",
    );
    const emptied = await task(
      p.id,
      4,
      "\n\n---\n\n*Linked to GitHub issue: https://github.com/example/repo/issues/3*",
    );
    const foreign = await task(
      p.id,
      5,
      "Linked to GitHub issue: https://github.com/someone/else/issues/1",
    );
    const plain = await task(p.id, 6, "No link here");
    const noDescription = await db
      .insert(schema.taskTable)
      .values({ projectId: p.id, number: 7, title: "T7" })
      .returning();
    const otherProject = await project();
    const unrelated = await task(
      otherProject.id,
      1,
      "Linked to GitHub issue: https://github.com/example/repo/issues/1",
    );

    await migrateGitHubIntegration();

    const links = await db.query.externalLinkTable.findMany();
    const summary = links
      .map((l) => ({
        taskId: l.taskId,
        resourceType: l.resourceType,
        externalId: l.externalId,
        url: l.url,
        title: l.title,
        metadata: JSON.parse(l.metadata ?? ""),
      }))
      .sort((x, y) => Number(x.externalId) - Number(y.externalId));
    expect(summary).toEqual([
      {
        taskId: emptied.id,
        resourceType: "issue",
        externalId: "3",
        url: "https://github.com/example/repo/issues/3",
        title: null,
        metadata: { migrated: true, createdFrom: "kaneo" },
      },
      {
        taskId: imported.id,
        resourceType: "issue",
        externalId: "7",
        url: "https://github.com/example/repo/issues/7",
        title: null,
        metadata: { migrated: true, createdFrom: "github" },
      },
      {
        taskId: footer.id,
        resourceType: "issue",
        externalId: "9",
        url: "https://github.com/example/repo/issues/9",
        title: null,
        metadata: { migrated: true, createdFrom: "kaneo" },
      },
      {
        taskId: linked.id,
        resourceType: "issue",
        externalId: "12",
        url: "https://github.com/example/repo/issues/12",
        title: null,
        metadata: { migrated: true, createdFrom: "kaneo" },
      },
    ]);
    const description = async (id: string) =>
      (
        await db.query.taskTable.findFirst({
          where: eq(schema.taskTable.id, id),
        })
      )?.description;
    expect(await description(linked.id)).toBe("Fix it");
    expect(await description(emptied.id)).toBeNull();
    expect(await description(footer.id)).toBe(
      "Body\nLinked to GitHub issue: https://github.com/example/repo/issues/9",
    );
    expect(await description(imported.id)).toBe(imported.description);
    expect(await description(foreign.id)).toBe(foreign.description);
    expect(await description(plain.id)).toBe("No link here");
    expect(await description(noDescription[0].id)).toBeNull();
    expect(await description(unrelated.id)).toBe(unrelated.description);
  });

  it("does not duplicate an existing issue link but still cleans the description", async () => {
    const p = await project();
    await legacy(p.id);
    const t = await task(
      p.id,
      1,
      "Text\n\n---\n\n*Linked to GitHub issue: https://github.com/example/repo/issues/12*",
    );
    // Migrating twice must not duplicate: seed the link the first run would add.
    await migrateGitHubIntegration();
    expect(await db.query.externalLinkTable.findMany()).toHaveLength(1);
    await recreateLegacyTable();
    await legacy(p.id, { repositoryName: "repo" });
    await db
      .update(schema.taskTable)
      .set({
        description:
          "Text 2\n\n---\n\n*Linked to GitHub issue: https://github.com/example/repo/issues/12*",
      })
      .where(eq(schema.taskTable.id, t.id));
    await migrateGitHubIntegration();
    expect(await db.query.externalLinkTable.findMany()).toHaveLength(1);
    expect(
      (
        await db.query.taskTable.findFirst({
          where: eq(schema.taskTable.id, t.id),
        })
      )?.description,
    ).toBe("Text 2");
  });

  it("keeps the legacy table and rethrows when a write fails, so the migration can be retried", async () => {
    const p = await project();
    await legacy(p.id);
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION coverage_block_integration() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'blocked by test'; END; $$ LANGUAGE plpgsql`);
    await db.execute(sql`
      CREATE TRIGGER coverage_block_integration BEFORE INSERT ON integration
      FOR EACH ROW EXECUTE FUNCTION coverage_block_integration()`);
    try {
      await expect(migrateGitHubIntegration()).rejects.toThrow();
    } finally {
      await db.execute(
        sql`DROP TRIGGER coverage_block_integration ON integration`,
      );
      await db.execute(sql`DROP FUNCTION coverage_block_integration()`);
    }
    expect(await legacyTableExists()).toBe(true);
    expect(await db.query.githubIntegrationTable.findMany()).toHaveLength(1);
    expect(await db.query.integrationTable.findMany()).toHaveLength(0);

    await migrateGitHubIntegration();
    expect(await db.query.integrationTable.findMany()).toHaveLength(1);
  });
});

describe("legacy table helpers", () => {
  it("finds a legacy integration by owner and name only", async () => {
    const a = await project();
    const b = await project();
    await legacy(a.id, { repositoryOwner: "example", repositoryName: "one" });
    await legacy(b.id, { repositoryOwner: "example", repositoryName: "two" });
    expect(
      (await getGithubIntegrationByRepositoryId("example", "two"))?.projectId,
    ).toBe(b.id);
    expect(
      await getGithubIntegrationByRepositoryId("example", "three"),
    ).toBeUndefined();
    expect(
      await getGithubIntegrationByRepositoryId("other", "one"),
    ).toBeUndefined();
  });

  it("characterization: a failing existence check is treated as no legacy table and nothing is migrated", async () => {
    const p = await project();
    await legacy(p.id);
    const execute = vi
      .spyOn(getDatabase(), "execute")
      .mockRejectedValueOnce(new Error("connection reset"));
    await migrateGitHubIntegration();
    execute.mockRestore();
    expect(await legacyTableExists()).toBe(true);
    expect(await db.query.integrationTable.findMany()).toHaveLength(0);
  });
});
