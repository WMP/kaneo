import { useMutation, useQueryClient } from "@tanstack/react-query";
import removeProjectMember from "@/fetchers/project-member/remove-project-member";
import { invalidateProjectMembership } from "./invalidate-project-membership";

/**
 * Leaving a project ends the caller's own access to it, so the project's
 * queries would answer 403 the moment they were refetched, and the page the
 * person is on would flash its no-access state. The caches are therefore
 * invalidated only after `afterLeft` (toast and navigation away) finished, and
 * at once when leaving failed (a 409 means the row changed meanwhile).
 */
function useLeaveProject(workspaceId?: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn: removeProjectMember });

  const leave = async (
    variables: { projectId: string; userId: string },
    afterLeft: () => void | Promise<void>,
  ) => {
    const invalidate = () =>
      invalidateProjectMembership(queryClient, {
        projectId: variables.projectId,
        workspaceId,
      });
    try {
      await mutation.mutateAsync(variables);
    } catch (error) {
      void invalidate();
      throw error;
    }
    try {
      await afterLeft();
    } finally {
      void invalidate();
    }
  };

  return { leave, isPending: mutation.isPending };
}

export default useLeaveProject;
