import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import createWorkspaceColumn from "../../apps/api/src/workspace-column/controllers/create-workspace-column";
import deleteWorkspaceColumn from "../../apps/api/src/workspace-column/controllers/delete-workspace-column";
import { previewEnforcement } from "../../apps/api/src/workspace-column/controllers/enforcement";
import getWorkspaceColumns from "../../apps/api/src/workspace-column/controllers/get-workspace-columns";
import reorderWorkspaceColumns from "../../apps/api/src/workspace-column/controllers/reorder-workspace-columns";
import updateWorkspaceColumn from "../../apps/api/src/workspace-column/controllers/update-workspace-column";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(resetTestDatabase);

// A coded error carries its machine-readable code in the JSON body of `res`.
async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const { res, status } = error as { res?: Response; status?: number };
    return { status, code: ((await res?.json()) as { code?: string })?.code };
  }
  throw new Error("expected a rejection");
}

describe("workspace column controllers on a missing workspace", () => {
  it("answer 404 and create nothing", async () => {
    await expect(getWorkspaceColumns("missing")).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      createWorkspaceColumn({ workspaceId: "missing", name: "X" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(deleteWorkspaceColumn("missing", "c")).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      reorderWorkspaceColumns("missing", [{ id: "c", position: 1 }]),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateWorkspaceColumn("missing", "c", { name: "n" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(schema.workspaceColumnTable)).toHaveLength(0);
  });

  it("reorder refuses a column listed twice before touching anything", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const [col] = await db
      .insert(schema.workspaceColumnTable)
      .values({
        workspaceId: owner.workspace.id,
        name: "A",
        slug: "a",
        position: 4,
      })
      .returning();
    await expect(
      reorderWorkspaceColumns(owner.workspace.id, [
        { id: col.id, position: 1 },
        { id: col.id, position: 2 },
      ]),
    ).rejects.toMatchObject({
      status: 400,
      message: "A column is listed more than once",
    });
    expect(
      (
        await db.query.workspaceColumnTable.findFirst({
          where: eq(schema.workspaceColumnTable.id, col.id),
        })
      )?.position,
    ).toBe(4);
  });

  it("enforcement preview refuses a workspace without columns", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    expect(
      await codeOf(
        previewEnforcement({
          workspaceId: owner.workspace.id,
          userId: owner.user.id,
        }),
      ),
    ).toEqual({ status: 400, code: "WORKSPACE_COLUMNS_EMPTY" });
  });
});

describe("deleting a workspace column with a project that has no target column", () => {
  it("refuses with 409 NOT_EMPTY, keeping tasks, columns and the workspace column", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const workspaceId = owner.workspace.id;
    await db
      .update(schema.workspaceTable)
      .set({ enforceColumns: true })
      .where(eq(schema.workspaceTable.id, workspaceId));
    const [source, target] = await db
      .insert(schema.workspaceColumnTable)
      .values([
        { workspaceId, name: "Source", slug: "source", position: 0 },
        { workspaceId, name: "Target", slug: "target", position: 1 },
      ])
      .returning();
    const { project: linkedBoth } = await createProjectFixture({ workspaceId });
    const { project: linkedSourceOnly } = await createProjectFixture({
      workspaceId,
    });
    await db
      .delete(schema.columnTable)
      .where(eq(schema.columnTable.projectId, linkedBoth.id));
    await db
      .delete(schema.columnTable)
      .where(eq(schema.columnTable.projectId, linkedSourceOnly.id));
    const columns = await db
      .insert(schema.columnTable)
      .values([
        {
          projectId: linkedBoth.id,
          name: "Source",
          slug: "source",
          position: 0,
          workspaceColumnId: source.id,
        },
        {
          projectId: linkedBoth.id,
          name: "Target",
          slug: "target",
          position: 1,
          workspaceColumnId: target.id,
        },
        {
          projectId: linkedSourceOnly.id,
          name: "Source",
          slug: "source",
          position: 0,
          workspaceColumnId: source.id,
        },
      ])
      .returning();
    const strandedColumn = columns[2];
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: linkedSourceOnly.id,
        title: "Stranded",
        number: 1,
        status: "source",
        columnId: strandedColumn?.id,
      })
      .returning();

    expect(
      await codeOf(deleteWorkspaceColumn(workspaceId, source.id, target.id)),
    ).toEqual({ status: 409, code: "WORKSPACE_COLUMN_NOT_EMPTY" });

    expect(await db.select().from(schema.workspaceColumnTable)).toHaveLength(2);
    expect(await db.select().from(schema.columnTable)).toHaveLength(3);
    expect(
      (
        await db.query.taskTable.findFirst({
          where: eq(schema.taskTable.id, task.id),
        })
      )?.columnId,
    ).toBe(strandedColumn?.id);

    // Once that project's column holds no tasks, the same delete succeeds and moves nothing.
    await db.delete(schema.taskTable).where(eq(schema.taskTable.id, task.id));
    await deleteWorkspaceColumn(workspaceId, source.id, target.id);
    expect(await db.select().from(schema.workspaceColumnTable)).toHaveLength(1);
    expect(
      (await db.select().from(schema.columnTable)).map((c) => c.slug),
    ).toEqual(["target"]);
  });
});
