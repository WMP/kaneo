import { useMutation, useQueryClient } from "@tanstack/react-query";
import cancelProjectInvitation from "@/fetchers/project-invitation/cancel-project-invitation";
import { invalidateProjectMembership } from "../project-member/invalidate-project-membership";

function useCancelProjectInvitation(workspaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelProjectInvitation,
    // Also on failure: a 404 means the invitation is gone already.
    onSettled: (_data, _error, { projectId }) =>
      invalidateProjectMembership(queryClient, { projectId, workspaceId }),
  });
}

export default useCancelProjectInvitation;
