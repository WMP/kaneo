import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import createProjectHost, {
  type CreateProjectHostRequest,
} from "@/fetchers/infrastructure/create-project-host";
import { getInfrastructureErrorMessage } from "@/lib/infrastructure-error";
import { invalidateInfrastructure } from "@/lib/infrastructure-keys";
import { toast } from "@/lib/toast";

function useCreateProjectHost() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateProjectHostRequest) =>
      createProjectHost(request),
    onSuccess: () => {
      void invalidateInfrastructure(queryClient);
    },
    onError: (error) => {
      toast.error(getInfrastructureErrorMessage(error, t));
    },
  });
}

export default useCreateProjectHost;
