import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateWorkspaceColumnRequest } from "@/fetchers/workspace-column/create-workspace-column";
import createWorkspaceColumn from "@/fetchers/workspace-column/create-workspace-column";
import { invalidateWorkspaceColumns } from "./invalidate-workspace-columns";

export function useCreateWorkspaceColumn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateWorkspaceColumnRequest) =>
      createWorkspaceColumn(request),
    onSuccess: async (_, { workspaceId }) => {
      await invalidateWorkspaceColumns(queryClient, workspaceId, {
        tasks: false,
      });
    },
  });
}
