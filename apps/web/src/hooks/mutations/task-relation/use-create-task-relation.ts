import { useMutation, useQueryClient } from "@tanstack/react-query";
import createTaskRelation from "@/fetchers/task-relation/create-task-relation";

import {
  ganttTaskRelationsKey,
  invalidateGanttRelations,
} from "@/lib/gantt-query-keys";
import { invalidateRelationTaskProject } from "./invalidate-relation-task-project";

function useCreateTaskRelation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createTaskRelation,
    onSuccess: (_, variables) => {
      void invalidateRelationTaskProject(queryClient, variables.sourceTaskId);
      // "Blocked by" makes the current task the target, so a board that holds
      // only the target (another project than the source's) is refreshed too.
      void invalidateRelationTaskProject(queryClient, variables.targetTaskId);
      queryClient.invalidateQueries({
        queryKey: ganttTaskRelationsKey(variables.sourceTaskId),
      });
      queryClient.invalidateQueries({
        queryKey: ganttTaskRelationsKey(variables.targetTaskId),
      });
      // The Gantt chart's dependency lines read a project-scoped cache
      // (["task-relations", "project", projectId]) that neither key above
      // reaches. Which project(s) the two tasks belong to isn't known here
      // (the create response carries only the relation, not the tasks), so
      // every project's cache is invalidated — a rare, cheap mutation, and
      // only mounted Gantt views actually refetch.
      invalidateGanttRelations(queryClient);
    },
  });
}

export default useCreateTaskRelation;
