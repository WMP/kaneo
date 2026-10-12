import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import replaceTaskVms, {
  type TaskVmInput,
} from "@/fetchers/infrastructure/replace-task-vms";
import { getInfrastructureErrorMessage } from "@/lib/infrastructure-error";
import { infrastructureKeys } from "@/lib/infrastructure-keys";
import { toast } from "@/lib/toast";
import { useInfrastructureInvalidation } from "./use-infrastructure-invalidation";

type ReplaceTaskVmsRequest = {
  projectId: string;
  taskId: string;
  vms: TaskVmInput[];
};

function useReplaceTaskVms() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const invalidate = useInfrastructureInvalidation();

  return useMutation({
    mutationFn: ({ taskId, vms }: ReplaceTaskVmsRequest) =>
      replaceTaskVms({ taskId, vms }),
    onSuccess: (data, variables) => {
      // The answer is the saved list: show it without waiting for the refetch.
      queryClient.setQueryData(
        infrastructureKeys.taskVms(variables.taskId),
        data,
      );
      invalidate(variables.projectId, { taskId: variables.taskId });
    },
    onError: (error) => {
      toast.error(getInfrastructureErrorMessage(error, t));
    },
  });
}

export default useReplaceTaskVms;
