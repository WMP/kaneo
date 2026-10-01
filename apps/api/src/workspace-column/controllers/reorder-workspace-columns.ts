import { and, asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workspaceColumnTable } from "../../database/schema";
import { retryTransaction } from "../../utils/retry-transaction";
import { lockWorkspaceForWrite } from "../enforcement-lock";
import { publishWorkspaceColumnChanges } from "../events";
import { propagateReorder } from "../propagate";

async function reorderWorkspaceColumns(
  workspaceId: string,
  columns: Array<{ id: string; position: number }>,
) {
  if (new Set(columns.map((column) => column.id)).size !== columns.length) {
    throw new HTTPException(400, {
      message: "A column is listed more than once",
    });
  }

  const { ordered, projectIds } = await retryTransaction(() =>
    db.transaction(async (tx) => {
      const workspace = await lockWorkspaceForWrite(tx, workspaceId);
      if (!workspace) {
        throw new HTTPException(404, { message: "Workspace not found" });
      }

      for (const column of columns) {
        const [updated] = await tx
          .update(workspaceColumnTable)
          .set({ position: column.position })
          .where(
            and(
              eq(workspaceColumnTable.id, column.id),
              eq(workspaceColumnTable.workspaceId, workspaceId),
            ),
          )
          .returning({ id: workspaceColumnTable.id });

        // Nothing is persisted: the transaction rolls back with the error.
        if (!updated) {
          throw new HTTPException(404, {
            message: `Workspace column ${column.id} not found`,
          });
        }
      }

      const rows = await tx
        .select()
        .from(workspaceColumnTable)
        .where(eq(workspaceColumnTable.workspaceId, workspaceId))
        .orderBy(
          asc(workspaceColumnTable.position),
          asc(workspaceColumnTable.id),
        );

      const affected = workspace.enforced
        ? await propagateReorder(tx, workspaceId)
        : [];
      return { ordered: rows, projectIds: affected };
    }),
  );

  await publishWorkspaceColumnChanges({ projectIds });
  return ordered;
}

export default reorderWorkspaceColumns;
