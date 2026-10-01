import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SetEnforcementRequest } from "@/fetchers/workspace-column/set-enforcement";
import setEnforcement from "@/fetchers/workspace-column/set-enforcement";
import { invalidateWorkspaceColumns } from "./invalidate-workspace-columns";

/**
 * Turning enforcement on rewrites the columns of every project and moves
 * tasks, so the project, column and task caches are all refreshed.
 */
export function useSetEnforcement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: SetEnforcementRequest) => setEnforcement(request),
    onSuccess: async (_, { workspaceId }) => {
      await Promise.all([
        invalidateWorkspaceColumns(queryClient, workspaceId, { tasks: true }),
        queryClient.invalidateQueries({
          queryKey: ["projects"],
          refetchType: "all",
        }),
      ]);
    },
  });
}
