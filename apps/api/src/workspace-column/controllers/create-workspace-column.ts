import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { toSlug } from "../../column/slug";
import db from "../../database";
import { workspaceColumnTable } from "../../database/schema";
import { VIRTUAL_STATUSES } from "../../task/validate-task-fields";
import { retryTransaction } from "../../utils/retry-transaction";
import { lockWorkspaceForWrite } from "../enforcement-lock";
import { WORKSPACE_COLUMN_ERROR_CODES, workspaceColumnError } from "../errors";
import { publishWorkspaceColumnChanges } from "../events";
import { propagateCreate } from "../propagate";

async function createWorkspaceColumn({
  workspaceId,
  name,
  icon,
  color,
  isFinal,
}: {
  workspaceId: string;
  name: string;
  icon?: string;
  color?: string;
  isFinal?: boolean;
}) {
  const slug = toSlug(name);

  if (!slug) {
    throw new HTTPException(400, {
      message: "Column name must contain at least one alphanumeric character",
    });
  }

  if ((VIRTUAL_STATUSES as readonly string[]).includes(slug)) {
    throw workspaceColumnError(
      409,
      WORKSPACE_COLUMN_ERROR_CODES.reservedSlug,
      `Column slug "${slug}" is reserved for virtual task statuses`,
    );
  }

  const { created, projectIds } = await retryTransaction(() =>
    db.transaction(async (tx) => {
      const workspace = await lockWorkspaceForWrite(tx, workspaceId);
      if (!workspace) {
        throw new HTTPException(404, { message: "Workspace not found" });
      }

      const [existing] = await tx
        .select({ id: workspaceColumnTable.id })
        .from(workspaceColumnTable)
        .where(
          sql`${workspaceColumnTable.workspaceId} = ${workspaceId} AND ${workspaceColumnTable.slug} = ${slug}`,
        )
        .limit(1);

      if (existing) {
        throw workspaceColumnError(
          409,
          WORKSPACE_COLUMN_ERROR_CODES.slugConflict,
          `Column with slug "${slug}" already exists in this workspace`,
        );
      }

      const [maxPos] = await tx
        .select({
          maxPosition: sql<number>`COALESCE(MAX(${workspaceColumnTable.position}), -1)`,
        })
        .from(workspaceColumnTable)
        .where(eq(workspaceColumnTable.workspaceId, workspaceId));

      const [inserted] = await tx
        .insert(workspaceColumnTable)
        .values({
          workspaceId,
          name,
          slug,
          position: (maxPos?.maxPosition ?? -1) + 1,
          icon: icon || null,
          color: color || null,
          isFinal: isFinal ?? false,
        })
        .returning();

      if (!inserted) {
        throw new HTTPException(500, {
          message: "Failed to create workspace column",
        });
      }

      const affected = workspace.enforced
        ? await propagateCreate(tx, workspaceId, inserted)
        : [];
      return { created: inserted, projectIds: affected };
    }),
  );

  await publishWorkspaceColumnChanges({ projectIds });
  return created;
}

export default createWorkspaceColumn;
