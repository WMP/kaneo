import { useQuery } from "@tanstack/react-query";
import getWorkspaceColumns from "@/fetchers/workspace-column/get-workspace-columns";

export const workspaceColumnsQueryKey = (workspaceId: string) =>
  ["workspace-columns", workspaceId] as const;

export function useGetWorkspaceColumns(workspaceId: string) {
  return useQuery({
    queryKey: workspaceColumnsQueryKey(workspaceId),
    queryFn: () => getWorkspaceColumns(workspaceId),
    enabled: !!workspaceId,
  });
}
