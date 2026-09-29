import { useMutation, useQueryClient } from "@tanstack/react-query";
import linkResource from "@/fetchers/resource/link-resource";

// Linking moves task assignments to the member's account, so the task caches
// (assignee lists) and the workload are refreshed along with the resource list.
function useLinkResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: linkResource,
    onSuccess: ({ resource }) => {
      void queryClient.invalidateQueries({
        queryKey: ["workspace-resources", resource.workspaceId],
      });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["task"] });
      void queryClient.invalidateQueries({ queryKey: ["workload"] });
    },
  });
}

export default useLinkResource;
