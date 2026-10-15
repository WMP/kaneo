import { isFullAccess } from "../utils/project-access";

// Upstream signature: true when the member reaches only some projects. In the
// fork that is every member without full access (see README.md).
export async function isProjectAccessRestricted(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  return !(await isFullAccess(userId, workspaceId));
}
