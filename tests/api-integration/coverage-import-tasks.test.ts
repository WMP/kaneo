import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../apps/api/src/events", async (original) => ({
  ...(await original<object>()),
  publishEvent: vi.fn(async () => undefined),
}));

import db, { schema } from "../../apps/api/src/database";
import importTasks from "../../apps/api/src/task/controllers/import-tasks";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("importTasks: row failures do not stop the import", () => {
  it("reports a row whose date cannot be stored, keeps the others and leaves the task numbering gap-free", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });

    const result = await importTasks(
      project.id,
      [
        { title: "First", status: "to-do" },
        { title: "Broken date", status: "to-do", startDate: "not-a-date" },
        { title: "Third", status: "no-such-column", priority: "bogus" },
      ] as never,
      owner.user.id,
    );

    expect(result.results).toMatchObject({
      total: 3,
      successful: 2,
      failed: 1,
    });
    const [first, broken, third] = result.results.tasks as Array<{
      success: boolean;
      error?: string;
      warnings?: string[];
      task: {
        title: string;
        number?: number;
        status?: string;
        priority?: string;
      };
    }>;
    expect(first).toMatchObject({
      success: true,
      task: { title: "First", number: 1 },
    });
    expect(broken).toMatchObject({
      success: false,
      task: { title: "Broken date" },
    });
    expect(typeof broken?.error).toBe("string");
    // The failed row rolled back its number: the next row takes 2, not 3.
    expect(third).toMatchObject({
      success: true,
      task: {
        title: "Third",
        number: 2,
        status: "planned",
        priority: "no-priority",
      },
    });
    expect(third?.warnings).toEqual([
      'Unknown status "no-such-column" mapped to "planned"',
      'Unknown priority "bogus" mapped to "no-priority"',
    ]);
    const stored = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, project.id));
    expect(stored.map((t) => t.title).sort()).toEqual(["First", "Third"]);
  });
});
