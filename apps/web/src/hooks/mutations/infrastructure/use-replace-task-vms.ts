import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import replaceTaskVms, {
  type TaskVmInput,
} from "@/fetchers/infrastructure/replace-task-vms";
import { getInfrastructureErrorMessage } from "@/lib/infrastructure-error";
import {
  infrastructureKeys,
  invalidateInfrastructure,
} from "@/lib/infrastructure-keys";
import { toast } from "@/lib/toast";

type ReplaceTaskVmsRequest = {
  projectId: string;
  taskId: string;
  vms: TaskVmInput[];
};

// `notifyError: false` leaves the failure to the caller, which words it itself.
function useReplaceTaskVms({ notifyError = true } = {}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, vms }: ReplaceTaskVmsRequest) =>
      replaceTaskVms({ taskId, vms }),
    onSuccess: (data, variables) => {
      // The answer is the saved list: show it without waiting for the refetch.
      queryClient.setQueryData(
        infrastructureKeys.taskVms(variables.taskId),
        data,
      );
      void invalidateInfrastructure(queryClient);
    },
    onError: (error) => {
      if (notifyError) toast.error(getInfrastructureErrorMessage(error, t));
    },
  });
}

export default useReplaceTaskVms;
