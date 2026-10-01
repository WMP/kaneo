import { useQuery } from "@tanstack/react-query";
import getWorkspacePeople from "@/fetchers/workspace/get-workspace-people";

// The rows of the workspace members table. It lives under the
// `["workspace-members", workspaceId]` prefix, so everything that invalidates
// the workspace people (adding, removing, role changes) refreshes it too.
export const workspacePeopleKey = (workspaceId: string | undefined) =>
  ["workspace-members", workspaceId, "people"] as const;

function useGetWorkspacePeople(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspacePeopleKey(workspaceId),
    queryFn: () => getWorkspacePeople(workspaceId ?? ""),
    enabled: !!workspaceId,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export default useGetWorkspacePeople;
