import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  __dirname,
  "../../../apps/api/drizzle/0054_ganttpro_workspace_custom_fields.sql",
);

describe("0054_ganttpro_workspace_custom_fields migration", () => {
  const sql = readFileSync(migrationPath, "utf-8");

  it("is additive only — no destructive statements", () => {
    const upperSql = sql.toUpperCase();
    expect(upperSql).not.toMatch(/DROP TABLE/);
    expect(upperSql).not.toMatch(/DROP COLUMN/);
    expect(upperSql).not.toMatch(/TRUNCATE/);
  });

  it("relaxes project_id to nullable instead of dropping it", () => {
    expect(sql).toContain(
      'ALTER TABLE "custom_field_definition" ALTER COLUMN "project_id" DROP NOT NULL',
    );
  });

  it("adds the workspace_id column and its new table", () => {
    expect(sql).toContain(
      'ALTER TABLE "custom_field_definition" ADD COLUMN "ganttpro_workspace_id" text',
    );
    expect(sql).toContain('CREATE TABLE "ganttpro_project_hidden_field"');
  });

  it("adds the scope check constraint requiring exactly one of project_id/workspace_id", () => {
    expect(sql).toContain("ganttpro_custom_field_scope");
    expect(sql).toContain(
      '("custom_field_definition"."project_id" IS NOT NULL) AND ("custom_field_definition"."ganttpro_workspace_id" IS NULL)',
    );
    expect(sql).toContain(
      '("custom_field_definition"."project_id" IS NULL) AND ("custom_field_definition"."ganttpro_workspace_id" IS NOT NULL)',
    );
  });
});
