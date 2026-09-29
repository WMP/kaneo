import { useMutation, useQueryClient } from "@tanstack/react-query";
import linkResource from "@/fetchers/resource/link-resource";
import { invalidateAssigneeCaches } from "./invalidate-assignee-caches";

// Linking moves task assignments to the member's account, so it refreshes what
// an assignee change refreshes, workspace-wide, along with the resource list.
function useLinkResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: linkResource,
    onSuccess: ({ resource }) => {
      invalidateAssigneeCaches(queryClient, resource.workspaceId);
    },
  });
}

export default useLinkResource;
