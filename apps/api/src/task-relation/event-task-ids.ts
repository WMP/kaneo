// A relation can join tasks of two projects, and its event is published once for
// each project so both projects' subscribers refresh. The WebSocket layer sends
// a project's subscribers only ids of tasks in THAT project (an id from the
// other side would reveal a task they may not open), so the publisher states
// which of the relation's tasks live in the event's project. `projectTaskIds`
// on the event carries them; without it the WebSocket layer sends no relation
// ids at all.
export function relationTaskIdsInProject(
  relation: { sourceTaskId: string; targetTaskId: string },
  projects: { sourceProjectId?: string; targetProjectId?: string },
  eventProjectId: string,
): string[] {
  const ids: string[] = [];
  if (projects.sourceProjectId === eventProjectId) {
    ids.push(relation.sourceTaskId);
  }
  if (
    projects.targetProjectId === eventProjectId &&
    relation.targetTaskId !== relation.sourceTaskId
  ) {
    ids.push(relation.targetTaskId);
  }
  return ids;
}
