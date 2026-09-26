import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskApproval from "@/fetchers/task/update-task-approval";

type UpdateTaskApprovalInput = {
  taskId: string;
  projectId: string;
  approvalStatus: "none" | "pending" | "approved" | "rejected";
  approvalNote?: string | null;
};

export function useUpdateTaskApproval() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      approvalStatus,
      approvalNote,
    }: UpdateTaskApprovalInput) =>
      updateTaskApproval(taskId, approvalStatus, approvalNote),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["task", variables.taskId],
      });
      queryClient.invalidateQueries({
        queryKey: ["tasks", variables.projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["task-relations"],
      });
      queryClient.invalidateQueries({
        queryKey: ["notifications"],
      });
      queryClient.invalidateQueries({
        queryKey: ["activities", variables.taskId],
      });
    },
  });
}
