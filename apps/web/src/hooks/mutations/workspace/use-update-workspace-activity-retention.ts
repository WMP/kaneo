import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateWorkspaceActivityRetention from "@/fetchers/workspace/update-workspace-activity-retention";

function useUpdateWorkspaceActivityRetention() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateWorkspaceActivityRetention,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-activity-retention", variables.workspaceId],
      });
    },
  });
}

export default useUpdateWorkspaceActivityRetention;
