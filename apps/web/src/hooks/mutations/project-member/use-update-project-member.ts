import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateProjectMember from "@/fetchers/project-member/update-project-member";
import { invalidateProjectMembership } from "./invalidate-project-membership";

function useUpdateProjectMember(workspaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProjectMember,
    // Also on failure: a 409 means the row changed meanwhile, and the list
    // must show what is stored, not what was chosen.
    onSettled: (_data, _error, { projectId }) =>
      invalidateProjectMembership(queryClient, { projectId, workspaceId }),
  });
}

export default useUpdateProjectMember;
