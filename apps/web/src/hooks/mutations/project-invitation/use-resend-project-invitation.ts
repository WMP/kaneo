import { useMutation, useQueryClient } from "@tanstack/react-query";
import resendProjectInvitation from "@/fetchers/project-invitation/resend-project-invitation";
import { invalidateProjectMembership } from "../project-member/invalidate-project-membership";

function useResendProjectInvitation(workspaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: resendProjectInvitation,
    onSettled: (_data, _error, { projectId }) =>
      invalidateProjectMembership(queryClient, {
        projectId,
        workspaceId,
        settle: "invitations",
      }),
  });
}

export default useResendProjectInvitation;
