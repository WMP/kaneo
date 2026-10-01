import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable } from "../../database/schema";
import { VIRTUAL_STATUSES } from "../../task/validate-task-fields";
import { assertProjectColumnsEditable } from "../../workspace-column/enforcement-lock";
import { toSlug } from "../slug";

export { toSlug };

async function createColumn({
  projectId,
  name,
  icon,
  color,
  isFinal,
}: {
  projectId: string;
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
    throw new HTTPException(409, {
      message: `Column slug "${slug}" is reserved for virtual task statuses`,
    });
  }

  // One transaction: the enforcement flag is read under a shared lock together
  // with the write, so a workspace turning enforcement on cannot interleave.
  const created = await db.transaction(async (tx) => {
    await assertProjectColumnsEditable(tx, projectId);

    const existing = await tx
      .select({ id: columnTable.id })
      .from(columnTable)
      .where(
        sql`${columnTable.projectId} = ${projectId} AND ${columnTable.slug} = ${slug}`,
      );

    if (existing.length > 0) {
      throw new HTTPException(409, {
        message: `Column with slug "${slug}" already exists in this project`,
      });
    }

    const [maxPos] = await tx
      .select({
        maxPosition: sql<number>`COALESCE(MAX(${columnTable.position}), -1)`,
      })
      .from(columnTable)
      .where(eq(columnTable.projectId, projectId));

    const position = (maxPos?.maxPosition ?? -1) + 1;

    const [inserted] = await tx
      .insert(columnTable)
      .values({
        projectId,
        name,
        slug,
        position,
        icon: icon || null,
        color: color || null,
        isFinal: isFinal ?? false,
      })
      .returning();

    return inserted;
  });

  if (!created) {
    throw new HTTPException(500, { message: "Failed to create column" });
  }

  return created;
}

export default createColumn;
