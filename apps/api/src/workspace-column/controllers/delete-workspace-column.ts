import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workspaceColumnTable } from "../../database/schema";
import { retryTransaction } from "../../utils/retry-transaction";
import { lockWorkspaceForWrite } from "../enforcement-lock";
import { WORKSPACE_COLUMN_ERROR_CODES, workspaceColumnError } from "../errors";
import { publishWorkspaceColumnChanges } from "../events";
import { countLinkedTasks, propagateDelete } from "../propagate";

async function deleteWorkspaceColumn(
  workspaceId: string,
  columnId: string,
  moveTasksTo?: string,
) {
  const { existing, projectIds, subtaskRefresh } = await retryTransaction(() =>
    db.transaction(async (tx) => {
      const workspace = await lockWorkspaceForWrite(tx, workspaceId);
      if (!workspace) {
        throw new HTTPException(404, { message: "Workspace not found" });
      }

      const [column] = await tx
        .select()
        .from(workspaceColumnTable)
        .where(
          and(
            eq(workspaceColumnTable.id, columnId),
            eq(workspaceColumnTable.workspaceId, workspaceId),
          ),
        );

      if (!column) {
        throw new HTTPException(404, { message: "Workspace column not found" });
      }

      if (moveTasksTo !== undefined) {
        if (moveTasksTo === columnId) {
          throw new HTTPException(400, {
            message: "Tasks cannot be moved to the column being deleted",
          });
        }
        const [target] = await tx
          .select({ id: workspaceColumnTable.id })
          .from(workspaceColumnTable)
          .where(
            and(
              eq(workspaceColumnTable.id, moveTasksTo),
              eq(workspaceColumnTable.workspaceId, workspaceId),
            ),
          );
        if (!target) {
          throw new HTTPException(404, {
            message: "Workspace column to move the tasks to was not found",
          });
        }
      }

      let affected: string[] = [];
      let refresh = false;

      if (workspace.enforced) {
        const [{ total } = { total: 0 }] = (
          await tx.execute<{ total: number }>(
            sql`SELECT count(*)::int AS total FROM ganttpro_workspace_column WHERE workspace_id = ${workspaceId}`,
          )
        ).rows;
        if (total <= 1) {
          throw workspaceColumnError(
            409,
            WORKSPACE_COLUMN_ERROR_CODES.last,
            "The last workspace column cannot be deleted while the workspace enforces its columns.",
          );
        }

        if (!moveTasksTo && (await countLinkedTasks(tx, columnId)) > 0) {
          throw workspaceColumnError(
            409,
            WORKSPACE_COLUMN_ERROR_CODES.notEmpty,
            "Tasks exist in this column. Choose a column to move them to.",
          );
        }

        const result = await propagateDelete(tx, columnId, moveTasksTo ?? null);
        affected = result.projectIds;
        refresh = result.tasksMoved > 0 || result.finalRemoved;
      }

      await tx
        .delete(workspaceColumnTable)
        .where(eq(workspaceColumnTable.id, columnId));

      return {
        existing: column,
        projectIds: affected,
        subtaskRefresh: refresh,
      };
    }),
  );

  await publishWorkspaceColumnChanges({
    projectIds,
    subtaskParentProjectIds: subtaskRefresh ? projectIds : [],
  });
  return existing;
}

export default deleteWorkspaceColumn;
