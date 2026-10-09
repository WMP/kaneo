import { useCallback } from "react";
import { GanttTaskNeighborhood } from "./gantt-task-neighborhood-card";
import { useTaskNeighborhoodData } from "./use-task-neighborhood-data";

const NO_EDGES: never[] = [];
const NO_SCHEDULES = new Map<string, { start: Date; end: Date }>();
const NO_INFO = new Map<string, { key: string; title: string }>();

/**
 * The dependency neighborhood of the task open in a details sheet, with its
 * data. Rendered by TaskDetailsSheet, so every project view that opens the
 * sheet shows it. `onSelectTask` gets the neighbor and the id of the project it
 * belongs to.
 */
export function TaskNeighborhoodAside({
  workspaceId,
  projectId,
  taskId,
  onSelectTask,
}: {
  workspaceId: string;
  projectId: string;
  taskId: string | undefined;
  onSelectTask: (taskId: string, projectId: string) => void;
}) {
  const state = useTaskNeighborhoodData({ workspaceId, projectId, taskId });
  const projectIdByTaskId =
    state.status === "ready" ? state.data.projectIdByTaskId : null;

  const handleSelect = useCallback(
    (selectedTaskId: string) => {
      // A neighbor is always a relation endpoint; one without a recorded
      // project belongs to the open project.
      onSelectTask(
        selectedTaskId,
        projectIdByTaskId?.get(selectedTaskId) ?? projectId,
      );
    },
    [onSelectTask, projectIdByTaskId, projectId],
  );

  if (!taskId || state.status === "idle") return null;

  if (state.status === "ready") {
    return (
      <GanttTaskNeighborhood
        focusTaskId={taskId}
        edges={state.data.edges}
        scheduleByTaskId={state.data.scheduleByTaskId}
        taskInfoById={state.data.taskInfoById}
        violatedEdgeIds={state.data.violatedEdgeIds}
        onSelectTask={handleSelect}
      />
    );
  }

  return (
    <GanttTaskNeighborhood
      focusTaskId={taskId}
      edges={NO_EDGES}
      scheduleByTaskId={NO_SCHEDULES}
      taskInfoById={NO_INFO}
      onSelectTask={handleSelect}
      status={state.status}
      onRetry={state.status === "error" ? state.retry : undefined}
    />
  );
}
