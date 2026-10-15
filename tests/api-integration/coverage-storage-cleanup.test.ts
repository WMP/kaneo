import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeleteObjectCommand,
  S3Client,
} from "../../apps/api/node_modules/@aws-sdk/client-s3";
import db, { schema } from "../../apps/api/src/database";
import {
  contentReferencesAsset,
  deleteOrphanedAssets,
  deleteS3Keys,
  extractAssetIds,
  getTaskAssetKeys,
} from "../../apps/api/src/storage/cleanup-assets";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const img = (id: string) => `<img src="http://kaneo.test/api/asset/${id}">`;

async function seed() {
  const member = await createWorkspaceMember();
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  async function makeTask(number: number, description = "") {
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        userId: member.user.id,
        title: `Task ${number}`,
        description,
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number,
        position: number,
      })
      .returning();
    return task;
  }
  async function makeAsset(id: string, taskId: string | null) {
    await db.insert(schema.assetTable).values({
      id,
      workspaceId: member.workspace.id,
      projectId: project.id,
      taskId,
      objectKey: `key/${id}`,
      filename: `${id}.png`,
      mimeType: "image/png",
      size: 10,
    });
  }
  return { member, project, makeTask, makeAsset };
}

async function assetIds() {
  return (await db.select({ id: schema.assetTable.id }).from(schema.assetTable))
    .map((row) => row.id)
    .sort();
}

function deletedKeys() {
  return vi
    .mocked(S3Client.prototype.send)
    .mock.calls.map((call) => call[0])
    .filter((command) => command instanceof DeleteObjectCommand)
    .map((command) => (command as DeleteObjectCommand).input.Key)
    .sort();
}

beforeEach(async () => {
  await resetTestDatabase();
  process.env.S3_ENDPOINT = "https://storage.example.test";
  process.env.S3_BUCKET = "test-bucket";
  process.env.S3_ACCESS_KEY_ID = "test-access-key";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
  delete process.env.S3_KEY_PREFIX;
  // Never contact the placeholder host: every storage call is answered here.
  vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractAssetIds and contentReferencesAsset", () => {
  it("finds every distinct id, case-insensitively, across repeated calls", () => {
    const content = `${img("abc1")} ${img("abc1")} /API/ASSET/Def2 text`;
    expect(extractAssetIds(content)).toEqual(new Set(["abc1", "Def2"]));
    // The shared global pattern must not keep state between calls.
    expect(extractAssetIds(content)).toEqual(new Set(["abc1", "Def2"]));
    expect(contentReferencesAsset(content, "Def2")).toBe(true);
    expect(contentReferencesAsset(content, "abc")).toBe(false);
    expect(contentReferencesAsset(null, "abc1")).toBe(false);
  });
});

