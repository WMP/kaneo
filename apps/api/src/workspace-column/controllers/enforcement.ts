import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workspaceTable } from "../../database/schema";
import { accessibleProjectIds } from "../../utils/project-access";
import { retryTransaction } from "../../utils/retry-transaction";
import { lockWorkspaceForWrite } from "../enforcement-lock";
import { WORKSPACE_COLUMN_ERROR_CODES, workspaceColumnError } from "../errors";
import { publishWorkspaceColumnChanges } from "../events";
import {
  applyWorkspaceColumnSync,
  ColumnSyncPlanError,
  loadWorkspaceColumns,
  previewWorkspaceColumnSync,
} from "../sync";

function emptyColumnsError() {
  return workspaceColumnError(
    400,
    WORKSPACE_COLUMN_ERROR_CODES.empty,
    "Define at least one workspace column before enforcing the columns.",
  );
}

function unknownFallbackError() {
  return new HTTPException(404, {
    message: "Fallback column not found in this workspace",
  });
}

export async function previewEnforcement({
  workspaceId,
  userId,
  fallbackColumnId,
}: {
  workspaceId: string;
  userId: string;
  fallbackColumnId?: string;
}) {
  const columns = await loadWorkspaceColumns(db, workspaceId);
  if (columns.length === 0) throw emptyColumnsError();
  if (fallbackColumnId && !columns.some((c) => c.id === fallbackColumnId)) {
    throw unknownFallbackError();
  }

  const visibleProjectIds = await accessibleProjectIds(userId, workspaceId);
  try {
    return await previewWorkspaceColumnSync(
      db,
      workspaceId,
      fallbackColumnId ?? null,
      visibleProjectIds,
    );
  } catch (error) {
    if (error instanceof ColumnSyncPlanError) throw emptyColumnsError();
    throw error;
  }
}

export async function setEnforcement({
  workspaceId,
  enforced,
  fallbackColumnId,
}: {
  workspaceId: string;
  enforced: boolean;
  fallbackColumnId?: string;
}) {
  const result = await retryTransaction(() =>
    db.transaction(async (tx) => {
      const workspace = await lockWorkspaceForWrite(tx, workspaceId);
      if (!workspace) {
        throw new HTTPException(404, { message: "Workspace not found" });
      }

      if (!enforced) {
        // Only the flag: the links stay, so turning it on again is exact.
        if (workspace.enforced) {
          await tx
            .update(workspaceTable)
            .set({ enforceColumns: false })
            .where(eq(workspaceTable.id, workspaceId));
        }
        return null;
      }

      const columns = await loadWorkspaceColumns(tx, workspaceId);
      if (columns.length === 0) throw emptyColumnsError();
      if (fallbackColumnId && !columns.some((c) => c.id === fallbackColumnId)) {
        throw unknownFallbackError();
      }

      const applied = await applyWorkspaceColumnSync(
        tx,
        workspaceId,
        fallbackColumnId ?? null,
      );

      if (!workspace.enforced) {
        await tx
          .update(workspaceTable)
          .set({ enforceColumns: true })
          .where(eq(workspaceTable.id, workspaceId));
      }
      return applied;
    }),
  );

  if (!result) {
    return {
      enforced: false,
      fallbackColumnId: null,
      projects: [],
      totals: {
        projects: 0,
        projectsChanged: 0,
        columnsCreated: 0,
        columnsRemoved: 0,
        columnsUpdated: 0,
        tasksMoved: 0,
        workflowRulesDeleted: 0,
      },
    };
  }

  await publishWorkspaceColumnChanges({
    projectIds: result.changedProjectIds,
    subtaskParentProjectIds: result.subtaskParentProjectIds,
  });

  return {
    enforced: true,
    fallbackColumnId: result.fallbackColumnId,
    projects: result.projects,
    totals: result.totals,
  };
}
