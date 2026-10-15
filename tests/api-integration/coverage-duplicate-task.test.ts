import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const s3 = vi.hoisted(() => ({
  copyTaskAssetObject: vi.fn(async () => undefined),
  deleteS3Object: vi.fn(async () => undefined),
}));
vi.mock("../../apps/api/src/storage/s3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/api/src/storage/s3")>()),
  copyTaskAssetObject: s3.copyTaskAssetObject,
  deleteS3Object: s3.deleteS3Object,
}));
vi.mock("../../apps/api/src/events", async (original) => ({
  ...(await original<object>()),
  publishEvent: vi.fn(async () => undefined),
}));

import db, { schema } from "../../apps/api/src/database";
import duplicateTask from "../../apps/api/src/task/controllers/duplicate-task";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
});

async function seed() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const [field] = await db
    .insert(schema.customFieldDefinitionTable)
    .values({
      projectId: project.id,
      name: "Points",
      type: "number",
      required: true,
      defaultValue: "7",
    })
    .returning();
  return { owner, project, field };
}

const valuesOf = async (taskId: string) =>
  (
    await db
      .select()
      .from(schema.customFieldValueTable)
      .where(eq(schema.customFieldValueTable.taskId, taskId))
  ).map((r) => r.value);

describe("duplicateTask: required custom fields the source task predates", () => {
  it("fills a missing value and a blank value with the field's current default", async () => {
    const { owner, project, field } = await seed();
    const [withoutValue, withBlank, withValue] = await db
      .insert(schema.taskTable)
      .values([
        {
          projectId: project.id,
          title: "No value",
          number: 1,
          status: "to-do",
        },
        { projectId: project.id, title: "Blank", number: 2, status: "to-do" },
        {
          projectId: project.id,
          title: "Has value",
          number: 3,
          status: "to-do",
        },
      ])
      .returning();
    await db
      .update(schema.projectTable)
      .set({ lastTaskNumber: 3 })
      .where(eq(schema.projectTable.id, project.id));
    await db.insert(schema.customFieldValueTable).values([
      { taskId: withBlank.id, fieldId: field.id, value: "  " },
      { taskId: withValue.id, fieldId: field.id, value: "3" },
    ]);

    const copyOfMissing = await duplicateTask({
      taskId: withoutValue.id,
      currentUserId: owner.user.id,
    });
    const copyOfBlank = await duplicateTask({
      taskId: withBlank.id,
      currentUserId: owner.user.id,
    });
    const copyOfValue = await duplicateTask({
      taskId: withValue.id,
      currentUserId: owner.user.id,
    });

    expect(await valuesOf(copyOfMissing.id)).toEqual(["7"]);
    expect(await valuesOf(copyOfBlank.id)).toEqual(["7"]);
    expect(await valuesOf(copyOfValue.id)).toEqual(["3"]);
    // The sources are untouched.
    expect(await valuesOf(withoutValue.id)).toEqual([]);
    expect(await valuesOf(withBlank.id)).toEqual(["  "]);
  });

  it("answers 404 for an unknown task and copies nothing", async () => {
    const { owner } = await seed();
    await expect(
      duplicateTask({ taskId: "missing", currentUserId: owner.user.id }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(schema.taskTable)).toHaveLength(0);
  });
});
