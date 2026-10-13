import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import deleteProjectModel from "@/fetchers/infrastructure/delete-project-model";
import { getInfrastructureErrorMessage } from "@/lib/infrastructure-error";
import { invalidateInfrastructure } from "@/lib/infrastructure-keys";
import { toast } from "@/lib/toast";

function useDeleteProjectModel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: { projectId: string; modelId: string }) =>
      deleteProjectModel(request),
    onSuccess: () => {
      void invalidateInfrastructure(queryClient);
    },
    onError: (error) => {
      toast.error(getInfrastructureErrorMessage(error, t));
    },
  });
}

export default useDeleteProjectModel;
