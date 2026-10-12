import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import createProjectModel, {
  type CreateProjectModelRequest,
} from "@/fetchers/infrastructure/create-project-model";
import { getInfrastructureErrorMessage } from "@/lib/infrastructure-error";
import { toast } from "@/lib/toast";
import { useInfrastructureInvalidation } from "./use-infrastructure-invalidation";

function useCreateProjectModel() {
  const { t } = useTranslation();
  const invalidate = useInfrastructureInvalidation();

  return useMutation({
    mutationFn: (request: CreateProjectModelRequest) =>
      createProjectModel(request),
    onSuccess: (_data, variables) => {
      invalidate(variables.projectId, { models: true });
    },
    onError: (error) => {
      toast.error(getInfrastructureErrorMessage(error, t));
    },
  });
}

export default useCreateProjectModel;
