import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import deleteProjectModel from "@/fetchers/infrastructure/delete-project-model";
import { getInfrastructureErrorMessage } from "@/lib/infrastructure-error";
import { toast } from "@/lib/toast";
import { useInfrastructureInvalidation } from "./use-infrastructure-invalidation";

function useDeleteProjectModel() {
  const { t } = useTranslation();
  const invalidate = useInfrastructureInvalidation();

  return useMutation({
    mutationFn: (request: { projectId: string; modelId: string }) =>
      deleteProjectModel(request),
    onSuccess: (_data, variables) => {
      invalidate(variables.projectId, { models: true });
    },
    onError: (error) => {
      toast.error(getInfrastructureErrorMessage(error, t));
    },
  });
}

export default useDeleteProjectModel;
