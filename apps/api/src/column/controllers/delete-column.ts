import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable, taskTable } from "../../database/schema";
import { assertProjectColumnsEditable } from "../../workspace-column/enforcement-lock";

async function deleteColumn(id: string) {
  return db.transaction(async (tx) => {
    const existing = await tx.query.columnTable.findFirst({
      where: eq(columnTable.id, id),
    });

    if (!existing) {
      throw new HTTPException(404, { message: "Column not found" });
    }

    await assertProjectColumnsEditable(tx, existing.projectId);

    const [taskCount] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(taskTable)
      .where(eq(taskTable.columnId, id));

    if (taskCount && taskCount.count > 0) {
      throw new HTTPException(409, {
        message:
          "Cannot delete column that contains tasks. Move or delete tasks first.",
      });
    }

    await tx.delete(columnTable).where(eq(columnTable.id, id));

    return existing;
  });
}

export default deleteColumn;
