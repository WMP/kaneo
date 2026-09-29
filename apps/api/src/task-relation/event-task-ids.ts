import { publishEvent } from "../events";

// A relation can join tasks of two projects, and its event is published once for
// each project so both projects' subscribers refresh. The WebSocket layer sends
// a project's subscribers only ids of tasks in THAT project (an id from the
// other side would reveal a task they may not open), so the publisher states
// which of the relation's tasks live in the event's project, in
// `projectTaskIds`. It is required by `publishRelationEvent`, so leaving it out
// is a compile error, and an event without it carries no relation id at all.
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

export type RelationEventPayload = {
  /** The project this event is delivered to. */
  projectId: string;
  /** Which of the relation's tasks live in `projectId`. */
  projectTaskIds: string[];
  taskId: string;
  sourceTaskId: string;
  targetTaskId: string;
  userId?: string;
  /** Marks the second event of a cross-project relation. */
  secondaryNotification?: boolean;
} & Record<string, unknown>;

// The only way to publish a relation event.
export function publishRelationEvent(
  name:
    | "task-relation.created"
    | "task-relation.updated"
    | "task-relation.deleted",
  payload: RelationEventPayload,
  options?: { waitForHandlers?: boolean },
) {
  return publishEvent(name, payload, options);
}
