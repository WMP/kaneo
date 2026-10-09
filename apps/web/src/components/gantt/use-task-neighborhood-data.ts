import { useMemo } from "react";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import useGetProjectTaskRelations from "@/hooks/queries/task-relation/use-get-project-task-relations";
import {
  buildNeighborhoodData,
  type NeighborhoodData,
} from "./gantt-relation-model";
import { useWorkspaceWorkingCalendar } from "./use-workspace-working-calendar";

export type TaskNeighborhoodDataState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; data: NeighborhoodData };

/**
 * Inputs of the dependency neighborhood card for the task open in a details
 * sheet, on any project view. It reads the same TanStack queries as the project
 * Gantt (`["tasks", projectId]`, `["task-relations", "project", projectId]`,
 * `["calendar", workspaceId]`), so a view that already holds them fetches
 * nothing twice, and builds the schedules with the same pure functions
 * (gantt-relation-model.ts). The queries stay idle while no task is open.
 *
 * The calendar never blocks the card: like the Gantt it falls back to Mon-Fri
 * until it arrives. Cached data stays "ready" through a failed refetch.
 */
export function useTaskNeighborhoodData({
  workspaceId,
  projectId,
  taskId,
}: {
  workspaceId: string;
  projectId: string;
  taskId: string | undefined;
}): TaskNeighborhoodDataState {
  const enabled = Boolean(taskId);
  const tasksQuery = useGetTasks(projectId, { enabled });
  const relationsQuery = useGetProjectTaskRelations(projectId, { enabled });
  const { workingDayPredicate } = useWorkspaceWorkingCalendar(workspaceId, {
    enabled,
  });

  const project = tasksQuery.data;
  const relations = relationsQuery.data;

  const data = useMemo(() => {
    if (!enabled || !project || !relations) return null;
    return buildNeighborhoodData({
      tasks: [
        ...project.columns.flatMap((column) => column.tasks),
        ...(project.plannedTasks ?? []),
      ],
      relations,
      projectId,
      projectSlug: project.slug,
      isWorkingDay: workingDayPredicate,
    });
  }, [enabled, project, relations, projectId, workingDayPredicate]);

  if (!enabled) return { status: "idle" };
  if (data) return { status: "ready", data };
  if (tasksQuery.isError || relationsQuery.isError) {
    return {
      status: "error",
      retry: () => {
        if (tasksQuery.isError) void tasksQuery.refetch();
        if (relationsQuery.isError) void relationsQuery.refetch();
      },
    };
  }
  return { status: "loading" };
}
