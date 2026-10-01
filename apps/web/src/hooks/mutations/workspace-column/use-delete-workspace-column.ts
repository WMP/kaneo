import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DeleteWorkspaceColumnRequest } from "@/fetchers/workspace-column/delete-workspace-column";
import deleteWorkspaceColumn from "@/fetchers/workspace-column/delete-workspace-column";
import { invalidateWorkspaceColumns } from "./invalidate-workspace-columns";

export function useDeleteWorkspaceColumn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: DeleteWorkspaceColumnRequest) =>
      deleteWorkspaceColumn(request),
    onSuccess: async (_, { workspaceId }) => {
      await invalidateWorkspaceColumns(queryClient, workspaceId, {
        tasks: true,
      });
    },
  });
}
