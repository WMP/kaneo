import { useMutation, useQueryClient } from "@tanstack/react-query";
import createProjectInvitation from "@/fetchers/project-invitation/create-project-invitation";
import { invalidateProjectMembership } from "../project-member/invalidate-project-membership";

function useCreateProjectInvitation(workspaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProjectInvitation,
    // Also on failure: a 409 means an invitation for this email exists or the
    // person joined meanwhile, and the lists must show what is stored.
    onSettled: (_data, _error, { projectId }) =>
      invalidateProjectMembership(queryClient, {
        projectId,
        workspaceId,
        settle: "invitations",
      }),
  });
}

export default useCreateProjectInvitation;
