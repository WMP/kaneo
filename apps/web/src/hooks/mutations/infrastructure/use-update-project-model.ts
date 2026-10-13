import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import updateProjectModel, {
  type UpdateProjectModelRequest,
} from "@/fetchers/infrastructure/update-project-model";
import { getInfrastructureErrorMessage } from "@/lib/infrastructure-error";
import { invalidateInfrastructure } from "@/lib/infrastructure-keys";
import { toast } from "@/lib/toast";

function useUpdateProjectModel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateProjectModelRequest) =>
      updateProjectModel(request),
    onSuccess: () => {
      void invalidateInfrastructure(queryClient);
    },
    onError: (error) => {
      toast.error(getInfrastructureErrorMessage(error, t));
    },
  });
}

export default useUpdateProjectModel;
