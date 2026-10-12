import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import createProjectHost, {
  type CreateProjectHostRequest,
} from "@/fetchers/infrastructure/create-project-host";
import { getInfrastructureErrorMessage } from "@/lib/infrastructure-error";
import { toast } from "@/lib/toast";
import { useInfrastructureInvalidation } from "./use-infrastructure-invalidation";

function useCreateProjectHost() {
  const { t } = useTranslation();
  const invalidate = useInfrastructureInvalidation();

  return useMutation({
    mutationFn: (request: CreateProjectHostRequest) =>
      createProjectHost(request),
    onSuccess: (_data, variables) => {
      invalidate(variables.projectId);
    },
    onError: (error) => {
      toast.error(getInfrastructureErrorMessage(error, t));
    },
  });
}

export default useCreateProjectHost;
