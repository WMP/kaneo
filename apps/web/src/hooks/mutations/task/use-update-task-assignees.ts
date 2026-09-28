import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskAssignees from "@/fetchers/task/update-task-assignees";

type UpdateTaskAssigneesVariables = {
  taskId: string;
  projectId: string;
  userIds: string[];
  resourceIds?: string[];
};

export function useUpdateTaskAssignees() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      userIds,
      resourceIds,
    }: UpdateTaskAssigneesVariables) =>
      updateTaskAssignees(taskId, userIds, resourceIds ?? []),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["task", variables.taskId],
      });
      queryClient.invalidateQueries({
        queryKey: ["tasks", variables.projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["notifications"],
      });
      queryClient.invalidateQueries({
        queryKey: ["projects"],
      });
      queryClient.invalidateQueries({
        queryKey: ["activities", variables.taskId],
      });
      queryClient.invalidateQueries({
        queryKey: ["task-relations"],
      });
    },
  });
}
