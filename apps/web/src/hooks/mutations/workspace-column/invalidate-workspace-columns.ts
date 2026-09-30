import type { QueryClient } from "@tanstack/react-query";
import { workspaceColumnsQueryKey } from "@/hooks/queries/workspace-column/use-get-workspace-columns";

/**
 * A workspace column change can reach every project of the workspace, so the
 * project column lists (the `["columns"]` prefix) are refreshed with it. The
 * task caches are refreshed as well when tasks may have changed column
 * (turning enforcement on, deleting a column with a target).
 */
export async function invalidateWorkspaceColumns(
  queryClient: QueryClient,
  workspaceId: string,
  { tasks = false }: { tasks?: boolean } = {},
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: workspaceColumnsQueryKey(workspaceId),
      refetchType: "all",
    }),
    queryClient.invalidateQueries({
      queryKey: ["columns"],
      refetchType: "all",
    }),
    ...(tasks
      ? [
          queryClient.invalidateQueries({
            queryKey: ["tasks"],
            refetchType: "all",
          }),
          queryClient.invalidateQueries({
            queryKey: ["task"],
            refetchType: "all",
          }),
        ]
      : []),
  ]);
}
