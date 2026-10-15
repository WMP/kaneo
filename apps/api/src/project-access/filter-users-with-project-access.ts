import { filterUsersWithProjectAccess as filterUsers } from "../utils/project-scope-filters";

// Upstream signature (any iterable of ids); the decision is the fork's (see
// README.md).
export async function filterUsersWithProjectAccess(
  userIds: Iterable<string>,
  projectId: string,
): Promise<Set<string>> {
  return filterUsers([...new Set(userIds)], projectId);
}
