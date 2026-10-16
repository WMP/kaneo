import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import deleteProjectHost from "@/fetchers/infrastructure/delete-project-host";
import { getInfrastructureErrorMessage } from "@/lib/infrastructure-error";
import { invalidateInfrastructure } from "@/lib/infrastructure-keys";
import { toast } from "@/lib/toast";

function useDeleteProjectHost() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: { projectId: string; hostId: string }) =>
      deleteProjectHost(request),
    onSuccess: () => {
      void invalidateInfrastructure(queryClient);
    },
    onError: (error) => {
      toast.error(getInfrastructureErrorMessage(error, t));
    },
  });
}

export default useDeleteProjectHost;
