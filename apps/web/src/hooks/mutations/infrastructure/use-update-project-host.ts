import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import updateProjectHost, {
  type UpdateProjectHostRequest,
} from "@/fetchers/infrastructure/update-project-host";
import { getInfrastructureErrorMessage } from "@/lib/infrastructure-error";
import { invalidateInfrastructure } from "@/lib/infrastructure-keys";
import { toast } from "@/lib/toast";

function useUpdateProjectHost() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateProjectHostRequest) =>
      updateProjectHost(request),
    onSuccess: () => {
      void invalidateInfrastructure(queryClient);
    },
    onError: (error) => {
      toast.error(getInfrastructureErrorMessage(error, t));
    },
  });
}

export default useUpdateProjectHost;
