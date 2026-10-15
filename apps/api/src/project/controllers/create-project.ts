import db from "../../database";
import { isFullAccess } from "../../utils/project-access";
import { insertProject } from "./insert-project";

async function createProject(
  workspaceId: string,
  name: string,
  icon: string,
  slug: string,
  userId: string,
) {
  // Read before the transaction, on purpose (see `NewProject`).
  const creatorHasFullAccess = await isFullAccess(userId, workspaceId);
  return db.transaction((tx) =>
    insertProject(tx, {
      workspaceId,
      name,
      icon,
      slug,
      userId,
      creatorHasFullAccess,
    }),
  );
}

export default createProject;
