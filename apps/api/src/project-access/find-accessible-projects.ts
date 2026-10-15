import { resolveProjectAccessMap } from "../utils/project-access";

// Upstream signature: project id -> workspace id of the projects the viewer
// can open. The decision is the fork's (see README.md).
export async function findAccessibleProjects(
  viewerId: string,
  projectIds: readonly string[],
): Promise<Map<string, string>> {
  const accesses = await resolveProjectAccessMap(viewerId, [
    ...new Set(projectIds),
  ]);
  return new Map(
    [...accesses].map(([projectId, access]) => [projectId, access.workspaceId]),
  );
}
