import { useMutation, useQueryClient } from "@tanstack/react-query";
import unlinkResource from "@/fetchers/resource/unlink-resource";
import { invalidateWorkloadCaches } from "./invalidate-assignee-caches";

function useUnlinkResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: unlinkResource,
    onSuccess: (resource) => {
      void queryClient.invalidateQueries({
        queryKey: ["workspace-resources", resource.workspaceId],
      });
      // The resource has its own workload row again.
      invalidateWorkloadCaches(queryClient, resource.workspaceId);
    },
  });
}

export default useUnlinkResource;
