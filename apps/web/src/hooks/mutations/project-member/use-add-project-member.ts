import { useMutation, useQueryClient } from "@tanstack/react-query";
import addProjectMember from "@/fetchers/project-member/add-project-member";
import { invalidateProjectMembership } from "./invalidate-project-membership";

function useAddProjectMember(workspaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addProjectMember,
    // Also on failure: a 409 means the person was added (or gained full
    // access) meanwhile, and the lists must show what is stored.
    onSettled: (_data, _error, { projectId }) =>
      invalidateProjectMembership(queryClient, { projectId, workspaceId }),
  });
}

export default useAddProjectMember;
