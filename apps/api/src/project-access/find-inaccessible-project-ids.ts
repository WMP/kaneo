import { resolveProjectAccessMap } from "../utils/project-access";

// Upstream signature; the decision is the fork's (see README.md). Unknown ids
// count as inaccessible.
export async function findInaccessibleProjectIds(
  userId: string,
  projectIds: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return [];
  const accesses = await resolveProjectAccessMap(userId, ids);
  return ids.filter((id) => !accesses.has(id));
}
