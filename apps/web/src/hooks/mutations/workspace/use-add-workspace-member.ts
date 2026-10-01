import { useMutation, useQueryClient } from "@tanstack/react-query";
import addWorkspaceMember from "@/fetchers/workspace/add-workspace-member";

function useAddWorkspaceMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addWorkspaceMember,
    // Also on failure: a 409 means the person joined meanwhile and the lists
    // must show what is stored.
    onSettled: (_data, _error, { workspaceId }) => {
      void queryClient.invalidateQueries({
        queryKey: ["workspace", "full", workspaceId],
      });
      // The people lists, the pickers of the project views and the candidates
      // of every project (a new member can be added to one).
      // The added person no longer belongs in the directory results.
      void queryClient.invalidateQueries({
        queryKey: ["workspace-user-directory"],
      });
      void queryClient.invalidateQueries({ queryKey: ["project-members"] });
      void queryClient.invalidateQueries({
        queryKey: ["project-member-candidates"],
      });
      return queryClient.invalidateQueries({
        queryKey: ["workspace-members", workspaceId],
      });
    },
  });
}

export default useAddWorkspaceMember;
