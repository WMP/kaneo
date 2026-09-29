import { useMutation, useQueryClient } from "@tanstack/react-query";
import removeProjectMember from "@/fetchers/project-member/remove-project-member";
import { invalidateProjectMembership } from "./invalidate-project-membership";

function useRemoveProjectMember(workspaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeProjectMember,
    onSettled: (_data, _error, { projectId }) =>
      invalidateProjectMembership(queryClient, { projectId, workspaceId }),
  });
}

export default useRemoveProjectMember;