describe("deleteOrphanedAssets", () => {
  it("deletes the object and row of an asset that left the content and keeps the others", async () => {
    const { makeTask, makeAsset } = await seed();
    const task = await makeTask(1);
    await makeAsset("gone1", task.id);
    await makeAsset("kept1", task.id);

    await deleteOrphanedAssets(`${img("gone1")}${img("kept1")}`, img("kept1"), {
      taskId: task.id,
    });

    expect(deletedKeys()).toEqual(["key/gone1"]);
    expect(await assetIds()).toEqual(["kept1"]);
  });

  it("does nothing when no asset id was removed", async () => {
    const { makeTask, makeAsset } = await seed();
    const task = await makeTask(1);
    await makeAsset("a1", task.id);

    await deleteOrphanedAssets(img("a1"), `${img("a1")}${img("b2")}`, {
      taskId: task.id,
    });
    await deleteOrphanedAssets(null, "text", { taskId: task.id });

    expect(deletedKeys()).toEqual([]);
    expect(await assetIds()).toEqual(["a1"]);
  });

  it("keeps an asset that another asset of a different task or an unknown id would suggest deleting", async () => {
    const { makeTask, makeAsset } = await seed();
    const mine = await makeTask(1);
    const other = await makeTask(2);
    await makeAsset("foreign1", other.id);
    await makeAsset("unowned1", null);

    await deleteOrphanedAssets(
      `${img("foreign1")}${img("unowned1")}${img("missing1")}`,
      "",
      { taskId: mine.id },
    );

    expect(deletedKeys()).toEqual([]);
    expect(await assetIds()).toEqual(["foreign1", "unowned1"]);
  });

  it.each([
    ["the task description", "description"],
    ["a comment of the task", "comment"],
    ["an activity comment of the task", "activity"],
  ])("keeps an asset that %s still references", async (_label, place) => {
    const { member, makeTask, makeAsset } = await seed();
    const task = await makeTask(
      1,
      place === "description" ? `<p>${img("shared1")}</p>` : "",
    );
    await makeAsset("shared1", task.id);
    if (place === "comment") {
      await db.insert(schema.commentTable).values({
        taskId: task.id,
        userId: member.user.id,
        content: img("shared1"),
      });
    }
    if (place === "activity") {
      await db.insert(schema.activityTable).values({
        taskId: task.id,
        userId: member.user.id,
        type: "comment",
        content: img("shared1"),
      });
    }

    await deleteOrphanedAssets(img("shared1"), "", { taskId: task.id });

    expect(deletedKeys()).toEqual([]);
    expect(await assetIds()).toEqual(["shared1"]);
  });

  it("is not fooled by a longer id that merely starts with the removed id", async () => {
    const { member, makeTask, makeAsset } = await seed();
    const task = await makeTask(1, img("abc1xyz"));
    await makeAsset("abc1", task.id);
    await db.insert(schema.commentTable).values({
      taskId: task.id,
      userId: member.user.id,
      content: img("abc1xyz"),
    });

    await deleteOrphanedAssets(img("abc1"), "", { taskId: task.id });

    expect(deletedKeys()).toEqual(["key/abc1"]);
    expect(await assetIds()).toEqual([]);
  });

  it("keeps the row of an asset whose object could not be deleted and removes the others", async () => {
    const { makeTask, makeAsset } = await seed();
    const task = await makeTask(1);
    await makeAsset("ok1", task.id);
    await makeAsset("fail1", task.id);
    vi.mocked(S3Client.prototype.send).mockImplementation(((
      command: unknown,
    ) =>
      (command as DeleteObjectCommand).input.Key === "key/fail1"
        ? Promise.reject(new Error("storage unavailable"))
        : Promise.resolve({})) as never);

    await deleteOrphanedAssets(`${img("ok1")}${img("fail1")}`, "", {
      taskId: task.id,
    });

    expect(await assetIds()).toEqual(["fail1"]);
    expect(console.error).toHaveBeenCalledWith("Failed to delete S3 objects", [
      expect.objectContaining({ key: "key/fail1" }),
    ]);
  });

  it("keeps every row when every object deletion fails", async () => {
    const { makeTask, makeAsset } = await seed();
    const task = await makeTask(1);
    await makeAsset("f1", task.id);
    vi.mocked(S3Client.prototype.send).mockRejectedValue(new Error("down"));

    await deleteOrphanedAssets(img("f1"), "", { taskId: task.id });

    expect(await assetIds()).toEqual(["f1"]);
  });
});

describe("getTaskAssetKeys and deleteS3Keys", () => {
  it("lists only the keys of the given task", async () => {
    const { makeTask, makeAsset } = await seed();
    const first = await makeTask(1);
    const second = await makeTask(2);
    await makeAsset("a1", first.id);
    await makeAsset("a2", first.id);
    await makeAsset("b1", second.id);

    expect((await getTaskAssetKeys(first.id)).sort()).toEqual([
      "key/a1",
      "key/a2",
    ]);
    expect(await getTaskAssetKeys(randomUUID())).toEqual([]);
  });

  it("reports each outcome in order and logs only the failures", async () => {
    vi.mocked(S3Client.prototype.send).mockImplementation(((
      command: unknown,
    ) =>
      (command as DeleteObjectCommand).input.Key === "bad"
        ? Promise.reject(new Error("nope"))
        : Promise.resolve({})) as never);

    const results = await deleteS3Keys(["good", "bad"]);

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(deletedKeys()).toEqual(["bad", "good"]);
    expect(await deleteS3Keys([])).toEqual([]);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
