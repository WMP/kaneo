import { publishEvent } from "../events";
import { getProjectSubtaskParentProjects } from "../task/get-subtask-parent-projects";

/**
 * Tells the open boards that their columns changed (`project.updated`, which
 * the web client answers by reloading the columns) and, when final flags or the
 * column of tasks changed, refreshes the subtask counters of the boards that
 * show them. Call it after the transaction committed. Moved tasks get no
 * per-task event on purpose, so integrations do not react to a workspace
 * setting.
 */
export async function publishWorkspaceColumnChanges({
  projectIds,
  subtaskParentProjectIds = [],
}: {
  projectIds: string[];
  subtaskParentProjectIds?: string[];
}): Promise<void> {
  for (const projectId of new Set(projectIds)) {
    await publishEvent("project.updated", { projectId });
  }

  if (subtaskParentProjectIds.length === 0) return;

  const affected = new Set<string>(subtaskParentProjectIds);
  for (const projectId of new Set(subtaskParentProjectIds)) {
    for (const parent of await getProjectSubtaskParentProjects(projectId)) {
      affected.add(parent.projectId);
    }
  }
  await publishEvent("subtask-parents.refresh", {
    projects: [...affected].map((projectId) => ({ projectId })),
  });
}
