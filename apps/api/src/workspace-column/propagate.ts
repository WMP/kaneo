import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { columnTable, projectTable, taskTable } from "../database/schema";
import type { Transaction } from "./enforcement-lock";
import { WORKSPACE_COLUMN_ERROR_CODES, workspaceColumnError } from "./errors";
import { appendTasksToColumn, type WorkspaceColumnData } from "./sync";

// Propagation of a workspace column mutation to the projects of an enforcing
// workspace. The caller holds the workspace row lock and runs in a transaction.

const INSERT_CHUNK = 500;

function projectsOf(tx: Transaction, workspaceId: string) {
  return tx
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(eq(projectTable.workspaceId, workspaceId));
}

/** Creates the column in every project; returns every project id of the workspace. */
export async function propagateCreate(
  tx: Transaction,
  workspaceId: string,
  column: WorkspaceColumnData,
): Promise<string[]> {
  const projectIds = (await projectsOf(tx, workspaceId)).map((row) => row.id);

  // A project column that already has the slug is taken over instead of
  // duplicated (a project with columns written around the API).
  await tx
    .update(columnTable)
    .set({
      name: column.name,
      position: column.position,
      icon: column.icon,
      color: column.color,
      isFinal: column.isFinal,
      workspaceColumnId: column.id,
    })
    .where(
      and(
        inArray(columnTable.projectId, projectsOf(tx, workspaceId)),
        eq(columnTable.slug, column.slug),
        isNull(columnTable.workspaceColumnId),
      ),
    );

  const missing = await tx
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        sql`NOT EXISTS (
          SELECT 1 FROM ${columnTable}
          WHERE ${columnTable.projectId} = ${projectTable.id}
            AND ${columnTable.slug} = ${column.slug}
        )`,
      ),
    );

  for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
    await tx.insert(columnTable).values(
      missing.slice(i, i + INSERT_CHUNK).map((project) => ({
        projectId: project.id,
        name: column.name,
        slug: column.slug,
        position: column.position,
        icon: column.icon,
        color: column.color,
        isFinal: column.isFinal,
        workspaceColumnId: column.id,
      })),
    );
  }

  return projectIds;
}

/** Copies the new values to every linked project column; returns the project ids. */
export async function propagateUpdate(
  tx: Transaction,
  workspaceColumnId: string,
  patch: {
    name?: string;
    icon?: string | null;
    color?: string | null;
    isFinal?: boolean;
  },
): Promise<string[]> {
  if (Object.keys(patch).length === 0) return [];
  const rows = await tx
    .update(columnTable)
    .set(patch)
    .where(eq(columnTable.workspaceColumnId, workspaceColumnId))
    .returning({ projectId: columnTable.projectId });
  return rows.map((row) => row.projectId);
}

/** Gives every linked project column the position of its workspace column. */
export async function propagateReorder(
  tx: Transaction,
  workspaceId: string,
): Promise<string[]> {
  const result = await tx.execute<{ project_id: string }>(sql`
    UPDATE ${columnTable}
    SET position = w.position, updated_at = now()
    FROM ganttpro_workspace_column w
    WHERE ${columnTable.workspaceColumnId} = w.id
      AND w.workspace_id = ${workspaceId}
      AND ${columnTable.position} <> w.position
    RETURNING ${columnTable.projectId} AS project_id
  `);
  return [...new Set(result.rows.map((row) => row.project_id))];
}

// Tasks that belong to a linked project column: those pointing at it, and
// legacy tasks without a column whose status is its slug.
function linkedTasksSql(workspaceColumnId: string) {
  return sql`
    FROM ${taskTable}
    JOIN ${columnTable}
      ON ${columnTable.workspaceColumnId} = ${workspaceColumnId}
     AND ${columnTable.projectId} = ${taskTable.projectId}
     AND (${taskTable.columnId} = ${columnTable.id}
          OR (${taskTable.columnId} IS NULL AND ${taskTable.status} = ${columnTable.slug}))
  `;
}

export async function countLinkedTasks(
  tx: Transaction,
  workspaceColumnId: string,
): Promise<number> {
  const result = await tx.execute<{ total: number }>(
    sql`SELECT count(*)::int AS total ${linkedTasksSql(workspaceColumnId)}`,
  );
  return result.rows[0]?.total ?? 0;
}

/**
 * Deletes the linked project columns of a workspace column. Tasks move to the
 * project column linked to `moveTasksTo` (appended); without it the caller has
 * already refused a column that holds tasks. Workflow rules on the deleted
 * columns go with them (foreign key cascade). Returns the affected projects.
 */
export async function propagateDelete(
  tx: Transaction,
  workspaceColumnId: string,
  moveTasksTo: string | null,
): Promise<{
  projectIds: string[];
  tasksMoved: number;
  finalRemoved: boolean;
}> {
  const linked = await tx
    .select({
      id: columnTable.id,
      projectId: columnTable.projectId,
      slug: columnTable.slug,
      isFinal: columnTable.isFinal,
    })
    .from(columnTable)
    .where(eq(columnTable.workspaceColumnId, workspaceColumnId));

  let tasksMoved = 0;

  if (moveTasksTo) {
    const targets = await tx
      .select({
        id: columnTable.id,
        projectId: columnTable.projectId,
        slug: columnTable.slug,
      })
      .from(columnTable)
      .where(eq(columnTable.workspaceColumnId, moveTasksTo));
    const targetByProject = new Map(
      targets.map((target) => [target.projectId, target]),
    );

    for (const column of linked) {
      const target = targetByProject.get(column.projectId);
      if (!target) {
        // Only acceptable when there is nothing to move.
        const [{ total } = { total: 0 }] = (
          await tx.execute<{ total: number }>(sql`
            SELECT count(*)::int AS total FROM ${taskTable}
            WHERE ${taskTable.projectId} = ${column.projectId}
              AND (${taskTable.columnId} = ${column.id}
                OR (${taskTable.columnId} IS NULL AND ${taskTable.status} = ${column.slug}))
          `)
        ).rows;
        if (total > 0) {
          throw workspaceColumnError(
            409,
            WORKSPACE_COLUMN_ERROR_CODES.notEmpty,
            "A project has tasks in this column but no column to move them to.",
          );
        }
        continue;
      }
      tasksMoved += await appendTasksToColumn(tx, {
        projectId: column.projectId,
        where: sql`${taskTable.columnId} = ${column.id} OR (${taskTable.columnId} IS NULL AND ${taskTable.status} = ${column.slug})`,
        target,
      });
    }
  }

  if (linked.length > 0) {
    await tx
      .delete(columnTable)
      .where(eq(columnTable.workspaceColumnId, workspaceColumnId));
  }

  return {
    projectIds: [...new Set(linked.map((column) => column.projectId))],
    tasksMoved,
    finalRemoved: linked.some((column) => column.isFinal),
  };
}
