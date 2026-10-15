import { eq } from "drizzle-orm";
import db from "../../database";
import { projectTable } from "../../database/schema";
import {
  insertUnplacedProject,
  placeProject,
} from "../../project/controllers/insert-project";
import { isFullAccess } from "../../utils/project-access";
import { createWithUniqueKey } from "./create-with-unique-key";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type CreatedProject = NonNullable<
  Awaited<ReturnType<typeof insertUnplacedProject>>
>;

export type ImportProjectInput = {
  workspaceId: string;
  name: string;
  userId: string;
  preferredKey?: string;
};

export async function createImportProject<T>(
  { workspaceId, name, userId, preferredKey }: ImportProjectInput,
  fill: (tx: Transaction, project: CreatedProject) => Promise<T>,
): Promise<T> {
  // The importing user gets access the way a project creator does: a project
  // admin membership unless their role already reaches every project. Read
  // before the transactions, like `createProject` does.
  const creatorHasFullAccess = await isFullAccess(userId, workspaceId);
  const existing = await db
    .select({ slug: projectTable.slug })
    .from(projectTable)
    .where(eq(projectTable.workspaceId, workspaceId));

  return createWithUniqueKey(
    name,
    existing.map((row) => row.slug),
    (slug) =>
      db.transaction(async (tx) => {
        const project = await insertUnplacedProject(tx, {
          workspaceId,
          name,
          icon: "Layout",
          slug,
          userId,
          creatorHasFullAccess,
        });
        if (!project) throw new Error("Failed to create the imported project");
        const result = await fill(tx, project);
        await placeProject(tx, { workspaceId, projectId: project.id, slug });
        return result;
      }),
    { preferredKey },
  );
}
