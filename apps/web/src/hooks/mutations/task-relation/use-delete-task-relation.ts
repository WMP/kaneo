import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteTaskRelation from "@/fetchers/task-relation/delete-task-relation";

import {
  ganttTaskRelationsKey,
  invalidateGanttRelations,
} from "@/lib/gantt-query-keys";
import { invalidateRelationTaskProject } from "./invalidate-relation-task-project";

function useDeleteTaskRelation(taskId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteTaskRelation,
    onSuccess: (relation) => {
      void invalidateRelationTaskProject(queryClient, relation.sourceTaskId);
      queryClient.invalidateQueries({
        queryKey: ganttTaskRelationsKey(taskId),
      });
      // The API returns the deleted relation's actual endpoints, which may
      // differ from `taskId` (the panel this mutation was opened from) — the
      // OTHER endpoint's own per-task cache needs invalidating too, or its
      // relation list keeps showing the removed link until something else
      // refetches it.
      queryClient.invalidateQueries({
        queryKey: ganttTaskRelationsKey(relation.sourceTaskId),
      });
      queryClient.invalidateQueries({
        queryKey: ganttTaskRelationsKey(relation.targetTaskId),
      });
      // Same reasoning as the create mutation: which project(s) the two
      // tasks belong to isn't known here, so every project's Gantt cache is
      // invalidated rather than none of them.
      invalidateGanttRelations(queryClient);
    },
  });
}

export default useDeleteTaskRelation;
