import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workspaceColumnTable } from "../../database/schema";
import { retryTransaction } from "../../utils/retry-transaction";
import { lockWorkspaceForWrite } from "../enforcement-lock";
import { publishWorkspaceColumnChanges } from "../events";
import { propagateUpdate } from "../propagate";

async function updateWorkspaceColumn(
  workspaceId: string,
  columnId: string,
  data: {
    name?: string;
    icon?: string | null;
    color?: string | null;
    isFinal?: boolean;
  },
) {
  const patch = {
    ...(data.name !== undefined && { name: data.name }),
    ...(data.icon !== undefined && { icon: data.icon }),
    ...(data.color !== undefined && { color: data.color }),
    ...(data.isFinal !== undefined && { isFinal: data.isFinal }),
  };

  const { updated, finalChanged, projectIds } = await retryTransaction(() =>
    db.transaction(async (tx) => {
      const workspace = await lockWorkspaceForWrite(tx, workspaceId);
      if (!workspace) {
        throw new HTTPException(404, { message: "Workspace not found" });
      }

      const [existing] = await tx
        .select()
        .from(workspaceColumnTable)
        .where(
          and(
            eq(workspaceColumnTable.id, columnId),
            eq(workspaceColumnTable.workspaceId, workspaceId),
          ),
        );

      if (!existing) {
        throw new HTTPException(404, { message: "Workspace column not found" });
      }

      const [row] =
        Object.keys(patch).length > 0
          ? await tx
              .update(workspaceColumnTable)
              .set(patch)
              .where(eq(workspaceColumnTable.id, columnId))
              .returning()
          : [existing];

      if (!row) {
        throw new HTTPException(500, {
          message: "Failed to update workspace column",
        });
      }

      const affected = workspace.enforced
        ? await propagateUpdate(tx, columnId, patch)
        : [];

      return {
        updated: row,
        finalChanged: existing.isFinal !== row.isFinal,
        projectIds: affected,
      };
    }),
  );

  await publishWorkspaceColumnChanges({
    projectIds,
    subtaskParentProjectIds: finalChanged ? projectIds : [],
  });
  return updated;
}

export default updateWorkspaceColumn;
