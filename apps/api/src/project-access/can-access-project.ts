import { resolveProjectAccess } from "../utils/project-access";

// Upstream signature; the decision is the fork's (see README.md).
export async function canAccessProject(userId: string, projectId: string) {
  return (await resolveProjectAccess(userId, projectId)) !== null;
}
