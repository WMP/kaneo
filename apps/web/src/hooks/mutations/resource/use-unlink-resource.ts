import { useMutation, useQueryClient } from "@tanstack/react-query";
import unlinkResource from "@/fetchers/resource/unlink-resource";

function useUnlinkResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: unlinkResource,
    onSuccess: (resource) => {
      void queryClient.invalidateQueries({
        queryKey: ["workspace-resources", resource.workspaceId],
      });
      // The resource has its own workload row again.
      void queryClient.invalidateQueries({ queryKey: ["workload"] });
    },
  });
}

export default useUnlinkResource;
