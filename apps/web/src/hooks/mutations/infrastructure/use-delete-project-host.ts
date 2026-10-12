import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import deleteProjectHost from "@/fetchers/infrastructure/delete-project-host";
import { getInfrastructureErrorMessage } from "@/lib/infrastructure-error";
import { toast } from "@/lib/toast";
import { useInfrastructureInvalidation } from "./use-infrastructure-invalidation";

function useDeleteProjectHost() {
  const { t } = useTranslation();
  const invalidate = useInfrastructureInvalidation();

  return useMutation({
    mutationFn: (request: { projectId: string; hostId: string }) =>
      deleteProjectHost(request),
    onSuccess: (_data, variables) => {
      invalidate(variables.projectId);
    },
    onError: (error) => {
      toast.error(getInfrastructureErrorMessage(error, t));
    },
  });
}

export default useDeleteProjectHost;
