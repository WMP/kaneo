import { useMutation, useQueryClient } from "@tanstack/react-query";
import inviteResource from "@/fetchers/resource/invite-resource";

// The invitation shows on the resource (status badge) and in the invitations
// of the projects it names, so both lists are refreshed.
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
      void queryClient.invalidateQueries({ queryKey: ["project-invitations"] });
    },
  });
}

export default useInviteResource;
