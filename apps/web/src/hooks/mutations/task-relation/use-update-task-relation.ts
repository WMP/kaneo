import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskRelation from "@/fetchers/task-relation/update-task-relation";
import {
  ganttTaskRelationsKey,
  invalidateGanttRelations,
} from "@/lib/gantt-query-keys";

function useUpdateTaskRelation(taskId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateTaskRelation,
    onSuccess: (relation) => {
      queryClient.invalidateQueries({
        queryKey: ganttTaskRelationsKey(taskId),
      });
      // Same reasoning as the create/delete mutations: the other endpoint's
      // own per-task cache, and every project's Gantt cache (which project(s)
      // the two tasks belong to isn't known here), need invalidating too.
      queryClient.invalidateQueries({
        queryKey: ganttTaskRelationsKey(relation.sourceTaskId),
      });
      queryClient.invalidateQueries({
        queryKey: ganttTaskRelationsKey(relation.targetTaskId),
      });
      invalidateGanttRelations(queryClient);
    },
  });
}

export default useUpdateTaskRelation;
