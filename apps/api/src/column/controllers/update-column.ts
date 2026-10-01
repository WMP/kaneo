import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { getProjectSubtaskParentProjects } from "../../task/get-subtask-parent-projects";
import { assertProjectColumnsEditable } from "../../workspace-column/enforcement-lock";

async function updateColumn(
  id: string,
  data: {
    name?: string;
    icon?: string | null;
    color?: string | null;
    isFinal?: boolean;
  },
) {
  const { existing, updated } = await db.transaction(async (tx) => {
    const current = await tx.query.columnTable.findFirst({
      where: eq(columnTable.id, id),
    });

    if (!current) {
      throw new HTTPException(404, { message: "Column not found" });
    }

    await assertProjectColumnsEditable(tx, current.projectId);

    const [row] = await tx
      .update(columnTable)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.icon !== undefined && { icon: data.icon }),
        ...(data.color !== undefined && { color: data.color }),
        ...(data.isFinal !== undefined && { isFinal: data.isFinal }),
      })
      .where(eq(columnTable.id, id))
      .returning();

    if (!row) {
      throw new HTTPException(500, { message: "Failed to update column" });
    }

    return { existing: current, updated: row };
  });

  if (existing.isFinal !== updated.isFinal) {
    const parents = await getProjectSubtaskParentProjects(
      updated.projectId,
      updated.slug,
    );
    await publishEvent("subtask-parents.refresh", {
      projects: [
        { projectId: updated.projectId },
        ...parents.filter((p) => p.projectId !== updated.projectId),
      ],
    });
  }

  return updated;
}

export default updateColumn;
