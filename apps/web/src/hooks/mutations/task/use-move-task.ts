import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import moveTask from "@/fetchers/task/move-task";
import { invalidateGanttRelations } from "@/lib/gantt-query-keys";
import { toast } from "@/lib/toast";

export function useMoveTask() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: moveTask,
    onSuccess: (result, variables) => {
      toast.success(t("tasks:move.success"));
      queryClient.invalidateQueries({
        queryKey: ["task", variables.taskId],
      });
      queryClient.invalidateQueries({
        queryKey: ["tasks", result.sourceProjectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["tasks", result.destinationProjectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["projects"],
      });
      queryClient.invalidateQueries({
        queryKey: ["activities", variables.taskId],
      });
      queryClient.invalidateQueries({
        queryKey: ["notifications"],
      });
      // The task's relation endpoints now belong to another project.
      invalidateGanttRelations(queryClient);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("tasks:move.error"),
      );
    },
  });
}
