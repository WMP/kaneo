import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import migrateOrganizations from "../../apps/api/src/utils/migrate-organizations";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("migrateOrganizations (not wired into start-up)", () => {
  it("characterization: does nothing without workspaces", async () => {
    await expect(migrateOrganizations()).resolves.toBeUndefined();
    expect(await db.select().from(schema.workspaceTable)).toEqual([]);
  });

  // The helper is not imported anywhere. Better Auth's workspaces ARE the
  // `workspace` rows now, so creating an "organization" for each of them
  // collides with the existing row. Kept as a characterization of today's
  // behavior; the question for the owners is whether to delete the helper.
  it("characterization: refuses a workspace that already exists and changes nothing", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });

    await expect(migrateOrganizations()).rejects.toThrow(
      "Organization already exists",
    );

    const stored = await db.select().from(schema.workspaceTable);
    expect(stored.map((w) => w.id)).toEqual([workspace.id]);
  });
});
