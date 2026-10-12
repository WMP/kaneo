import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import updateProjectModel, {
  type UpdateProjectModelRequest,
} from "@/fetchers/infrastructure/update-project-model";
import { getInfrastructureErrorMessage } from "@/lib/infrastructure-error";
import { toast } from "@/lib/toast";
import { useInfrastructureInvalidation } from "./use-infrastructure-invalidation";

function useUpdateProjectModel() {
  const { t } = useTranslation();
  const invalidate = useInfrastructureInvalidation();

  return useMutation({
    mutationFn: (request: UpdateProjectModelRequest) =>
      updateProjectModel(request),
    onSuccess: (_data, variables) => {
      invalidate(variables.projectId, { models: true });
    },
    onError: (error) => {
      toast.error(getInfrastructureErrorMessage(error, t));
    },
  });
}

export default useUpdateProjectModel;
