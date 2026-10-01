import { eq, max, sql } from "drizzle-orm";
import db from "../../database";
import {
  columnTable,
  projectMemberTable,
  projectTable,
} from "../../database/schema";
import { isFullAccess } from "../../utils/project-access";
import { readEnforcementShared } from "../../workspace-column/enforcement-lock";
import { loadWorkspaceColumns } from "../../workspace-column/sync";

export const DEFAULT_PROJECT_COLUMNS = [
  { name: "To Do", slug: "to-do", position: 0, isFinal: false },
  { name: "In Progress", slug: "in-progress", position: 1, isFinal: false },
  { name: "In Review", slug: "in-review", position: 2, isFinal: false },
  { name: "Done", slug: "done", position: 3, isFinal: true },
] as const;

async function createProject(
  workspaceId: string,
  name: string,
  icon: string,
  slug: string,
  creatorUserId: string,
) {
  // Read before the transaction, on purpose. If the creator's workspace role
  // changes between this check and the insert, the outcome is one of two safe
  // ones: a demoted creator gets no admin row (they must be added), or a
  // promoted one gets an inert row that a later demotion would revive. That
  // window is accepted rather than locking the membership for every create.
  const creatorHasFullAccess = await isFullAccess(creatorUserId, workspaceId);
  return db.transaction(async (tx) => {
    // Serialize ordering writes per workspace: without this, two concurrent
    // creates can read the same max(position) and land on the same slot, and a
    // create can interleave with a reorder's renumber. `reorderProjects` takes
    // the same lock with the same key.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(1524, hashtext(${workspaceId}))`,
    );

    // Shared lock on the workspace row, held until commit: a workspace that is
    // turning enforcement on (or editing its columns) finishes first, or waits
    // for this project. The columns are read after the lock.
    await readEnforcementShared(tx, workspaceId);
    const workspaceColumns = await loadWorkspaceColumns(tx, workspaceId);

    // New projects go to the bottom of the workspace's ordering.
    const [{ maxPosition } = { maxPosition: null }] = await tx
      .select({ maxPosition: max(projectTable.position) })
      .from(projectTable)
      .where(eq(projectTable.workspaceId, workspaceId));

    const [createdProject] = await tx
      .insert(projectTable)
      .values({
        workspaceId,
        name,
        icon,
        slug,
        position: maxPosition === null ? 0 : maxPosition + 1,
      })
      .returning();

    if (createdProject) {
      // A creator without full access becomes a project admin in the same
      // transaction, so they never lose sight of a project they just made (they
      // reach projects only through a membership). A full-access creator
      // already reaches every project, and a stored admin row would turn into a
      // stale admin right after a demotion.
      if (!creatorHasFullAccess) {
        await tx.insert(projectMemberTable).values({
          projectId: createdProject.id,
          userId: creatorUserId,
          role: "admin",
        });
      }

      // Workspace columns are copied, linked, whether or not they are
      // enforced; a workspace without any keeps the default columns.
      if (workspaceColumns.length > 0) {
        await tx.insert(columnTable).values(
          workspaceColumns.map((col) => ({
            projectId: createdProject.id,
            name: col.name,
            slug: col.slug,
            position: col.position,
            icon: col.icon,
            color: col.color,
            isFinal: col.isFinal,
            workspaceColumnId: col.id,
          })),
        );
      } else {
        for (const col of DEFAULT_PROJECT_COLUMNS) {
          await tx.insert(columnTable).values({
            projectId: createdProject.id,
            name: col.name,
            slug: col.slug,
            position: col.position,
            isFinal: col.isFinal,
          });
        }
      }
    }

    return createdProject;
  });
}

export default createProject;
