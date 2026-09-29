import { useMutation, useQueryClient } from "@tanstack/react-query";
import addProjectMember from "@/fetchers/project-member/add-project-member";
import { invalidateProjectMembership } from "./invalidate-project-membership";

function useAddProjectMember(workspaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addProjectMember,
    onSuccess: (_data, { projectId }) =>
      invalidateProjectMembership(queryClient, { projectId, workspaceId }),
  });
}

export default useAddProjectMember;
