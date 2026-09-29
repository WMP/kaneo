import { useMutation, useQueryClient } from "@tanstack/react-query";
import linkResource from "@/fetchers/resource/link-resource";
import { invalidateAssigneeCaches } from "./invalidate-assignee-caches";

// Linking moves task assignments to the member's account, so it refreshes what
// an assignee change refreshes, scoped to the workspace and the projects whose
// tasks moved, along with the resource list.
function useLinkResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: linkResource,
    onSuccess: ({ resource, movedProjectIds }) => {
      invalidateAssigneeCaches(
        queryClient,
        resource.workspaceId,
        movedProjectIds,
      );
    },
  });
}

export default useLinkResource;
