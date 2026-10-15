import { eq } from "drizzle-orm";
import type db from "../../database";
import {
  columnTable,
  projectMemberTable,
  projectTable,
} from "../../database/schema";
import { readEnforcementShared } from "../../workspace-column/enforcement-lock";
import { loadWorkspaceColumns } from "../../workspace-column/sync";
import {
  assertProjectKeyAvailable,
  lockProjectOrdering,
  nextProjectPosition,
} from "./project-placement";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type NewProject = {
  workspaceId: string;
  name: string;
  icon: string;
  slug: string;
  // The creator, who becomes a project admin unless they already reach every
  // project. Read by the caller BEFORE its transaction, on purpose: if the
  // creator's workspace role changes between that check and the insert, the
  // outcome is one of two safe ones: a demoted creator gets no admin row (they
  // must be added), or a promoted one gets an inert row that a later demotion
  // would revive. That window is accepted rather than locking the membership
  // for every create.
  userId: string;
  creatorHasFullAccess: boolean;
};

export type ProjectPlacement = {
  workspaceId: string;
  projectId: string;
  slug: string;
};

export const DEFAULT_PROJECT_COLUMNS = [
  { name: "To Do", slug: "to-do", position: 0, isFinal: false },
  { name: "In Progress", slug: "in-progress", position: 1, isFinal: false },
  { name: "In Review", slug: "in-review", position: 2, isFinal: false },
  { name: "Done", slug: "done", position: 3, isFinal: true },
] as const;

async function seedDefaultColumns(tx: Transaction, projectId: string) {
  for (const col of DEFAULT_PROJECT_COLUMNS) {
    await tx.insert(columnTable).values({
      projectId,
      name: col.name,
      slug: col.slug,
      position: col.position,
      isFinal: col.isFinal,
    });
  }
}

async function seedWorkspaceColumns(
  tx: Transaction,
  projectId: string,
  workspaceColumns: Awaited<ReturnType<typeof loadWorkspaceColumns>>,
) {
  await tx.insert(columnTable).values(
    workspaceColumns.map((col) => ({
      projectId,
      name: col.name,
      slug: col.slug,
      position: col.position,
      icon: col.icon,
      color: col.color,
      isFinal: col.isFinal,
      workspaceColumnId: col.id,
    })),
  );
}

// A creator without full access becomes a project admin in the same
// transaction, so they never lose sight of a project they just made (they reach
// projects only through a membership). A full-access creator already reaches
// every project, and a stored admin row would turn into a stale admin right
// after a demotion.
async function grantCreatorMembership(
  tx: Transaction,
  {
    projectId,
    userId,
    creatorHasFullAccess,
  }: { projectId: string; userId: string; creatorHasFullAccess: boolean },
) {
  if (creatorHasFullAccess) return;
  await tx.insert(projectMemberTable).values({
    projectId,
    userId,
    role: "admin",
  });
}

export async function insertProject(
  tx: Transaction,
  { workspaceId, name, icon, slug, userId, creatorHasFullAccess }: NewProject,
) {
  // Serialize ordering writes per workspace: without this, two concurrent
  // creates can read the same max(position) and land on the same slot, and a
  // create can interleave with a reorder's renumber. `reorderProjects` takes
  // the same lock with the same key.
  await lockProjectOrdering(tx, workspaceId);
  await assertProjectKeyAvailable(tx, workspaceId, slug);

  // Shared lock on the workspace row, held until commit: a workspace that is
  // turning enforcement on (or editing its columns) finishes first, or waits
  // for this project. The columns are read after the lock.
  await readEnforcementShared(tx, workspaceId);
  const workspaceColumns = await loadWorkspaceColumns(tx, workspaceId);

  // New projects go to the bottom of the workspace's ordering.
  const position = await nextProjectPosition(tx, workspaceId);

  const [createdProject] = await tx
    .insert(projectTable)
    .values({ workspaceId, name, icon, slug, position })
    .returning();

  if (createdProject) {
    await grantCreatorMembership(tx, {
      projectId: createdProject.id,
      userId,
      creatorHasFullAccess,
    });

    // Workspace columns are copied, linked, whether or not they are enforced;
    // a workspace without any keeps the default columns.
    if (workspaceColumns.length > 0) {
      await seedWorkspaceColumns(tx, createdProject.id, workspaceColumns);
    } else {
      await seedDefaultColumns(tx, createdProject.id);
    }
  }

  return createdProject;
}

// For importers: the project is placed at the bottom of the ordering only
// after its content was written (`placeProject`).
export async function insertUnplacedProject(
  tx: Transaction,
  { workspaceId, name, icon, slug, userId, creatorHasFullAccess }: NewProject,
) {
  const [createdProject] = await tx
    .insert(projectTable)
    .values({ workspaceId, name, icon, slug, position: 0 })
    .returning();

  if (createdProject) {
    await seedDefaultColumns(tx, createdProject.id);
    await grantCreatorMembership(tx, {
      projectId: createdProject.id,
      userId,
      creatorHasFullAccess,
    });
  }

  return createdProject;
}

export async function placeProject(
  tx: Transaction,
  { workspaceId, projectId, slug }: ProjectPlacement,
) {
  await lockProjectOrdering(tx, workspaceId);
  await assertProjectKeyAvailable(tx, workspaceId, slug, projectId);
  const position = await nextProjectPosition(tx, workspaceId, projectId);

  await tx
    .update(projectTable)
    .set({ position })
    .where(eq(projectTable.id, projectId));
}
