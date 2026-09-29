import { useMutation, useQueryClient } from "@tanstack/react-query";
import createProjectInvitation from "@/fetchers/project-invitation/create-project-invitation";
import { invalidateProjectMembership } from "../project-member/invalidate-project-membership";

function useCreateProjectInvitation(workspaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProjectInvitation,
    onSuccess: (_data, { projectId }) =>
      invalidateProjectMembership(queryClient, { projectId, workspaceId }),
  });
}

export default useCreateProjectInvitation;
