import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import updateProjectHost, {
  type UpdateProjectHostRequest,
} from "@/fetchers/infrastructure/update-project-host";
import { getInfrastructureErrorMessage } from "@/lib/infrastructure-error";
import { toast } from "@/lib/toast";
import { useInfrastructureInvalidation } from "./use-infrastructure-invalidation";

function useUpdateProjectHost() {
  const { t } = useTranslation();
  const invalidate = useInfrastructureInvalidation();

  return useMutation({
    mutationFn: (request: UpdateProjectHostRequest) =>
      updateProjectHost(request),
    onSuccess: (_data, variables) => {
      invalidate(variables.projectId);
    },
    onError: (error) => {
      toast.error(getInfrastructureErrorMessage(error, t));
    },
  });
}

export default useUpdateProjectHost;
