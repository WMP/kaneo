import { useQuery } from "@tanstack/react-query";
import getWorkspaceMembers from "@/fetchers/workspace/get-workspace-members";

// Workspace people for workspace-level views (activity log, names in activity
// feeds). The API filters the list for callers without full access. Project
// views pick people through `useProjectMembers` instead.
function useGetWorkspaceMembers({ workspaceId }: { workspaceId?: string }) {
  return useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => getWorkspaceMembers(workspaceId ?? ""),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
  });
}

export default useGetWorkspaceMembers;
