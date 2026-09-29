import { useMutation, useQueryClient } from "@tanstack/react-query";
import inviteResource from "@/fetchers/resource/invite-resource";

// The invitation shows on the resource (status badge): the resource list is
// refreshed. Project invitation lists are read when their page opens.
function useInviteResource(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: inviteResource,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["workspace-resources", workspaceId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["workspace-members", workspaceId],
      });
    },
  });
}

export default useInviteResource;
