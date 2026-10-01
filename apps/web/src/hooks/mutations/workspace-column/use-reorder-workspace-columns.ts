import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReorderWorkspaceColumnsRequest } from "@/fetchers/workspace-column/reorder-workspace-columns";
import reorderWorkspaceColumns from "@/fetchers/workspace-column/reorder-workspace-columns";
import { invalidateWorkspaceColumns } from "./invalidate-workspace-columns";

export function useReorderWorkspaceColumns() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: ReorderWorkspaceColumnsRequest) =>
      reorderWorkspaceColumns(request),
    onSuccess: async (_, { workspaceId }) => {
      await invalidateWorkspaceColumns(queryClient, workspaceId, {
        tasks: false,
      });
    },
  });
}
