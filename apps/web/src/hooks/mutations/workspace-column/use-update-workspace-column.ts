import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { UpdateWorkspaceColumnRequest } from "@/fetchers/workspace-column/update-workspace-column";
import updateWorkspaceColumn from "@/fetchers/workspace-column/update-workspace-column";
import { invalidateWorkspaceColumns } from "./invalidate-workspace-columns";

export function useUpdateWorkspaceColumn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateWorkspaceColumnRequest) =>
      updateWorkspaceColumn(request),
    onSuccess: async (_, { workspaceId }) => {
      await invalidateWorkspaceColumns(queryClient, workspaceId, {
        tasks: false,
      });
    },
  });
}
